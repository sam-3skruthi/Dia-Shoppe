-- 037 — financial_audit integrity (DEV first; NOT applied to production)
--
-- Question: can a malicious or careless privileged DB operation rewrite financial history?
-- Before this migration: YES. Any role with UPDATE/DELETE (service_role, the dashboard SQL
-- editor, the Management API) could silently change or delete audit rows.
--
-- Now, in layers:
--  1. UPDATE / DELETE / TRUNCATE are revoked from every API role (service_role included).
--  2. Row triggers refuse UPDATE/DELETE and a statement trigger refuses TRUNCATE, so even a
--     role that still holds the privilege (the table owner) is stopped by accident.
--  3. TAMPER EVIDENCE: every row stores the SHA-256 of its content + the previous row's hash
--     (a chain). A deliberate bypass (disabling the trigger as the DB owner and editing a row)
--     is DETECTED by audit_chain_status(): the chain breaks at the edited row.
--
-- Honest limit: the database owner can bypass any in-database control. Deleting the very LAST
-- rows leaves a still-valid chain, so detection needs an outside anchor. audit_chain_head()
-- returns {seq, hash}; record it somewhere the DB owner cannot edit (e.g. a weekly email to the
-- owner) and compare. That closes the gap without extra infrastructure.

ALTER TABLE public.financial_audit
  ADD COLUMN IF NOT EXISTS chain_seq BIGINT,
  ADD COLUMN IF NOT EXISTS prev_hash TEXT,
  ADD COLUMN IF NOT EXISTS row_hash  TEXT;

CREATE OR REPLACE FUNCTION private.audit_row_hash(
  p_seq BIGINT, p_at TIMESTAMPTZ, p_actor UUID, p_action TEXT, p_entity TEXT, p_entity_id BIGINT, p_detail JSONB, p_prev TEXT)
RETURNS TEXT LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT encode(extensions.digest(
    concat_ws('|', p_seq::text, extract(epoch FROM p_at)::text, COALESCE(p_actor::text, ''), p_action, p_entity,
              COALESCE(p_entity_id::text, ''), COALESCE(p_detail::text, ''), p_prev), 'sha256'), 'hex')
$$;

-- Backfill the chain for rows written before this migration
DO $$
DECLARE r RECORD; v_prev TEXT := repeat('0', 64); v_seq BIGINT := 0; v_hash TEXT;
BEGIN
  FOR r IN SELECT * FROM public.financial_audit WHERE row_hash IS NULL ORDER BY id LOOP
    v_seq := v_seq + 1;
    v_hash := private.audit_row_hash(v_seq, r.at, r.actor, r.action, r.entity, r.entity_id, r.detail, v_prev);
    UPDATE public.financial_audit SET chain_seq = v_seq, prev_hash = v_prev, row_hash = v_hash WHERE id = r.id;
    v_prev := v_hash;
  END LOOP;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_audit_chain_seq ON public.financial_audit (chain_seq);

-- Chain every new row. The advisory lock serialises writers so the chain has no forks.
CREATE OR REPLACE FUNCTION private.audit_chain_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_last RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('financial_audit_chain'));
  SELECT chain_seq, row_hash INTO v_last FROM public.financial_audit ORDER BY chain_seq DESC NULLS LAST LIMIT 1;
  NEW.chain_seq := COALESCE(v_last.chain_seq, 0) + 1;
  NEW.prev_hash := COALESCE(v_last.row_hash, repeat('0', 64));
  NEW.row_hash  := private.audit_row_hash(NEW.chain_seq, NEW.at, NEW.actor, NEW.action, NEW.entity, NEW.entity_id, NEW.detail, NEW.prev_hash);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_audit_chain_insert ON public.financial_audit;
CREATE TRIGGER trg_audit_chain_insert BEFORE INSERT ON public.financial_audit
  FOR EACH ROW EXECUTE FUNCTION private.audit_chain_insert();

-- Immutability
CREATE OR REPLACE FUNCTION private.audit_block_change()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'financial_audit is append-only (% blocked)', TG_OP USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS trg_audit_no_update_delete ON public.financial_audit;
CREATE TRIGGER trg_audit_no_update_delete BEFORE UPDATE OR DELETE ON public.financial_audit
  FOR EACH ROW EXECUTE FUNCTION private.audit_block_change();
DROP TRIGGER IF EXISTS trg_audit_no_truncate ON public.financial_audit;
CREATE TRIGGER trg_audit_no_truncate BEFORE TRUNCATE ON public.financial_audit
  FOR EACH STATEMENT EXECUTE FUNCTION private.audit_block_change();

REVOKE UPDATE, DELETE, TRUNCATE ON public.financial_audit FROM PUBLIC, anon, authenticated, service_role;

-- Verification (admin only). Returns the first broken chain_seq, or NULL when intact.
CREATE OR REPLACE FUNCTION public.audit_chain_status()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_bad BIGINT; v_rows BIGINT; v_head RECORD;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only' USING ERRCODE = '42501'; END IF;
  SELECT min(o.chain_seq) INTO v_bad
    FROM (SELECT f.*, lag(f.row_hash) OVER (ORDER BY f.chain_seq) AS exp_prev FROM public.financial_audit f) o
   WHERE o.prev_hash IS DISTINCT FROM COALESCE(o.exp_prev, repeat('0', 64))
      OR o.row_hash  IS DISTINCT FROM private.audit_row_hash(o.chain_seq, o.at, o.actor, o.action, o.entity, o.entity_id, o.detail, o.prev_hash);
  SELECT count(*) INTO v_rows FROM public.financial_audit;
  SELECT chain_seq, row_hash INTO v_head FROM public.financial_audit ORDER BY chain_seq DESC LIMIT 1;
  RETURN jsonb_build_object('intact', v_bad IS NULL, 'first_bad_seq', v_bad, 'rows', v_rows,
                            'head_seq', v_head.chain_seq, 'head_hash', v_head.row_hash);
END $$;
REVOKE ALL ON FUNCTION public.audit_chain_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_chain_status() TO authenticated;
