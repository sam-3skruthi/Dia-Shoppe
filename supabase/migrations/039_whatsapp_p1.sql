-- 039 — WhatsApp P1: queue, wamid dedup, delivery status, template registry, consent, campaign backend
-- (DEV first; NOT applied to production)
--
-- ONE table (whatsapp_messages) is both the message log and the work queue:
--   outbound: queued -> sending -> accepted -> sent -> delivered -> read      (or failed / failed_permanent / skipped)
--   inbound : received -> processing -> processed                              (or skipped / failed_permanent)
-- A worker claims rows with FOR UPDATE SKIP LOCKED + a lease; a crashed worker's rows return to the queue.
-- Requires 036 (ops_events, private.raise_ops_event) and 016 (whatsapp opt-in columns).
------------------------------------------------------------------------
-- 0. helpers
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.wa_e164(p_raw TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE WHEN length(d) = 10 THEN '91' || d
              WHEN length(d) BETWEEN 11 AND 15 THEN d
              ELSE NULL END
    FROM (SELECT regexp_replace(coalesce(p_raw, ''), '\D', '', 'g') AS d) x
$$;

-- 1m, 5m, 30m, 2h, 6h (+ up to 10% jitter)
CREATE OR REPLACE FUNCTION private.wa_backoff(p_attempt INT)
RETURNS INTERVAL LANGUAGE sql VOLATILE SET search_path = ''
AS $$
  SELECT (CASE greatest(p_attempt, 1) WHEN 1 THEN interval '1 minute' WHEN 2 THEN interval '5 minutes'
                                      WHEN 3 THEN interval '30 minutes' WHEN 4 THEN interval '2 hours'
                                      ELSE interval '6 hours' END) * (1 + random() * 0.1)
$$;

------------------------------------------------------------------------
-- 1. whatsapp_messages: finalized schema (additive; legacy columns and the admin page keep working)
------------------------------------------------------------------------
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS wamid              TEXT,          -- Meta message id (inbound: Meta's; outbound: the id Meta returned) = provider message id
  ADD COLUMN IF NOT EXISTS client_ref         TEXT,          -- our reference, echoed by Meta as biz_opaque_callback_data (lost-response reconciliation)
  ADD COLUMN IF NOT EXISTS phone_e164         TEXT,
  ADD COLUMN IF NOT EXISTS category           TEXT,          -- utility | marketing | service | authentication
  ADD COLUMN IF NOT EXISTS content_type       TEXT,          -- text | template | image | audio | ... (inbound media: metadata only, never the file)
  ADD COLUMN IF NOT EXISTS media_meta         JSONB,         -- {id, mime_type, sha256}; no URL, no caption body beyond message_text
  ADD COLUMN IF NOT EXISTS template_name      TEXT,
  ADD COLUMN IF NOT EXISTS template_language  TEXT,
  ADD COLUMN IF NOT EXISTS template_params    JSONB,         -- exactly what was sent, after sanitising
  ADD COLUMN IF NOT EXISTS status             TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS error_code         INT,
  ADD COLUMN IF NOT EXISTS error_message      TEXT,
  ADD COLUMN IF NOT EXISTS error_retryable    BOOLEAN,
  ADD COLUMN IF NOT EXISTS attempt_count      INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts       INT NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS next_attempt_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_attempt_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_until       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idempotency_key    TEXT,
  ADD COLUMN IF NOT EXISTS accepted_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_sent_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS read_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS campaign_id        BIGINT,
  ADD COLUMN IF NOT EXISTS ai_meta            JSONB;         -- {intent, confidence, needs_human, provider, model, latency_ms}; never the prompt

-- legacy rows: derive a status from the old text prefixes, once
UPDATE public.whatsapp_messages SET
  status = CASE WHEN direction = 'inbound' THEN 'processed'
                WHEN message_text LIKE '[FAILED]%' THEN 'failed_permanent'
                ELSE 'accepted' END,
  error_message = CASE WHEN message_text LIKE '[hello_world fallback]%' THEN 'legacy: delivered through the hello_world fallback, not the real template'
                       WHEN message_text LIKE '[FAILED]%' THEN left(message_text, 300) END,
  phone_e164 = private.wa_e164(phone_number)
WHERE status = 'legacy';

ALTER TABLE public.whatsapp_messages DROP CONSTRAINT IF EXISTS whatsapp_messages_status_chk;
ALTER TABLE public.whatsapp_messages ADD CONSTRAINT whatsapp_messages_status_chk CHECK (status IN (
  'legacy', 'queued', 'sending', 'accepted', 'sent', 'delivered', 'read', 'failed', 'failed_permanent', 'skipped',
  'received', 'processing', 'processed'));
ALTER TABLE public.whatsapp_messages DROP CONSTRAINT IF EXISTS whatsapp_messages_category_chk;
ALTER TABLE public.whatsapp_messages ADD CONSTRAINT whatsapp_messages_category_chk CHECK (
  category IS NULL OR category IN ('utility', 'marketing', 'service', 'authentication'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_msg_wamid ON public.whatsapp_messages (wamid) WHERE wamid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_msg_idem  ON public.whatsapp_messages (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wa_msg_queue    ON public.whatsapp_messages (next_attempt_at) WHERE status IN ('queued', 'received');
CREATE INDEX IF NOT EXISTS idx_wa_msg_leased   ON public.whatsapp_messages (locked_until)    WHERE status IN ('sending', 'processing');
CREATE INDEX IF NOT EXISTS idx_wa_msg_clientref ON public.whatsapp_messages (client_ref)     WHERE client_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wa_msg_phone_dir ON public.whatsapp_messages (phone_e164, direction, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_msg_campaign  ON public.whatsapp_messages (campaign_id) WHERE campaign_id IS NOT NULL;

-- the admin page reads this instead of parsing text prefixes
CREATE OR REPLACE VIEW public.whatsapp_message_log WITH (security_invoker = true) AS
SELECT m.*,
       CASE WHEN m.direction = 'inbound' THEN 'received'
            WHEN m.status IN ('failed', 'failed_permanent') THEN 'failed'
            WHEN m.status = 'read' THEN 'read'
            WHEN m.status = 'delivered' THEN 'delivered'
            WHEN m.status IN ('sent', 'accepted') THEN 'sent'
            WHEN m.status = 'skipped' THEN 'skipped'
            ELSE 'queued' END AS delivery_state
  FROM public.whatsapp_messages m;
GRANT SELECT ON public.whatsapp_message_log TO authenticated;

------------------------------------------------------------------------
-- 2. raw event inbox (unmatched statuses, forensic replay) — payload fragments only, no message bodies
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_events (
  id           BIGSERIAL PRIMARY KEY,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind         TEXT NOT NULL,                 -- status | signature_rejected | ...
  wamid        TEXT,
  client_ref   TEXT,
  event_key    TEXT NOT NULL,                 -- dedup: status + provider timestamp
  payload      JSONB,
  processed_at TIMESTAMPTZ,
  error        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_events_dedup ON public.whatsapp_events (kind, wamid, event_key) WHERE wamid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wa_events_pending ON public.whatsapp_events (wamid) WHERE processed_at IS NULL;

------------------------------------------------------------------------
-- 3. template registry (the ONLY source of template facts)
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  name           TEXT NOT NULL,
  language       TEXT NOT NULL,                              -- exact Meta code, e.g. en, en_US, hi, kn
  category       TEXT NOT NULL CHECK (category IN ('utility', 'marketing', 'authentication')),
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'paused', 'disabled')),
  body_params    INT  NOT NULL DEFAULT 0 CHECK (body_params >= 0),
  param_schema   JSONB NOT NULL DEFAULT '[]'::jsonb,          -- [{"name":"first_name","kind":"recipient_first_name","max":30}, ...]
  header_type    TEXT NOT NULL DEFAULT 'none' CHECK (header_type IN ('none', 'text', 'image', 'video', 'document')),
  enabled        BOOLEAN NOT NULL DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (name, language),
  CHECK (jsonb_array_length(param_schema) = body_params)
);
-- Seeds are 'pending' on purpose: only a sync with Meta (whatsapp-sync-templates) may mark a template approved.
INSERT INTO public.whatsapp_templates (name, language, category, body_params, param_schema, header_type) VALUES
  ('order_update', 'en', 'utility', 4,
   '[{"name":"first_name","kind":"recipient_first_name","max":30},{"name":"order_id","kind":"order_id","max":12},{"name":"status","kind":"order_status","max":20},{"name":"note","kind":"whitelisted_line","max":160}]', 'none'),
  ('cart_reminder', 'en', 'marketing', 2,
   '[{"name":"first_name","kind":"recipient_first_name","max":30},{"name":"item_count","kind":"item_count","max":4}]', 'none'),
  ('promo', 'en', 'marketing', 2,
   '[{"name":"first_name","kind":"recipient_first_name","max":30},{"name":"message","kind":"static","max":300}]', 'image')
ON CONFLICT (name, language) DO NOTHING;

------------------------------------------------------------------------
-- 4. consent: transactional and marketing are separate; every change is kept
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_consent (
  phone_e164 TEXT NOT NULL,
  scope      TEXT NOT NULL CHECK (scope IN ('transactional', 'marketing')),
  status     TEXT NOT NULL CHECK (status IN ('granted', 'revoked')),
  source     TEXT NOT NULL,                  -- profile | whatsapp_stop | whatsapp_start | admin | legacy_profile_flag
  user_id    UUID,
  evidence   JSONB,                          -- e.g. {"wamid":"..."}; never message bodies
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (phone_e164, scope)
);
CREATE TABLE IF NOT EXISTS public.whatsapp_consent_history (
  id         BIGSERIAL PRIMARY KEY,
  phone_e164 TEXT NOT NULL,
  scope      TEXT NOT NULL,
  status     TEXT NOT NULL,
  source     TEXT NOT NULL,
  evidence   JSONB,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION private.wa_history_append_only() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = ''
AS $$ BEGIN RAISE EXCEPTION 'whatsapp_consent_history is append-only' USING ERRCODE = '42501'; END $$;
DROP TRIGGER IF EXISTS trg_wa_consent_history_ro ON public.whatsapp_consent_history;
CREATE TRIGGER trg_wa_consent_history_ro BEFORE UPDATE OR DELETE ON public.whatsapp_consent_history
  FOR EACH ROW EXECUTE FUNCTION private.wa_history_append_only();

CREATE OR REPLACE FUNCTION public.wa_set_consent(
  p_phone TEXT, p_scope TEXT, p_status TEXT, p_source TEXT, p_evidence JSONB DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_phone TEXT := private.wa_e164(p_phone); v_old TEXT;
BEGIN
  IF v_phone IS NULL THEN RETURN false; END IF;
  SELECT status INTO v_old FROM public.whatsapp_consent WHERE phone_e164 = v_phone AND scope = p_scope;
  IF v_old IS NOT DISTINCT FROM p_status THEN RETURN false; END IF;              -- no change: nothing recorded, no trigger ping-pong
  INSERT INTO public.whatsapp_consent (phone_e164, scope, status, source, evidence, changed_at)
  VALUES (v_phone, p_scope, p_status, p_source, p_evidence, now())
  ON CONFLICT (phone_e164, scope) DO UPDATE
     SET status = EXCLUDED.status, source = EXCLUDED.source, evidence = EXCLUDED.evidence, changed_at = now();
  INSERT INTO public.whatsapp_consent_history (phone_e164, scope, status, source, evidence)
  VALUES (v_phone, p_scope, p_status, p_source, p_evidence);
  IF p_scope = 'marketing' THEN                                                  -- mirror to the profile flag the storefront reads
    UPDATE public.user_profiles
       SET whatsapp_marketing_opt_in = (p_status = 'granted'),
           marketing_opt_in_at = CASE WHEN p_status = 'granted' THEN now() ELSE marketing_opt_in_at END
     WHERE private.wa_e164(phone) = v_phone AND whatsapp_marketing_opt_in IS DISTINCT FROM (p_status = 'granted');
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.wa_set_consent(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_set_consent(TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;

-- the storefront toggles user_profiles.whatsapp_marketing_opt_in; record it as consent
CREATE OR REPLACE FUNCTION private.wa_profile_consent_sync() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.phone IS NOT NULL AND NEW.whatsapp_marketing_opt_in IS DISTINCT FROM OLD.whatsapp_marketing_opt_in THEN
    PERFORM public.wa_set_consent(NEW.phone, 'marketing', CASE WHEN NEW.whatsapp_marketing_opt_in THEN 'granted' ELSE 'revoked' END,
                                  'profile', jsonb_build_object('user_id', NEW.id));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_wa_profile_consent ON public.user_profiles;
CREATE TRIGGER trg_wa_profile_consent AFTER UPDATE OF whatsapp_marketing_opt_in ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION private.wa_profile_consent_sync();

-- existing marketing opt-ins keep working (explicitly granted before); everyone else has no marketing consent
INSERT INTO public.whatsapp_consent (phone_e164, scope, status, source, user_id, evidence, changed_at)
SELECT private.wa_e164(p.phone), 'marketing', 'granted', 'legacy_profile_flag', p.id, NULL, coalesce(p.marketing_opt_in_at, now())
  FROM public.user_profiles p
 WHERE p.whatsapp_marketing_opt_in AND private.wa_e164(p.phone) IS NOT NULL
ON CONFLICT (phone_e164, scope) DO NOTHING;
INSERT INTO public.whatsapp_consent_history (phone_e164, scope, status, source)
SELECT phone_e164, scope, status, source FROM public.whatsapp_consent c
 WHERE source = 'legacy_profile_flag' AND NOT EXISTS (SELECT 1 FROM public.whatsapp_consent_history h WHERE h.phone_e164 = c.phone_e164 AND h.scope = c.scope);

-- the single gate every send passes (at enqueue AND again at send time)
CREATE OR REPLACE FUNCTION public.wa_can_send(p_phone TEXT, p_category TEXT, p_order_id BIGINT DEFAULT NULL)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_phone TEXT := private.wa_e164(p_phone);
BEGIN
  IF v_phone IS NULL THEN RETURN 'invalid_phone'; END IF;
  IF p_category = 'marketing' THEN
    IF NOT EXISTS (SELECT 1 FROM public.whatsapp_consent WHERE phone_e164 = v_phone AND scope = 'marketing' AND status = 'granted')
      THEN RETURN 'no_marketing_consent'; END IF;
  ELSIF p_category IN ('utility', 'authentication') THEN
    IF EXISTS (SELECT 1 FROM public.whatsapp_consent WHERE phone_e164 = v_phone AND scope = 'transactional' AND status = 'revoked')
      THEN RETURN 'transactional_opted_out'; END IF;
    IF p_order_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id AND whatsapp_opt_in = false)
      THEN RETURN 'order_opted_out'; END IF;
  ELSIF p_category = 'service' THEN                                                -- free-form: only inside the 24h window
    IF NOT EXISTS (SELECT 1 FROM public.whatsapp_messages WHERE phone_e164 = v_phone AND direction = 'inbound'
                      AND sent_at > (now() - interval '24 hours')::timestamp)
      THEN RETURN 'outside_service_window'; END IF;
  ELSE RETURN 'bad_category'; END IF;
  RETURN 'ok';
END $$;
REVOKE ALL ON FUNCTION public.wa_can_send(TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_can_send(TEXT, TEXT, BIGINT) TO service_role;

------------------------------------------------------------------------
-- 5. queue API (all SECURITY DEFINER, service_role only)
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wa_enqueue(
  p_phone TEXT, p_category TEXT, p_message_type TEXT, p_template_name TEXT, p_template_language TEXT,
  p_params JSONB, p_text TEXT, p_idem TEXT, p_user UUID DEFAULT NULL, p_order BIGINT DEFAULT NULL,
  p_campaign BIGINT DEFAULT NULL, p_delay INTERVAL DEFAULT '0')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_phone TEXT := private.wa_e164(p_phone); v_gate TEXT; v_id BIGINT; v_status TEXT := 'queued';
BEGIN
  IF p_idem IS NULL OR length(p_idem) < 3 THEN RAISE EXCEPTION 'idempotency key required'; END IF;
  IF p_template_name IS NULL AND p_category <> 'service' THEN RAISE EXCEPTION 'free text is allowed only in the service window'; END IF;
  v_gate := public.wa_can_send(p_phone, p_category, p_order);
  IF v_gate <> 'ok' THEN v_status := 'skipped'; END IF;
  INSERT INTO public.whatsapp_messages (user_id, order_id, message_type, phone_number, phone_e164, message_text, direction,
        category, content_type, template_name, template_language, template_params, status, error_message,
        idempotency_key, client_ref, next_attempt_at, campaign_id)
  VALUES (p_user, p_order, p_message_type, coalesce(v_phone, left(coalesce(p_phone, ''), 20)), v_phone, p_text, 'outbound',
        p_category, CASE WHEN p_template_name IS NULL THEN 'text' ELSE 'template' END, p_template_name, p_template_language,
        p_params, v_status, CASE WHEN v_status = 'skipped' THEN v_gate END,
        p_idem, 'wa-' || md5(p_idem), now() + p_delay, p_campaign)
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'duplicate', v_id IS NULL, 'status', CASE WHEN v_id IS NULL THEN NULL ELSE v_status END, 'gate', v_gate);
END $$;
REVOKE ALL ON FUNCTION public.wa_enqueue(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, UUID, BIGINT, BIGINT, INTERVAL) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_enqueue(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, UUID, BIGINT, BIGINT, INTERVAL) TO service_role;

-- stale leases: a worker died mid-job
CREATE OR REPLACE FUNCTION public.wa_requeue_stale()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r RECORD; n INT := 0; v_ev RECORD;
BEGIN
  FOR r IN SELECT * FROM public.whatsapp_messages WHERE status IN ('sending', 'processing') AND locked_until < now() FOR UPDATE SKIP LOCKED LOOP
    IF r.status = 'sending' THEN
      -- did Meta already tell us about it (status webhook carrying our client_ref)? then it WAS sent: link, do not resend
      SELECT * INTO v_ev FROM public.whatsapp_events WHERE client_ref = r.client_ref AND wamid IS NOT NULL ORDER BY id LIMIT 1;
      IF FOUND THEN
        UPDATE public.whatsapp_messages SET wamid = v_ev.wamid, status = 'accepted', accepted_at = coalesce(accepted_at, now()),
               locked_until = NULL, error_message = 'recovered from status webhook (response was lost)' WHERE id = r.id;
        PERFORM public.wa_apply_pending_events(v_ev.wamid);
        n := n + 1; CONTINUE;
      END IF;
    END IF;
    IF r.attempt_count >= r.max_attempts THEN
      UPDATE public.whatsapp_messages SET status = 'failed_permanent', failed_at = now(), locked_until = NULL,
             error_message = 'lease expired and attempts exhausted', error_retryable = false WHERE id = r.id;
      PERFORM private.raise_ops_event('warning', 'whatsapp-worker', 'whatsapp_job_failed',
        'A WhatsApp job failed permanently (worker crashed repeatedly)', 'whatsapp_message', r.id, jsonb_build_object('direction', r.direction));
    ELSE
      UPDATE public.whatsapp_messages SET status = CASE WHEN r.status = 'sending' THEN 'queued' ELSE 'received' END,
             locked_until = NULL, next_attempt_at = now() + private.wa_backoff(r.attempt_count),
             error_message = 'lease expired; requeued' WHERE id = r.id;
    END IF;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.wa_requeue_stale() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_requeue_stale() TO service_role;

-- claim a batch: inbound jobs first, then transactional/service, marketing last and capped (rate control)
CREATE OR REPLACE FUNCTION public.wa_claim_batch(p_limit INT DEFAULT 20, p_marketing_limit INT DEFAULT 10, p_lease_secs INT DEFAULT 120)
RETURNS SETOF public.whatsapp_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_paused BOOLEAN := coalesce((SELECT (value->>'paused')::boolean FROM public.site_settings WHERE key = 'whatsapp_queue'), false);
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT m.id,
           CASE WHEN m.direction = 'inbound' THEN 0 WHEN m.category = 'marketing' THEN 2 ELSE 1 END AS prio,
           row_number() OVER (PARTITION BY (m.category = 'marketing') ORDER BY m.next_attempt_at, m.id) AS rn_in_class,
           m.next_attempt_at
      FROM public.whatsapp_messages m
     WHERE m.status IN ('queued', 'received') AND m.next_attempt_at <= now() AND m.category IS NOT NULL
       AND (m.direction = 'inbound' OR NOT v_paused)
  ), pick AS (
    SELECT d.id FROM due d
     WHERE (d.prio < 2 OR d.rn_in_class <= p_marketing_limit)
     ORDER BY d.prio, d.next_attempt_at, d.id
     LIMIT p_limit
  ), locked AS (
    SELECT m.id FROM public.whatsapp_messages m JOIN pick USING (id) FOR UPDATE OF m SKIP LOCKED
  )
  UPDATE public.whatsapp_messages m
     SET status = CASE WHEN m.direction = 'inbound' THEN 'processing' ELSE 'sending' END,
         locked_until = now() + make_interval(secs => p_lease_secs),
         attempt_count = m.attempt_count + 1, last_attempt_at = now()
    FROM locked WHERE m.id = locked.id
  RETURNING m.*;
END $$;
REVOKE ALL ON FUNCTION public.wa_claim_batch(INT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_claim_batch(INT, INT, INT) TO service_role;

-- outcome of an outbound send
CREATE OR REPLACE FUNCTION public.wa_mark_accepted(p_id BIGINT, p_wamid TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.whatsapp_messages SET wamid = p_wamid, status = 'accepted', accepted_at = now(), locked_until = NULL,
         error_code = NULL, error_message = NULL, error_retryable = NULL
   WHERE id = p_id AND status = 'sending';
  PERFORM public.wa_apply_pending_events(p_wamid);        -- a status webhook may have beaten us to it
END $$;

CREATE OR REPLACE FUNCTION public.wa_mark_failure(p_id BIGINT, p_code INT, p_message TEXT, p_retryable BOOLEAN)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.whatsapp_messages%ROWTYPE; v_new TEXT;
BEGIN
  SELECT * INTO r FROM public.whatsapp_messages WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'missing'; END IF;
  IF p_code = 190 THEN                       -- token invalid: pause the queue, do not burn the attempt
    UPDATE public.whatsapp_messages SET status = 'queued', attempt_count = greatest(attempt_count - 1, 0), locked_until = NULL,
           next_attempt_at = now() + interval '15 minutes', error_code = p_code, error_message = left(p_message, 500), error_retryable = true
     WHERE id = p_id;
    PERFORM public.wa_pause_queue('Meta rejected the access token (190)');
    RETURN 'paused';
  END IF;
  IF p_retryable AND r.attempt_count < r.max_attempts THEN
    UPDATE public.whatsapp_messages SET status = 'queued', locked_until = NULL, next_attempt_at = now() + private.wa_backoff(r.attempt_count),
           error_code = p_code, error_message = left(p_message, 500), error_retryable = true WHERE id = p_id;
    RETURN 'retry';
  END IF;
  UPDATE public.whatsapp_messages SET status = 'failed_permanent', failed_at = now(), locked_until = NULL,
         error_code = p_code, error_message = left(p_message, 500), error_retryable = false WHERE id = p_id;
  PERFORM private.raise_ops_event('warning', 'whatsapp-worker', 'whatsapp_send_failed',
    'A WhatsApp message could not be sent', 'whatsapp_message', p_id,
    jsonb_build_object('code', p_code, 'category', r.category, 'template', r.template_name, 'attempts', r.attempt_count));
  RETURN 'failed_permanent';
END $$;

CREATE OR REPLACE FUNCTION public.wa_mark_skipped(p_id BIGINT, p_reason TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$ UPDATE public.whatsapp_messages SET status = 'skipped', locked_until = NULL, error_message = left(p_reason, 500) WHERE id = p_id $$;

CREATE OR REPLACE FUNCTION public.wa_mark_processed(p_id BIGINT, p_status TEXT, p_ai_meta JSONB DEFAULT NULL, p_error TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$ UPDATE public.whatsapp_messages SET status = p_status, locked_until = NULL, ai_meta = coalesce(p_ai_meta, ai_meta),
         error_message = left(p_error, 500) WHERE id = p_id AND direction = 'inbound' $$;

-- inbound job failed (bug, outage): retry with backoff, finally park it and tell the admin
CREATE OR REPLACE FUNCTION public.wa_inbound_retry(p_id BIGINT, p_error TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.whatsapp_messages%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.whatsapp_messages WHERE id = p_id FOR UPDATE;
  IF r.attempt_count < r.max_attempts THEN
    UPDATE public.whatsapp_messages SET status = 'received', locked_until = NULL, next_attempt_at = now() + private.wa_backoff(r.attempt_count),
           error_message = left(p_error, 500) WHERE id = p_id;
    RETURN 'retry';
  END IF;
  UPDATE public.whatsapp_messages SET status = 'failed_permanent', failed_at = now(), locked_until = NULL, error_message = left(p_error, 500) WHERE id = p_id;
  PERFORM private.raise_ops_event('warning', 'whatsapp-worker', 'whatsapp_job_failed', 'An inbound WhatsApp message could not be processed',
                                  'whatsapp_message', p_id, NULL);
  RETURN 'failed_permanent';
END $$;

CREATE OR REPLACE FUNCTION public.wa_raise_needs_human(p_msg_id BIGINT, p_reason TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$ SELECT private.raise_ops_event('warning', 'whatsapp-ai', 'whatsapp_needs_human',
         'A WhatsApp customer needs a person: ' || left(coalesce(p_reason, 'escalated'), 120), 'whatsapp_message', p_msg_id, NULL) $$;
REVOKE ALL ON FUNCTION public.wa_raise_needs_human(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_raise_needs_human(BIGINT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.wa_ops_event(p_severity TEXT, p_code TEXT, p_message TEXT, p_entity TEXT, p_entity_id BIGINT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$ SELECT private.raise_ops_event(p_severity, 'whatsapp', p_code, left(p_message, 300), p_entity, p_entity_id, NULL) $$;
REVOKE ALL ON FUNCTION public.wa_ops_event(TEXT, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_ops_event(TEXT, TEXT, TEXT, TEXT, BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.wa_pause_queue(p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.site_settings (key, value) VALUES ('whatsapp_queue', jsonb_build_object('paused', true, 'reason', p_reason, 'at', now()))
  ON CONFLICT (key) DO UPDATE SET value = coalesce(public.site_settings.value, '{}'::jsonb) || jsonb_build_object('paused', true, 'reason', p_reason, 'at', now());
  PERFORM private.raise_ops_event('critical', 'whatsapp-worker', 'whatsapp_queue_paused',
    'The outbound WhatsApp queue is paused: ' || p_reason, 'whatsapp_queue', 1, NULL);
END $$;

CREATE OR REPLACE FUNCTION public.wa_resume_queue()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN RAISE EXCEPTION 'admin only' USING ERRCODE = '42501'; END IF;
  UPDATE public.site_settings SET value = coalesce(value, '{}'::jsonb) || '{"paused": false}'::jsonb WHERE key = 'whatsapp_queue';
  PERFORM private.resolve_ops_events('whatsapp_queue_paused', 'whatsapp_queue', 1);
END $$;

REVOKE ALL ON FUNCTION public.wa_mark_accepted(BIGINT, TEXT), public.wa_mark_failure(BIGINT, INT, TEXT, BOOLEAN),
  public.wa_mark_skipped(BIGINT, TEXT), public.wa_mark_processed(BIGINT, TEXT, JSONB, TEXT), public.wa_inbound_retry(BIGINT, TEXT),
  public.wa_pause_queue(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_mark_accepted(BIGINT, TEXT), public.wa_mark_failure(BIGINT, INT, TEXT, BOOLEAN),
  public.wa_mark_skipped(BIGINT, TEXT), public.wa_mark_processed(BIGINT, TEXT, JSONB, TEXT), public.wa_inbound_retry(BIGINT, TEXT),
  public.wa_pause_queue(TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.wa_resume_queue() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_resume_queue() TO authenticated, service_role;

------------------------------------------------------------------------
-- 6. inbound: atomic dedup on wamid
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wa_record_inbound(
  p_wamid TEXT, p_phone TEXT, p_text TEXT, p_type TEXT, p_media JSONB DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id BIGINT; v_phone TEXT := private.wa_e164(p_phone);
BEGIN
  IF p_wamid IS NULL OR length(p_wamid) < 5 THEN RAISE EXCEPTION 'wamid required'; END IF;
  INSERT INTO public.whatsapp_messages (message_type, phone_number, phone_e164, message_text, direction, category, content_type,
        media_meta, wamid, status, next_attempt_at, user_id)
  VALUES ('customer_inbound', coalesce(v_phone, left(coalesce(p_phone, ''), 20)), v_phone, left(p_text, 4000), 'inbound', 'service',
        left(coalesce(p_type, 'unknown'), 30), p_media, p_wamid, 'received', now(),
        (SELECT id FROM public.user_profiles WHERE private.wa_e164(phone) = v_phone LIMIT 1))
  ON CONFLICT (wamid) WHERE wamid IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'duplicate', v_id IS NULL);
END $$;
REVOKE ALL ON FUNCTION public.wa_record_inbound(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_record_inbound(TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;

------------------------------------------------------------------------
-- 7. delivery status: monotonic, idempotent, order-independent
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.wa_rank(p_status TEXT) RETURNS INT LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT CASE p_status WHEN 'accepted' THEN 1 WHEN 'sent' THEN 2 WHEN 'delivered' THEN 3 WHEN 'read' THEN 4 ELSE 0 END $$;

CREATE OR REPLACE FUNCTION public.wa_apply_status(
  p_wamid TEXT, p_status TEXT, p_ts TIMESTAMPTZ, p_client_ref TEXT DEFAULT NULL,
  p_error_code INT DEFAULT NULL, p_error_message TEXT DEFAULT NULL)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.whatsapp_messages%ROWTYPE; v_key TEXT := p_status || ':' || coalesce(extract(epoch FROM p_ts)::bigint::text, '0');
        v_ts TIMESTAMPTZ := coalesce(p_ts, now());
BEGIN
  IF p_status NOT IN ('sent', 'delivered', 'read', 'failed') THEN RETURN 'ignored_unknown_status'; END IF;
  SELECT * INTO r FROM public.whatsapp_messages WHERE wamid = p_wamid AND direction = 'outbound' FOR UPDATE;
  IF NOT FOUND THEN
    -- not linked yet (we have not saved the wamid, or the response was lost): park it; wa_mark_accepted / wa_requeue_stale replay it
    INSERT INTO public.whatsapp_events (kind, wamid, client_ref, event_key, payload)
    VALUES ('status', p_wamid, p_client_ref, v_key,
            jsonb_build_object('status', p_status, 'ts', v_ts, 'error_code', p_error_code, 'error_message', left(p_error_message, 300)))
    ON CONFLICT (kind, wamid, event_key) WHERE wamid IS NOT NULL DO NOTHING;
    RETURN 'parked';
  END IF;

  IF p_status = 'failed' THEN
    IF r.status IN ('delivered', 'read') THEN RETURN 'ignored_already_delivered'; END IF;
    UPDATE public.whatsapp_messages SET status = 'failed', failed_at = coalesce(failed_at, v_ts), error_code = p_error_code,
           error_message = left(p_error_message, 500), error_retryable = false WHERE id = r.id AND status <> 'failed';
    IF FOUND THEN
      PERFORM private.raise_ops_event('warning', 'whatsapp-status', 'whatsapp_delivery_failed', 'WhatsApp reported a delivery failure',
                                      'whatsapp_message', r.id, jsonb_build_object('code', p_error_code));
      RETURN 'updated';
    END IF;
    RETURN 'ignored_duplicate';
  END IF;

  -- timestamps are always filled (late events still teach us the timeline); the headline status only moves forward
  UPDATE public.whatsapp_messages SET
         provider_sent_at = CASE WHEN p_status = 'sent' THEN coalesce(provider_sent_at, v_ts) ELSE provider_sent_at END,
         delivered_at     = CASE WHEN p_status = 'delivered' THEN coalesce(delivered_at, v_ts) ELSE delivered_at END,
         read_at          = CASE WHEN p_status = 'read' THEN coalesce(read_at, v_ts) ELSE read_at END,
         status           = CASE WHEN private.wa_rank(p_status) > private.wa_rank(status) AND status NOT IN ('failed', 'failed_permanent')
                                 THEN p_status ELSE status END
   WHERE id = r.id;
  RETURN CASE WHEN private.wa_rank(p_status) > private.wa_rank(r.status) THEN 'updated' ELSE 'ignored_not_newer' END;
END $$;

CREATE OR REPLACE FUNCTION public.wa_apply_pending_events(p_wamid TEXT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE e RECORD; n INT := 0;
BEGIN
  FOR e IN SELECT * FROM public.whatsapp_events WHERE wamid = p_wamid AND processed_at IS NULL AND kind = 'status' ORDER BY (payload->>'ts')::timestamptz, id LOOP
    PERFORM public.wa_apply_status(p_wamid, e.payload->>'status', (e.payload->>'ts')::timestamptz, e.client_ref,
            (e.payload->>'error_code')::int, e.payload->>'error_message');
    UPDATE public.whatsapp_events SET processed_at = now() WHERE id = e.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- link a parked status to its row by our own reference when Meta echoed it
CREATE OR REPLACE FUNCTION public.wa_link_by_client_ref(p_client_ref TEXT, p_wamid TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.whatsapp_messages SET wamid = p_wamid, status = CASE WHEN status IN ('sending', 'queued') THEN 'accepted' ELSE status END,
         accepted_at = coalesce(accepted_at, now()), locked_until = NULL
   WHERE client_ref = p_client_ref AND wamid IS NULL AND direction = 'outbound' AND status IN ('sending', 'queued');
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.wa_apply_status(TEXT, TEXT, TIMESTAMPTZ, TEXT, INT, TEXT), public.wa_apply_pending_events(TEXT),
  public.wa_link_by_client_ref(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_apply_status(TEXT, TEXT, TIMESTAMPTZ, TEXT, INT, TEXT), public.wa_apply_pending_events(TEXT),
  public.wa_link_by_client_ref(TEXT, TEXT) TO service_role;

------------------------------------------------------------------------
-- 8. order updates ENQUEUE (a failed send is retried, never lost); whatsapp-notify is retired
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.enqueue_order_whatsapp(p_order_id BIGINT, p_status TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE o public.orders%ROWTYPE; s JSONB; v_line TEXT; v_first TEXT;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT value INTO s FROM public.site_settings WHERE key = 'message_settings';
  v_line := CASE p_status
              WHEN 'confirmed' THEN coalesce(s->>'status_confirmed', 'We are preparing it for dispatch.')
              WHEN 'shipped'   THEN CASE WHEN o.courier IS NOT NULL OR o.tracking_number IS NOT NULL
                                         THEN 'Courier: ' || coalesce(o.courier, '-') || ', tracking no ' || coalesce(o.tracking_number, '-') || '.'
                                         ELSE coalesce(s->>'status_shipped', 'It is on the way!') END
              WHEN 'delivered' THEN coalesce(s->>'status_delivered', 'We hope everything arrived in perfect condition.')
              WHEN 'cancelled' THEN coalesce(s->>'status_cancelled', 'If you were charged, the amount will be refunded.') END;
  v_first := coalesce(nullif(split_part(coalesce(o.shipping_name, ''), ' ', 1), ''), 'there');
  PERFORM public.wa_enqueue(o.shipping_phone, 'utility', 'order_' || p_status, 'order_update', 'en',
            jsonb_build_array(v_first, o.id::text, p_status, v_line),
            'Hi ' || v_first || ', your Dia Shoppe order #' || o.id || ' is now ' || p_status || '. ' || v_line || ' Thank you for shopping with us!',
            'order:' || o.id || ':' || p_status, o.user_id, o.id);
END $$;
REVOKE ALL ON FUNCTION private.enqueue_order_whatsapp(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_whatsapp_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.status IN ('confirmed', 'shipped', 'delivered', 'cancelled') THEN
    BEGIN
      PERFORM private.enqueue_order_whatsapp(NEW.id, NEW.status);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'whatsapp enqueue failed for order % (%): %', NEW.id, NEW.status, SQLERRM;   -- never block an order update
    END;
  END IF;
  RETURN NEW;
END $$;

------------------------------------------------------------------------
-- 9. campaigns: admin -> audience (structured, server-resolved) -> AI copy SUGGESTION -> admin approval -> template -> queue
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_campaigns (
  id                BIGSERIAL PRIMARY KEY,
  name              TEXT NOT NULL,
  template_name     TEXT NOT NULL,
  template_language TEXT NOT NULL,
  audience          JSONB NOT NULL,                       -- whitelisted filter, never a list of phones chosen by anyone but the resolver
  variables         JSONB,                                -- the ADMIN-approved static variable values {"message": "..."}
  image_url         TEXT,
  ai_copy           JSONB,                                -- suggestions only: {"suggestions":[...],"provider":"..","model":"..","at":".."}
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'copy_ready', 'approved', 'cancelled')),
  recipients_count  INT,
  created_by        UUID,
  approved_by       UUID,
  approved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (template_name, template_language) REFERENCES public.whatsapp_templates (name, language)
);
ALTER TABLE public.whatsapp_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_consent ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_consent_history ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['whatsapp_campaigns', 'whatsapp_events', 'whatsapp_templates', 'whatsapp_consent', 'whatsapp_consent_history'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Admins read %1$s" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "Admins read %1$s" ON public.%1$I FOR SELECT USING (public.is_admin())', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;

CREATE OR REPLACE VIEW public.whatsapp_campaign_stats WITH (security_invoker = true) AS
SELECT c.id AS campaign_id, c.name, c.status, c.recipients_count,
       count(m.id) FILTER (WHERE m.status = 'queued' OR m.status = 'sending')                 AS pending,
       count(m.id) FILTER (WHERE m.status IN ('accepted', 'sent', 'delivered', 'read'))       AS sent,
       count(m.id) FILTER (WHERE m.status IN ('delivered', 'read'))                           AS delivered,
       count(m.id) FILTER (WHERE m.status = 'read')                                           AS read,
       count(m.id) FILTER (WHERE m.status IN ('failed', 'failed_permanent'))                  AS failed,
       count(m.id) FILTER (WHERE m.status = 'skipped')                                        AS skipped
  FROM public.whatsapp_campaigns c LEFT JOIN public.whatsapp_messages m ON m.campaign_id = c.id
 GROUP BY c.id;
GRANT SELECT ON public.whatsapp_campaign_stats TO authenticated;

-- audience resolver: ONLY these keys, ALWAYS joined with marketing consent. Nothing else can add a recipient.
CREATE OR REPLACE FUNCTION private.wa_campaign_audience(p_audience JSONB)
RETURNS TABLE (phone_e164 TEXT, user_id UUID, first_name TEXT) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE k TEXT; v_min INT := coalesce((p_audience->>'min_orders')::int, 0); v_days INT := (p_audience->>'last_order_within_days')::int;
        v_limit INT := least(coalesce((p_audience->>'limit')::int, 1000), 1000);
BEGIN
  FOR k IN SELECT jsonb_object_keys(p_audience) LOOP
    IF k NOT IN ('segment', 'min_orders', 'last_order_within_days', 'limit') THEN RAISE EXCEPTION 'unknown audience key %', k; END IF;
  END LOOP;
  IF coalesce(p_audience->>'segment', 'all_opted_in') NOT IN ('all_opted_in', 'past_customers') THEN RAISE EXCEPTION 'unknown segment'; END IF;
  RETURN QUERY
  SELECT private.wa_e164(p.phone), p.id, p.first_name
    FROM public.user_profiles p
    JOIN public.whatsapp_consent c ON c.phone_e164 = private.wa_e164(p.phone) AND c.scope = 'marketing' AND c.status = 'granted'
   WHERE private.wa_e164(p.phone) IS NOT NULL AND p.role = 'customer' AND coalesce(p.is_active, true)
     AND (v_min = 0 OR (SELECT count(*) FROM public.orders o WHERE o.user_id = p.id AND o.status IN ('confirmed', 'shipped', 'delivered')) >= v_min)
     AND (v_days IS NULL OR EXISTS (SELECT 1 FROM public.orders o WHERE o.user_id = p.id AND o.created_at > now() - make_interval(days => v_days)))
   ORDER BY p.id LIMIT v_limit;
END $$;
REVOKE ALL ON FUNCTION private.wa_campaign_audience(JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.wa_create_campaign(p_name TEXT, p_template TEXT, p_language TEXT, p_audience JSONB, p_image_url TEXT DEFAULT NULL)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id BIGINT; t public.whatsapp_templates%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO t FROM public.whatsapp_templates WHERE name = p_template AND language = p_language;
  IF NOT FOUND OR t.category <> 'marketing' THEN RAISE EXCEPTION 'campaigns require a registered MARKETING template'; END IF;
  PERFORM 1 FROM private.wa_campaign_audience(p_audience);               -- validates the audience spec
  INSERT INTO public.whatsapp_campaigns (name, template_name, template_language, audience, image_url, created_by)
  VALUES (left(p_name, 120), p_template, p_language, p_audience, p_image_url, auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- the admin writes the final wording (optionally starting from an AI suggestion); this is the human approval of the CONTENT
CREATE OR REPLACE FUNCTION public.wa_set_campaign_variables(p_id BIGINT, p_variables JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE c public.whatsapp_campaigns%ROWTYPE; t public.whatsapp_templates%ROWTYPE; e JSONB;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.whatsapp_campaigns WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR c.status NOT IN ('draft', 'copy_ready') THEN RAISE EXCEPTION 'campaign not editable'; END IF;
  SELECT * INTO t FROM public.whatsapp_templates WHERE name = c.template_name AND language = c.template_language;
  FOR e IN SELECT * FROM jsonb_array_elements(t.param_schema) LOOP
    IF e->>'kind' = 'static' THEN
      IF coalesce(p_variables->>(e->>'name'), '') = '' THEN RAISE EXCEPTION 'variable % is required', e->>'name'; END IF;
      IF length(p_variables->>(e->>'name')) > (e->>'max')::int THEN RAISE EXCEPTION 'variable % is longer than %', e->>'name', e->>'max'; END IF;
    END IF;
  END LOOP;
  UPDATE public.whatsapp_campaigns SET variables = p_variables, status = 'copy_ready' WHERE id = p_id;
END $$;

CREATE OR REPLACE FUNCTION public.wa_approve_campaign(p_id BIGINT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE c public.whatsapp_campaigns%ROWTYPE; t public.whatsapp_templates%ROWTYPE; r RECORD; v_params JSONB; v_res JSONB; v_n INT := 0;
        v_per_min INT := coalesce((SELECT (value->>'marketing_per_minute')::int FROM public.site_settings WHERE key = 'whatsapp_queue'), 30);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'a logged-in admin must approve a campaign' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.whatsapp_campaigns WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR c.status <> 'copy_ready' THEN RAISE EXCEPTION 'campaign must have approved copy (status copy_ready)'; END IF;
  SELECT * INTO t FROM public.whatsapp_templates WHERE name = c.template_name AND language = c.template_language;
  IF t.status <> 'approved' OR NOT t.enabled OR t.category <> 'marketing' THEN RAISE EXCEPTION 'template is not an approved, enabled marketing template'; END IF;
  IF t.header_type = 'image' AND coalesce(c.image_url, '') = '' THEN RAISE EXCEPTION 'this template needs an image'; END IF;
  FOR r IN SELECT * FROM private.wa_campaign_audience(c.audience) LOOP
    SELECT coalesce(jsonb_agg(CASE x.pe->>'kind' WHEN 'recipient_first_name' THEN to_jsonb(coalesce(nullif(r.first_name, ''), 'there'))
                                                 WHEN 'static' THEN to_jsonb(c.variables->>(x.pe->>'name'))
                                                 ELSE to_jsonb(''::text) END ORDER BY x.ord), '[]'::jsonb)
      INTO v_params FROM jsonb_array_elements(t.param_schema) WITH ORDINALITY AS x(pe, ord);
    v_res := public.wa_enqueue(r.phone_e164, 'marketing', 'campaign', c.template_name, c.template_language, v_params,
          c.variables::text, 'campaign:' || c.id || ':' || r.phone_e164, r.user_id, NULL, c.id, make_interval(mins => v_n / greatest(v_per_min, 1)));
    IF (v_res->>'duplicate')::boolean IS NOT TRUE THEN
      v_n := v_n + 1;
      IF t.header_type = 'image' THEN
        UPDATE public.whatsapp_messages SET media_meta = jsonb_build_object('header_image_url', c.image_url) WHERE id = (v_res->>'id')::bigint;
      END IF;
    END IF;
  END LOOP;
  UPDATE public.whatsapp_campaigns SET status = 'approved', approved_by = auth.uid(), approved_at = now(), recipients_count = v_n WHERE id = p_id;
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION public.wa_cancel_campaign(p_id BIGINT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_n INT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only' USING ERRCODE = '42501'; END IF;
  UPDATE public.whatsapp_campaigns SET status = 'cancelled' WHERE id = p_id;
  UPDATE public.whatsapp_messages SET status = 'skipped', error_message = 'campaign cancelled' WHERE campaign_id = p_id AND status = 'queued';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.wa_create_campaign(TEXT, TEXT, TEXT, JSONB, TEXT), public.wa_set_campaign_variables(BIGINT, JSONB),
  public.wa_approve_campaign(BIGINT), public.wa_cancel_campaign(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_create_campaign(TEXT, TEXT, TEXT, JSONB, TEXT), public.wa_set_campaign_variables(BIGINT, JSONB),
  public.wa_approve_campaign(BIGINT), public.wa_cancel_campaign(BIGINT) TO authenticated;

------------------------------------------------------------------------
-- 10. AI runtime state: spend cap + circuit breaker (shared across Edge invocations)
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_usage_daily (
  day DATE PRIMARY KEY, calls INT NOT NULL DEFAULT 0, failures INT NOT NULL DEFAULT 0,
  input_tokens BIGINT NOT NULL DEFAULT 0, output_tokens BIGINT NOT NULL DEFAULT 0, cost_micro_usd BIGINT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS public.ai_circuit (
  id INT PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL DEFAULT 'closed' CHECK (state IN ('closed', 'open')),
  consecutive_failures INT NOT NULL DEFAULT 0, opened_until TIMESTAMPTZ, last_error TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
INSERT INTO public.ai_circuit (id) VALUES (1) ON CONFLICT DO NOTHING;
ALTER TABLE public.ai_usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_circuit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage_daily, public.ai_circuit FROM anon, authenticated;
GRANT ALL ON public.ai_usage_daily, public.ai_circuit TO service_role;
DROP POLICY IF EXISTS "Admins read ai_usage" ON public.ai_usage_daily;
CREATE POLICY "Admins read ai_usage" ON public.ai_usage_daily FOR SELECT USING (public.is_admin());
GRANT SELECT ON public.ai_usage_daily TO authenticated;

CREATE OR REPLACE FUNCTION public.ai_gate()          -- may we call the model right now?
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT jsonb_build_object(
  'circuit_open', coalesce((SELECT state = 'open' AND opened_until > now() FROM public.ai_circuit WHERE id = 1), false),
  'spent_micro_usd', coalesce((SELECT cost_micro_usd FROM public.ai_usage_daily WHERE day = (now() AT TIME ZONE 'UTC')::date), 0)) $$;

CREATE OR REPLACE FUNCTION public.ai_record(p_ok BOOLEAN, p_in BIGINT, p_out BIGINT, p_cost_micro BIGINT, p_error TEXT DEFAULT NULL,
                                            p_fail_threshold INT DEFAULT 5, p_open_secs INT DEFAULT 120)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.ai_usage_daily (day, calls, failures, input_tokens, output_tokens, cost_micro_usd)
  VALUES ((now() AT TIME ZONE 'UTC')::date, 1, CASE WHEN p_ok THEN 0 ELSE 1 END, coalesce(p_in, 0), coalesce(p_out, 0), coalesce(p_cost_micro, 0))
  ON CONFLICT (day) DO UPDATE SET calls = ai_usage_daily.calls + 1, failures = ai_usage_daily.failures + EXCLUDED.failures,
     input_tokens = ai_usage_daily.input_tokens + EXCLUDED.input_tokens, output_tokens = ai_usage_daily.output_tokens + EXCLUDED.output_tokens,
     cost_micro_usd = ai_usage_daily.cost_micro_usd + EXCLUDED.cost_micro_usd;
  IF p_ok THEN
    UPDATE public.ai_circuit SET state = 'closed', consecutive_failures = 0, opened_until = NULL, updated_at = now() WHERE id = 1;
  ELSE
    UPDATE public.ai_circuit SET consecutive_failures = consecutive_failures + 1, last_error = left(p_error, 300), updated_at = now(),
           state = CASE WHEN consecutive_failures + 1 >= p_fail_threshold THEN 'open' ELSE state END,
           opened_until = CASE WHEN consecutive_failures + 1 >= p_fail_threshold THEN now() + make_interval(secs => p_open_secs) ELSE opened_until END
     WHERE id = 1;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.ai_gate(), public.ai_record(BOOLEAN, BIGINT, BIGINT, BIGINT, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_gate(), public.ai_record(BOOLEAN, BIGINT, BIGINT, BIGINT, TEXT, INT, INT) TO service_role;

------------------------------------------------------------------------
-- 11. cron: worker every minute, template sync daily (secrets from Vault; nothing in the schedule text)
------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'hook_whatsapp_worker') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'hook_whatsapp_worker',
      'Shared secret between pg_cron and the whatsapp-worker / whatsapp-sync-templates Edge Functions');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.wa_call_function(p_slug TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_url TEXT := private.project_url();
BEGIN
  IF v_url IS NULL THEN RAISE WARNING 'project_url missing in Vault; % not called', p_slug; RETURN; END IF;
  PERFORM net.http_post(url := v_url || '/functions/v1/' || p_slug,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', private.hook_secret('hook_whatsapp_worker')),
    body := '{}'::jsonb, timeout_milliseconds := 55000);
END $$;
REVOKE ALL ON FUNCTION private.wa_call_function(TEXT) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('whatsapp-worker', 'whatsapp-sync-templates');
  PERFORM cron.schedule('whatsapp-worker', '* * * * *', $c$select private.wa_call_function('whatsapp-worker')$c$);
  PERFORM cron.schedule('whatsapp-sync-templates', '0 2 * * *', $c$select private.wa_call_function('whatsapp-sync-templates')$c$);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'pg_cron not scheduled (%): enable pg_cron and schedule whatsapp-worker every minute', SQLERRM;
END $$;
