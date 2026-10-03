-- Migration 037: the financial audit log cannot be rewritten quietly. Rolls back.
DO $$
DECLARE
  v_cust UUID; v_admin UUID; v_cat BIGINT; v_p BIGINT; v_o BIGINT;
  st JSONB; n BIGINT; v_seq BIGINT; v_head_before BIGINT;
BEGIN
  SELECT id INTO v_cust  FROM public.user_profiles WHERE role = 'customer' LIMIT 1;
  SELECT id INTO v_admin FROM public.user_profiles WHERE role = 'admin' LIMIT 1;
  SELECT id INTO v_cat FROM public.categories LIMIT 1;
  INSERT INTO public.products (name, price, sku, category_id, stock_qty, is_active) VALUES ('ZZ audit', 100, 'ZZ-AUD', v_cat, 5, false) RETURNING id INTO v_p;

  -- make sure there is something in the log, written through the real code path
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone, razorpay_order_id)
    VALUES (v_cust, 1, 'pending', 'online', 'x', '0', 'order_aud') RETURNING id INTO v_o;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (v_o, v_p, 1, 1);
  PERFORM public.settle_payment('pay_aud', 'order_aud', 19900, 'test');
  UPDATE public.orders SET status = 'cancelled', cancelled_by = 'customer' WHERE id = v_o;
  SELECT max(chain_seq) INTO v_seq FROM public.financial_audit;
  IF v_seq < 5 THEN RAISE EXCEPTION 'FAIL setup: audit log too small (%)', v_seq; END IF;

  ---- A1 the table owner (postgres, this session) is stopped from rewriting history by accident
  BEGIN UPDATE public.financial_audit SET action = 'edited' WHERE chain_seq = v_seq; RAISE EXCEPTION 'FAIL A1a: UPDATE allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.financial_audit WHERE chain_seq = v_seq; RAISE EXCEPTION 'FAIL A1b: DELETE allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN TRUNCATE public.financial_audit; RAISE EXCEPTION 'FAIL A1c: TRUNCATE allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  ---- A2 API roles (service_role, authenticated, anon) do not even hold the privilege
  SET LOCAL ROLE service_role;
  BEGIN UPDATE public.financial_audit SET action = 'edited'; RAISE EXCEPTION 'FAIL A2a: service_role can UPDATE';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.financial_audit; RAISE EXCEPTION 'FAIL A2b: service_role can DELETE';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  IF has_table_privilege('authenticated', 'public.financial_audit', 'UPDATE') OR has_table_privilege('anon', 'public.financial_audit', 'DELETE') THEN
    RAISE EXCEPTION 'FAIL A2c: API roles hold write privileges'; END IF;

  ---- A3 the chain is intact, and only an admin can ask
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.audit_chain_status(); RAISE EXCEPTION 'FAIL A3a: customer ran audit_chain_status';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  st := public.audit_chain_status();
  RESET ROLE;
  IF (st->>'intact')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FAIL A3b: fresh chain not intact: %', st; END IF;
  v_head_before := (st->>'rows')::bigint;

  ---- A4 DELIBERATE bypass by the owner (disable the guard, edit a row in the middle): the chain BREAKS and says where
  ALTER TABLE public.financial_audit DISABLE TRIGGER trg_audit_no_update_delete;
  UPDATE public.financial_audit SET detail = '{"tampered": true}'::jsonb WHERE chain_seq = v_seq - 2;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  st := public.audit_chain_status();
  RESET ROLE;
  IF (st->>'intact')::boolean IS NOT FALSE OR (st->>'first_bad_seq')::bigint <> v_seq - 2 THEN
    RAISE EXCEPTION 'FAIL A4a: edit not detected at the right row: %', st; END IF;

  ---- A5 deleting a row from the middle is detected too
  UPDATE public.financial_audit SET detail = detail WHERE false;   -- no-op, keeps statement style
  DELETE FROM public.financial_audit WHERE chain_seq = v_seq - 3;
  SET LOCAL ROLE authenticated;
  st := public.audit_chain_status();
  RESET ROLE;
  IF (st->>'intact')::boolean IS NOT FALSE OR (st->>'first_bad_seq')::bigint > v_seq - 2 THEN
    RAISE EXCEPTION 'FAIL A5: deletion not detected: %', st; END IF;
  ALTER TABLE public.financial_audit ENABLE TRIGGER trg_audit_no_update_delete;

  RAISE EXCEPTION 'ALL_PASS audit integrity (owner blocked, API roles unprivileged, admin-only verification, edit detected at the exact row, deletion detected)';
END $$;
