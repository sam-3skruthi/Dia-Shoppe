-- Financial safety net (040) + courier backend (041). Rolls back; safe on any environment that has 034-041.
DO $$
DECLARE
  v_cust UUID; v_admin UUID; v_cat BIGINT; v_prod BIGINT; v_o BIGINT; v_o2 BIGINT; v_pay BIGINT; v_pay2 BIGINT; v_rr BIGINT;
  r JSONB; n INTEGER; s TEXT; v_stock INTEGER; v_anchor BIGINT; v_seq BIGINT;
BEGIN
  SELECT id INTO v_cust  FROM public.user_profiles WHERE role = 'customer' LIMIT 1;
  SELECT id INTO v_admin FROM public.user_profiles WHERE role = 'admin' LIMIT 1;
  SELECT id INTO v_cat FROM public.categories LIMIT 1;
  INSERT INTO public.products (name, price, sku, category_id, stock_qty, is_active) VALUES ('ZZ safety', 100, 'ZZ-SAFETY', v_cat, 10, false) RETURNING id INTO v_prod;

  ---- helper orders: o = paid + confirmed (199 each)
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone, razorpay_order_id)
    VALUES (v_cust, 1, 'pending', 'online', 'x', '0', 'order_s1') RETURNING id INTO v_o;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (v_o, v_prod, 1, 1);
  r := public.settle_payment('pay_s1', 'order_s1', 19900, 'test');
  IF r->>'result' <> 'confirmed' THEN RAISE EXCEPTION 'FAIL S0: %', r; END IF;
  SELECT id INTO v_pay FROM public.payments WHERE razorpay_payment_id = 'pay_s1';

  ---- S1 full refunds only
  BEGIN INSERT INTO public.refund_requests (payment_id, order_id, amount, reason, status) VALUES (v_pay, v_o, 100, 'admin_cancel', 'requested');
    RAISE EXCEPTION 'FAIL S1a: a PARTIAL refund request was accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO public.refund_requests (payment_id, order_id, amount, reason, status) VALUES (v_pay, v_o, 250, 'admin_cancel', 'requested');
    RAISE EXCEPTION 'FAIL S1b: a refund ABOVE the captured amount was accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO public.refund_requests (payment_id, order_id, amount, reason, status) VALUES (v_pay, v_o, 199, 'admin_cancel', 'rejected') RETURNING id INTO v_rr;
  BEGIN UPDATE public.refund_requests SET amount = 50 WHERE id = v_rr; RAISE EXCEPTION 'FAIL S1c: amount edited to a partial value'; EXCEPTION WHEN check_violation THEN NULL; END;
  DELETE FROM public.refund_requests WHERE id = v_rr;

  ---- S2 payment.failed: recorded once, no order change, no ledger row
  r := to_jsonb(public.record_payment_failure('{"id":"pay_failed_1","order_id":"order_s1","amount":19900,"method":"card","error_code":"BAD_REQUEST_ERROR","error_description":"declined"}'::jsonb));
  IF r <> '"recorded"'::jsonb THEN RAISE EXCEPTION 'FAIL S2a: %', r; END IF;
  IF public.record_payment_failure('{"id":"pay_failed_1","order_id":"order_s1"}'::jsonb) <> 'duplicate' THEN RAISE EXCEPTION 'FAIL S2b: not idempotent'; END IF;
  IF (SELECT status FROM public.orders WHERE id = v_o) <> 'confirmed' OR EXISTS (SELECT 1 FROM public.payments WHERE razorpay_payment_id = 'pay_failed_1') THEN RAISE EXCEPTION 'FAIL S2c: a failure changed money/order'; END IF;
  IF (SELECT order_id FROM public.payment_failures WHERE razorpay_payment_id = 'pay_failed_1') <> v_o THEN RAISE EXCEPTION 'FAIL S2d: not linked to the order'; END IF;

  ---- S3 refund events
  -- S3a: a FULL refund made in the Razorpay dashboard (no request of ours) is recorded and alerted
  s := public.settle_refund_event('rfnd_out_1', 'pay_s1', 'processed', 19900);
  IF s <> 'recorded_outside_system' THEN RAISE EXCEPTION 'FAIL S3a: %', s; END IF;
  IF (SELECT status FROM public.payments WHERE id = v_pay) <> 'refunded' THEN RAISE EXCEPTION 'FAIL S3b: payment not marked refunded'; END IF;
  IF (SELECT count(*) FROM public.refund_requests WHERE payment_id = v_pay AND razorpay_refund_id = 'rfnd_out_1' AND status = 'processed') <> 1 THEN RAISE EXCEPTION 'FAIL S3c: no synthetic processed request'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ops_events WHERE code = 'refund_outside_system' AND entity_id = v_pay AND severity = 'critical' AND resolved_at IS NULL) THEN RAISE EXCEPTION 'FAIL S3d: no critical alert'; END IF;
  IF public.settle_refund_event('rfnd_out_1', 'pay_s1', 'processed', 19900) <> 'duplicate' THEN RAISE EXCEPTION 'FAIL S3e: duplicate event not idempotent'; END IF;
  -- S3f: gateway later says that refund FAILED -> we must not believe the customer was refunded
  s := public.settle_refund_event('rfnd_out_1', 'pay_s1', 'failed', 19900);
  IF s <> 'reopened_after_gateway_failure' THEN RAISE EXCEPTION 'FAIL S3f: %', s; END IF;
  IF (SELECT status FROM public.refund_requests WHERE razorpay_refund_id = 'rfnd_out_1') <> 'failed' OR (SELECT status FROM public.payments WHERE id = v_pay) <> 'captured' THEN RAISE EXCEPTION 'FAIL S3g: state not reopened'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ops_events WHERE code = 'refund_failed_at_gateway' AND severity = 'critical') THEN RAISE EXCEPTION 'FAIL S3h: no critical alert'; END IF;
  -- S3i: a PARTIAL refund outside the system: critical alert, NOT recorded as a request (full-only)
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone, razorpay_order_id) VALUES (v_cust, 1, 'pending', 'online', 'x', '0', 'order_s3') RETURNING id INTO v_o2;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (v_o2, v_prod, 1, 1);
  PERFORM public.settle_payment('pay_s3', 'order_s3', 19900, 'test'); SELECT id INTO v_pay2 FROM public.payments WHERE razorpay_payment_id = 'pay_s3';
  s := public.settle_refund_event('rfnd_part_1', 'pay_s3', 'processed', 5000);
  IF s <> 'partial_outside_system' OR EXISTS (SELECT 1 FROM public.refund_requests WHERE payment_id = v_pay2) THEN RAISE EXCEPTION 'FAIL S3i: partial handling %', s; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ops_events WHERE code = 'partial_refund_outside_system' AND entity_id = v_pay2 AND severity = 'critical') THEN RAISE EXCEPTION 'FAIL S3j: no alert'; END IF;
  -- S3k: our own refund request finalised by the event
  UPDATE public.orders SET status = 'cancelled', cancelled_by = 'customer' WHERE id = v_o2;           -- customer cancel -> auto-approved full refund request
  SELECT id INTO v_rr FROM public.refund_requests WHERE payment_id = v_pay2 AND status IN ('approved', 'processing', 'requested');
  UPDATE public.refund_requests SET status = 'processing' WHERE id = v_rr;
  s := public.settle_refund_event('rfnd_ours_1', 'pay_s3', 'processed', 19900, v_rr);
  IF s <> 'finalised' OR (SELECT status FROM public.refund_requests WHERE id = v_rr) <> 'processed' OR (SELECT razorpay_refund_id FROM public.refund_requests WHERE id = v_rr) <> 'rfnd_ours_1' THEN RAISE EXCEPTION 'FAIL S3k: %', s; END IF;
  IF public.settle_refund_event('rfnd_x', 'pay_unknown', 'processed', 100) <> 'unknown_payment' THEN RAISE EXCEPTION 'FAIL S3l: unknown payment'; END IF;
  IF public.settle_refund_event('rfnd_x', 'pay_s1', 'weird', 100) <> 'ignored' THEN RAISE EXCEPTION 'FAIL S3m: unknown status'; END IF;

  ---- S4 courier: nothing is guessed
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone, razorpay_order_id, tracking_number)
    VALUES (v_cust, 1, 'pending', 'online', 'x', '0', 'order_s4', 'AWB-S4') RETURNING id INTO v_o;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (v_o, v_prod, 1, 1);
  PERFORM public.settle_payment('pay_s4', 'order_s4', 19900, 'test');
  SELECT stock_qty INTO v_stock FROM public.products WHERE id = v_prod;                                -- after the confirmed order took 1
  r := public.courier_apply_event('some_real_courier', 'k1', v_o::text, 'AWB-S4', 'RTO Delivered', 'X');
  IF r->>'result' <> 'unmapped' OR (SELECT status FROM public.orders WHERE id = v_o) <> 'confirmed' THEN RAISE EXCEPTION 'FAIL S4a: unmapped wording changed the order %', r; END IF;
  IF (SELECT courier_status FROM public.orders WHERE id = v_o) <> 'RTO Delivered' THEN RAISE EXCEPTION 'FAIL S4b: raw status not recorded'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ops_events WHERE code = 'courier_status_unmapped' AND resolved_at IS NULL) THEN RAISE EXCEPTION 'FAIL S4c: no unmapped alert'; END IF;
  IF public.courier_apply_event('some_real_courier', 'k1', v_o::text, 'AWB-S4', 'RTO Delivered')->>'result' <> 'duplicate' THEN RAISE EXCEPTION 'FAIL S4d: duplicate key'; END IF;
  -- canonical vocabulary
  r := public.courier_apply_event('canonical', 'c1', v_o::text, 'AWB-S4', 'Shipped');
  IF r->>'result' <> 'applied' OR (SELECT status FROM public.orders WHERE id = v_o) <> 'shipped' THEN RAISE EXCEPTION 'FAIL S4e: %', r; END IF;
  PERFORM public.courier_apply_event('canonical', 'c2', v_o::text, 'AWB-S4', 'RTO initiated');
  PERFORM public.courier_apply_event('canonical', 'c3', v_o::text, 'AWB-S4', 'rto_in_transit');
  IF (SELECT status FROM public.orders WHERE id = v_o) <> 'shipped' OR (SELECT stock_qty FROM public.products WHERE id = v_prod) <> v_stock OR EXISTS (SELECT 1 FROM public.refund_requests WHERE order_id = v_o) THEN
    RAISE EXCEPTION 'FAIL S4f: RTO initiated / in transit must change NOTHING (no restock, no refund)'; END IF;
  r := public.courier_apply_event('canonical', 'c4', NULL, 'AWB-S4', 'RTO Delivered');               -- found by tracking number alone
  IF r->>'result' <> 'applied' OR (SELECT status FROM public.orders WHERE id = v_o) <> 'rto' THEN RAISE EXCEPTION 'FAIL S4g: %', r; END IF;
  IF (SELECT stock_qty FROM public.products WHERE id = v_prod) <> v_stock + 1 THEN RAISE EXCEPTION 'FAIL S4h: stock not restored exactly once'; END IF;
  SELECT count(*) INTO n FROM public.refund_requests WHERE order_id = v_o;
  IF n <> 1 OR (SELECT status FROM public.refund_requests WHERE order_id = v_o) <> 'requested' OR NOT (SELECT requires_approval FROM public.refund_requests WHERE order_id = v_o) THEN RAISE EXCEPTION 'FAIL S4i: refund request wrong (% rows)', n; END IF;
  r := public.courier_apply_event('canonical', 'c5', v_o::text, 'AWB-S4', 'rto delivered');           -- a second, differently keyed delivery of the same fact
  IF r->>'result' <> 'already_rto' OR (SELECT stock_qty FROM public.products WHERE id = v_prod) <> v_stock + 1 OR (SELECT count(*) FROM public.refund_requests WHERE order_id = v_o) <> 1 THEN RAISE EXCEPTION 'FAIL S4j: second RTO event not idempotent %', r; END IF;
  r := public.courier_apply_event('canonical', 'c6', v_o::text, 'AWB-S4', 'Delivered');
  IF r->>'result' <> 'conflict' OR (SELECT status FROM public.orders WHERE id = v_o) <> 'rto' THEN RAISE EXCEPTION 'FAIL S4k: delivered after rto must not resurrect %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ops_events WHERE code = 'courier_conflict' AND entity_id = v_o) THEN RAISE EXCEPTION 'FAIL S4l: no conflict alert'; END IF;
  r := public.courier_apply_event('canonical', 'c7', v_o::text, 'WRONG-AWB', 'Delivered');
  IF r->>'result' <> 'reference_mismatch' THEN RAISE EXCEPTION 'FAIL S4m: awb mismatch %', r; END IF;
  r := public.courier_apply_event('canonical', 'c8', '99999999', NULL, 'Delivered');
  IF r->>'result' <> 'unknown_order' THEN RAISE EXCEPTION 'FAIL S4n: %', r; END IF;
  -- delivered shipment path and shipment_cancelled (alert only)
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone, razorpay_order_id, tracking_number)
    VALUES (v_cust, 1, 'pending', 'online', 'x', '0', 'order_s5', 'AWB-S5') RETURNING id INTO v_o2;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (v_o2, v_prod, 1, 1);
  PERFORM public.settle_payment('pay_s5', 'order_s5', 19900, 'test');
  r := public.courier_apply_event('canonical', 'd1', v_o2::text, NULL, 'Shipment cancelled');
  IF r->>'result' <> 'alerted' OR (SELECT status FROM public.orders WHERE id = v_o2) <> 'confirmed' OR EXISTS (SELECT 1 FROM public.refund_requests WHERE order_id = v_o2) THEN RAISE EXCEPTION 'FAIL S4o: shipment cancel must not cancel/refund the order %', r; END IF;
  PERFORM public.courier_apply_event('canonical', 'd2', v_o2::text, NULL, 'Out for delivery');
  r := public.courier_apply_event('canonical', 'd3', v_o2::text, NULL, 'Delivered');
  IF (SELECT status FROM public.orders WHERE id = v_o2) <> 'delivered' THEN RAISE EXCEPTION 'FAIL S4p: %', r; END IF;
  r := public.courier_apply_event('canonical', 'd4', v_o2::text, NULL, 'RTO Delivered');
  IF r->>'result' <> 'conflict' OR (SELECT status FROM public.orders WHERE id = v_o2) <> 'delivered' THEN RAISE EXCEPTION 'FAIL S4q: RTO after delivered must not move a delivered order %', r; END IF;
  -- mapping maintenance: admin only, canonical locked
  BEGIN PERFORM public.set_courier_mapping('some_real_courier', 'RTO Delivered', 'rto_delivered'); RAISE EXCEPTION 'FAIL S4r: no-login set a mapping'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  PERFORM public.set_courier_mapping('some_real_courier', 'RTO_Delivered', 'rto_delivered', 'test');
  BEGIN PERFORM public.set_courier_mapping('canonical', 'x', 'ignore'); RAISE EXCEPTION 'FAIL S4s: canonical mapping editable'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  IF (SELECT event FROM public.courier_status_map WHERE provider = 'some_real_courier' AND raw_normalized = 'rto delivered') <> 'rto_delivered' THEN RAISE EXCEPTION 'FAIL S4t: mapping not stored normalised'; END IF;
  PERFORM set_config('request.jwt.claims', '', true);

  ---- S5 audit verification job with checkpoints
  r := private.audit_verify_job();
  IF (r->>'intact')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FAIL S5a: chain reported broken %', r; END IF;
  SELECT max(id) INTO v_anchor FROM public.audit_anchors;
  IF v_anchor IS NULL THEN RAISE EXCEPTION 'FAIL S5b: no anchor stored'; END IF;
  BEGIN UPDATE public.audit_anchors SET intact = true; RAISE EXCEPTION 'FAIL S5c: anchors editable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT max(chain_seq) INTO v_seq FROM public.financial_audit;
  ALTER TABLE public.financial_audit DISABLE TRIGGER trg_audit_no_update_delete;
  UPDATE public.financial_audit SET detail = '{"tampered": true}'::jsonb WHERE chain_seq = v_seq - 1;
  ALTER TABLE public.financial_audit ENABLE TRIGGER trg_audit_no_update_delete;
  r := private.audit_verify_job();
  IF (r->>'intact')::boolean IS TRUE OR (r->>'first_bad_seq')::bigint <> v_seq - 1 THEN RAISE EXCEPTION 'FAIL S5d: edit not detected at the exact row %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ops_events WHERE code = 'audit_chain_broken' AND severity = 'critical' AND resolved_at IS NULL) THEN RAISE EXCEPTION 'FAIL S5e: no critical alert'; END IF;

  ---- S6 financial_health: admin only and sees the alerts
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  BEGIN PERFORM public.financial_health(); RAISE EXCEPTION 'FAIL S6a: customer called financial_health'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  r := public.financial_health();
  IF (r->>'open_critical_events')::int < 3 OR r->'last_audit_check'->>'intact' <> 'false' OR (r->>'refunds_awaiting_approval')::int < 1 THEN RAISE EXCEPTION 'FAIL S6b: health summary wrong %', r; END IF;
  PERFORM set_config('request.jwt.claims', '', true);

  ---- S7 reconciliation run bookkeeping
  n := public.record_reconciliation_run(now() - interval '2 days', now(), 5, 5, '[{"code":"orphan_payment","severity":"critical","payment":"pay_x"}]'::jsonb, NULL, 'test');
  IF (SELECT ok FROM public.reconciliation_runs WHERE id = n) IS NOT FALSE THEN RAISE EXCEPTION 'FAIL S7a: run with a critical finding marked ok'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ops_events WHERE code = 'reconcile_discrepancy' AND entity_id = n) THEN RAISE EXCEPTION 'FAIL S7b: no discrepancy alert'; END IF;
  n := public.record_reconciliation_run(now() - interval '2 days', now(), 5, 5, '[{"code":"missing_payment_healed","severity":"warning"}]'::jsonb, NULL, 'test');
  IF (SELECT ok FROM public.reconciliation_runs WHERE id = n) IS NOT TRUE THEN RAISE EXCEPTION 'FAIL S7c: a healed-only run should be ok'; END IF;
  n := public.record_reconciliation_run(now() - interval '2 days', now(), NULL, NULL, '[]'::jsonb, 'Razorpay HTTP 500', 'test');
  IF NOT EXISTS (SELECT 1 FROM public.ops_events WHERE code = 'reconcile_run_failed' AND entity_id = n) THEN RAISE EXCEPTION 'FAIL S7d: a failed run raised no alert'; END IF;

  ---- S8 privileges
  IF has_function_privilege('anon', 'public.settle_refund_event(text,text,text,bigint,bigint)', 'execute') OR has_function_privilege('authenticated', 'public.courier_apply_event(text,text,text,text,text,text)', 'execute')
     OR has_function_privilege('authenticated', 'public.record_reconciliation_run(timestamptz,timestamptz,int,int,jsonb,text,text)', 'execute') OR has_table_privilege('authenticated', 'public.courier_events', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL S8: a client role can run a money/courier function or write its tables'; END IF;

  RAISE EXCEPTION 'ALL_PASS safety net (full-refund-only x3, payment.failed, refund events: outside/dedupe/gateway-failed/partial/finalise/unknown, courier: unmapped/canonical/rto initiated+in transit change nothing/rto once/duplicate/conflict/mismatch/unknown/shipment cancel/mapping RBAC, audit job + tamper, health, reconciliation bookkeeping, privileges)';
END $$;
