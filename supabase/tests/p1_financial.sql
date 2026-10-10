-- Financial state machine (migration 034). Rolls back; safe on any environment that has 034.
DO $$
DECLARE
  v_cust UUID; v_admin UUID; v_cat BIGINT; v_prod BIGINT; v_o BIGINT; v_o2 BIGINT;
  r JSONB; n INTEGER; v_req BIGINT; v_pay BIGINT;
BEGIN
  SELECT id INTO v_cust  FROM public.user_profiles WHERE role = 'customer' LIMIT 1;
  SELECT id INTO v_admin FROM public.user_profiles WHERE role = 'admin' LIMIT 1;
  SELECT id INTO v_cat FROM public.categories LIMIT 1;
  INSERT INTO public.products (name, price, sku, category_id, stock_qty, is_active)
    VALUES ('ZZ fin', 100, 'ZZ-FIN', v_cat, 10, false) RETURNING id INTO v_prod;

  ---- F1 late payment after customer cancel -> automatic full refund, order stays cancelled, stock untouched
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone, razorpay_order_id)
    VALUES (v_cust, 1, 'pending', 'online', 'x', '0', 'order_f1') RETURNING id INTO v_o;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (v_o, v_prod, 1, 1);  -- total becomes 199 (100 + 99 shipping)
  UPDATE public.orders SET status = 'cancelled', cancelled_by = 'customer' WHERE id = v_o;
  r := public.settle_payment('pay_f1', 'order_f1', 19900, 'test');
  IF r->>'result' <> 'late_payment_refund' THEN RAISE EXCEPTION 'FAIL F1a: %', r; END IF;
  SELECT id INTO v_req FROM public.refund_requests WHERE order_id = v_o;
  IF (SELECT status FROM public.refund_requests WHERE id = v_req) <> 'approved'
     OR (SELECT amount FROM public.refund_requests WHERE id = v_req) <> 199
     OR (SELECT reason FROM public.refund_requests WHERE id = v_req) <> 'late_payment_after_cancel' THEN
    RAISE EXCEPTION 'FAIL F1b: refund request not auto-approved for the full amount'; END IF;
  IF (SELECT status FROM public.orders WHERE id = v_o) <> 'cancelled' THEN RAISE EXCEPTION 'FAIL F1c: order was resurrected'; END IF;
  IF (SELECT stock_qty FROM public.products WHERE id = v_prod) <> 10 THEN RAISE EXCEPTION 'FAIL F1d: stock moved'; END IF;
  r := public.settle_payment('pay_f1', 'order_f1', 19900, 'test');        -- duplicate delivery
  IF r->>'result' <> 'duplicate_event' THEN RAISE EXCEPTION 'FAIL F1e: duplicate not idempotent %', r; END IF;
  SELECT count(*) INTO n FROM public.refund_requests WHERE order_id = v_o;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL F1f: % refund requests after duplicate', n; END IF;
  IF (SELECT refund_status FROM public.orders WHERE id = v_o) <> 'pending' THEN RAISE EXCEPTION 'FAIL F1g: order.refund_status not synced'; END IF;

  ---- F2 pay then customer cancels -> automatic refund; stock restored once
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone, razorpay_order_id)
    VALUES (v_cust, 1, 'pending', 'online', 'x', '0', 'order_f2') RETURNING id INTO v_o;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (v_o, v_prod, 2, 1);   -- total 299
  r := public.settle_payment('pay_f2', 'order_f2', 29900, 'test');
  IF r->>'result' <> 'confirmed' THEN RAISE EXCEPTION 'FAIL F2a: %', r; END IF;
  IF (SELECT stock_qty FROM public.products WHERE id = v_prod) <> 8 THEN RAISE EXCEPTION 'FAIL F2b: stock not taken'; END IF;
  UPDATE public.orders SET status = 'cancelled', cancelled_by = 'customer' WHERE id = v_o;
  IF (SELECT reason || '/' || status FROM public.refund_requests WHERE order_id = v_o) <> 'customer_cancel/approved' THEN
    RAISE EXCEPTION 'FAIL F2c: no auto refund on customer cancel'; END IF;
  IF (SELECT stock_qty FROM public.products WHERE id = v_prod) <> 10 THEN RAISE EXCEPTION 'FAIL F2d: stock not restored'; END IF;

  ---- F3 COD cancel -> no money, no refund request
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone)
    VALUES (v_cust, 1, 'confirmed', 'cod', 'x', '0') RETURNING id INTO v_o;
  UPDATE public.orders SET status = 'cancelled', cancelled_by = 'customer' WHERE id = v_o;
  IF EXISTS (SELECT 1 FROM public.refund_requests WHERE order_id = v_o) THEN RAISE EXCEPTION 'FAIL F3: COD cancel created a refund'; END IF;

  ---- F4 RTO: stock back, refund needs ADMIN approval, nothing executes automatically
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone, razorpay_order_id)
    VALUES (v_cust, 1, 'pending', 'online', 'x', '0', 'order_f4') RETURNING id INTO v_o;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (v_o, v_prod, 1, 1);   -- 199
  PERFORM public.settle_payment('pay_f4', 'order_f4', 19900, 'test');
  UPDATE public.orders SET status = 'shipped' WHERE id = v_o;
  UPDATE public.orders SET status = 'rto' WHERE id = v_o;
  SELECT id INTO v_req FROM public.refund_requests WHERE order_id = v_o;
  IF (SELECT status FROM public.refund_requests WHERE id = v_req) <> 'requested'
     OR NOT (SELECT requires_approval FROM public.refund_requests WHERE id = v_req) THEN
    RAISE EXCEPTION 'FAIL F4a: RTO refund must wait for admin approval'; END IF;
  IF (SELECT stock_qty FROM public.products WHERE id = v_prod) <> 10 THEN RAISE EXCEPTION 'FAIL F4b: RTO stock not restored'; END IF;
  -- a normal customer cannot approve
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.approve_refund(v_req); RAISE EXCEPTION 'FAIL F4c: customer approved a refund';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  -- an admin can
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.approve_refund(v_req);
  RESET ROLE;
  IF (SELECT status || '/' || approved_by::text FROM public.refund_requests WHERE id = v_req) <> 'approved/' || v_admin::text THEN
    RAISE EXCEPTION 'FAIL F4d: approval not recorded with approver'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.financial_audit WHERE entity = 'refund_request' AND entity_id = v_req AND action = 'refund_approved' AND actor = v_admin) THEN
    RAISE EXCEPTION 'FAIL F4e: approval not audited with actor'; END IF;

  ---- F5 amount mismatch -> not confirmed, needs admin
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone, razorpay_order_id)
    VALUES (v_cust, 1, 'pending', 'online', 'x', '0', 'order_f5') RETURNING id INTO v_o;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (v_o, v_prod, 1, 1);   -- 199
  r := public.settle_payment('pay_f5', 'order_f5', 100, 'test');                                                 -- paid Rs 1
  IF r->>'result' <> 'amount_mismatch' OR (SELECT status FROM public.orders WHERE id = v_o) <> 'pending' THEN
    RAISE EXCEPTION 'FAIL F5: mismatch handling %', r; END IF;

  ---- F6 second, different payment for an already-paid order -> refund the extra one
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone, razorpay_order_id)
    VALUES (v_cust, 1, 'pending', 'online', 'x', '0', 'order_f6') RETURNING id INTO v_o;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (v_o, v_prod, 1, 1);
  PERFORM public.settle_payment('pay_f6a', 'order_f6', 19900, 'test');
  r := public.settle_payment('pay_f6b', 'order_f6', 19900, 'test');
  IF r->>'result' <> 'duplicate_payment_refund' THEN RAISE EXCEPTION 'FAIL F6: %', r; END IF;

  ---- F7 the double-refund guard: a second live refund for the same payment is impossible
  SELECT id INTO v_pay FROM public.payments WHERE razorpay_payment_id = 'pay_f1';
  BEGIN
    INSERT INTO public.refund_requests (payment_id, order_id, amount, reason, status) VALUES (v_pay, NULL, 199, 'admin_cancel', 'approved');   -- full amount (partial refunds are blocked since 040); the unique guard must still refuse a second live refund
    RAISE EXCEPTION 'FAIL F7: second live refund for one payment was allowed';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  ---- F8 pending online orders expire after 30 minutes (COD and fresh orders do not)
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone, created_at)
    VALUES (v_cust, 1, 'pending', 'online', 'x', '0', now() - interval '31 minutes') RETURNING id INTO v_o;
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone, created_at)
    VALUES (v_cust, 1, 'pending', 'online', 'x', '0', now() - interval '5 minutes') RETURNING id INTO v_o2;
  PERFORM private.expire_pending_orders(30);
  IF (SELECT status || '/' || cancelled_by FROM public.orders WHERE id = v_o) <> 'cancelled/system' THEN RAISE EXCEPTION 'FAIL F8a: old pending order not expired'; END IF;
  IF (SELECT status FROM public.orders WHERE id = v_o2) <> 'pending' THEN RAISE EXCEPTION 'FAIL F8b: fresh order expired'; END IF;

  ---- F9 privileges: customers cannot settle payments or read the money tables
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.settle_payment('pay_x', 'order_f1', 1, 'test'); RAISE EXCEPTION 'FAIL F9a: customer ran settle_payment';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT count(*) INTO n FROM public.payments;        IF n <> 0 THEN RAISE EXCEPTION 'FAIL F9b: customer sees % payments', n; END IF;
  SELECT count(*) INTO n FROM public.refund_requests; IF n <> 0 THEN RAISE EXCEPTION 'FAIL F9c: customer sees refund requests'; END IF;
  SELECT count(*) INTO n FROM public.financial_audit; IF n <> 0 THEN RAISE EXCEPTION 'FAIL F9d: customer sees audit'; END IF;
  RESET ROLE;
  SET LOCAL ROLE anon;
  BEGIN PERFORM 1 FROM public.payments; RAISE EXCEPTION 'FAIL F9e: anon read payments';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;

  ---- F10 every payment and refund decision is audited
  IF (SELECT count(*) FROM public.financial_audit WHERE action = 'payment_recorded') < 5 THEN RAISE EXCEPTION 'FAIL F10: payments not audited'; END IF;

  RAISE EXCEPTION 'ALL_PASS financial (late-pay refund, dup event, pay->cancel, COD, RTO approval + RBAC + audit, mismatch, dup payment, double-refund guard, 30-min expiry, privileges)';
END $$;
