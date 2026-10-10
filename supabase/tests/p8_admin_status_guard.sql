-- 042 order-status guard + manual decisions. Rolls back (ends with RAISE). Needs 034-042.
-- Direct updates are made AS THE ADMIN ROLE exactly like the frozen admin dropdown (PATCH orders.status), and as service_role.
-- After every scenario: order status, stock, per-line deduction, payments ledger, refund requests.
DO $$
DECLARE
  v_cust UUID; v_admin UUID; v_admin_email TEXT; v_cat BIGINT; pa BIGINT; pb BIGINT;
  oh BIGINT; oh2 BIGINT; om BIGINT; om2 BIGINT; orr BIGINT; oc BIGINT; ok BIGINT; op BIGINT; oq BIGINT; ocod BIGINT;
  rr BIGINT; r JSONB; n INTEGER; st TEXT; v_tot NUMERIC; v_admin_claims TEXT; v_cust_claims TEXT; blocked INTEGER := 0;
BEGIN
  SELECT id INTO v_cust FROM public.user_profiles WHERE role = 'customer' LIMIT 1;
  SELECT id, email INTO v_admin, v_admin_email FROM public.user_profiles WHERE role = 'admin' AND email IS NOT NULL AND COALESCE(is_active, true) LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'FAIL setup: no active admin profile with an email'; END IF;
  v_admin_claims := json_build_object('sub', v_admin, 'role', 'authenticated')::text;
  v_cust_claims  := json_build_object('sub', v_cust, 'role', 'authenticated')::text;
  SELECT id INTO v_cat FROM public.categories LIMIT 1;
  INSERT INTO public.products (name, price, sku, category_id, stock_qty, is_active) VALUES ('ZZ guard A', 100, 'ZZ-GUARD-A', v_cat, 1, false) RETURNING id INTO pa;
  INSERT INTO public.products (name, price, sku, category_id, stock_qty, is_active) VALUES ('ZZ guard B', 100, 'ZZ-GUARD-B', v_cat, 50, false) RETURNING id INTO pb;

  -- fixtures (as postgres): each order pending online with one line, then settled the way the backend does it
  -- held: A x2 while stock is 1 -> on_hold. Lines are inserted while stock allows, then stock drops (another sale).
  UPDATE public.products SET stock_qty = 5 WHERE id = pa;
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone, razorpay_order_id)
    VALUES (v_cust, 1, 'pending', 'online', 'x', '0', 'order_g_h1') RETURNING id INTO oh;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (oh, pa, 2, 100);
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone, razorpay_order_id)
    VALUES (v_cust, 1, 'pending', 'online', 'x', '0', 'order_g_h2') RETURNING id INTO oh2;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (oh2, pa, 2, 100);
  UPDATE public.products SET stock_qty = 1 WHERE id = pa;
  SELECT total_amount INTO v_tot FROM public.orders WHERE id = oh;
  r := public.settle_payment('pay_g_h1', 'order_g_h1', (v_tot * 100)::bigint, 'test');
  IF r->>'result' <> 'held_insufficient_stock' THEN RAISE EXCEPTION 'FAIL setup held: %', r; END IF;
  r := public.settle_payment('pay_g_h2', 'order_g_h2', (v_tot * 100)::bigint, 'test');
  IF r->>'result' <> 'held_insufficient_stock' THEN RAISE EXCEPTION 'FAIL setup held 2: %', r; END IF;

  -- amount mismatch: paid 1 rupee more than the total -> stays pending, refund request needs approval
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone, razorpay_order_id)
    VALUES (v_cust, 1, 'pending', 'online', 'x', '0', 'order_g_m1') RETURNING id INTO om;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (om, pb, 1, 100);
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone, razorpay_order_id)
    VALUES (v_cust, 1, 'pending', 'online', 'x', '0', 'order_g_m2') RETURNING id INTO om2;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (om2, pb, 1, 100);
  SELECT total_amount INTO v_tot FROM public.orders WHERE id = om;
  r := public.settle_payment('pay_g_m1', 'order_g_m1', (v_tot * 100)::bigint + 100, 'test');
  IF r->>'result' <> 'amount_mismatch' THEN RAISE EXCEPTION 'FAIL setup mismatch: %', r; END IF;
  r := public.settle_payment('pay_g_m2', 'order_g_m2', (v_tot * 100)::bigint + 100, 'test');
  IF r->>'result' <> 'amount_mismatch' THEN RAISE EXCEPTION 'FAIL setup mismatch 2: %', r; END IF;

  -- rto: paid + confirmed (B deducted), shipped and returned through the courier function as service_role (like courier-webhook)
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone, razorpay_order_id, tracking_number)
    VALUES (v_cust, 1, 'pending', 'online', 'x', '0', 'order_g_r1', 'AWB-G-R1') RETURNING id INTO orr;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (orr, pb, 1, 100);
  -- paid + confirmed orders for cancel/normal flows
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone, razorpay_order_id)
    VALUES (v_cust, 1, 'pending', 'online', 'x', '0', 'order_g_c1') RETURNING id INTO oc;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (oc, pb, 1, 100);
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone, razorpay_order_id)
    VALUES (v_cust, 1, 'pending', 'online', 'x', '0', 'order_g_k1') RETURNING id INTO ok;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (ok, pb, 1, 100);
  SELECT total_amount INTO v_tot FROM public.orders WHERE id = orr;
  IF public.settle_payment('pay_g_r1', 'order_g_r1', (v_tot * 100)::bigint, 'test')->>'result' <> 'confirmed'
     OR public.settle_payment('pay_g_c1', 'order_g_c1', (v_tot * 100)::bigint, 'test')->>'result' <> 'confirmed'
     OR public.settle_payment('pay_g_k1', 'order_g_k1', (v_tot * 100)::bigint, 'test')->>'result' <> 'confirmed' THEN
    RAISE EXCEPTION 'FAIL setup: confirmed orders'; END IF;
  -- plain unpaid online orders, and a COD order (created confirmed, stock taken at line insert)
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone, razorpay_order_id)
    VALUES (v_cust, 1, 'pending', 'online', 'x', '0', 'order_g_p1') RETURNING id INTO op;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (op, pb, 1, 100);
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone, razorpay_order_id)
    VALUES (v_cust, 1, 'pending', 'online', 'x', '0', 'order_g_q1') RETURNING id INTO oq;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (oq, pb, 1, 100);
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone)
    VALUES (v_cust, 1, 'confirmed', 'cod', 'x', '0') RETURNING id INTO ocod;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (ocod, pb, 1, 100);
  IF (SELECT stock_qty FROM public.products WHERE id = pb) <> 46 THEN RAISE EXCEPTION 'FAIL setup: B stock %', (SELECT stock_qty FROM public.products WHERE id = pb); END IF;

  SET LOCAL ROLE service_role;
  r := public.courier_apply_event('canonical', 'g-r1-ship', orr::text, 'AWB-G-R1', 'Shipped');
  r := public.courier_apply_event('canonical', 'g-r1-rto', orr::text, 'AWB-G-R1', 'RTO Delivered');
  RESET ROLE;
  IF r->>'result' <> 'applied' OR (SELECT status FROM public.orders WHERE id = orr) <> 'rto' THEN RAISE EXCEPTION 'FAIL G0a: approved courier path (service_role -> courier_apply_event) blocked: %', r; END IF;
  IF (SELECT stock_qty FROM public.products WHERE id = pb) <> 47 THEN RAISE EXCEPTION 'FAIL G0b: RTO stock not restored once'; END IF;

  ---------------------------------------------------------------- G1 held order: the dropdown can do NOTHING
  PERFORM set_config('request.jwt.claims', v_admin_claims, true);
  SET LOCAL ROLE authenticated;
  FOREACH st IN ARRAY ARRAY['pending', 'paid', 'confirmed', 'shipped', 'delivered', 'cancelled', 'rto'] LOOP
    BEGIN
      EXECUTE format('UPDATE public.orders SET status = %L WHERE id = %s', st, oh);
      RAISE EXCEPTION 'FAIL G1: admin moved a HELD order to %', st;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'ORDER_STATUS_BLOCKED%' THEN RAISE; END IF; blocked := blocked + 1;
    END;
  END LOOP;
  RESET ROLE;
  IF (SELECT status FROM public.orders WHERE id = oh) <> 'on_hold' OR (SELECT stock_qty FROM public.products WHERE id = pa) <> 1
     OR (SELECT stock_deducted_qty FROM public.order_items WHERE order_id = oh) IS NOT NULL
     OR (SELECT status FROM public.refund_requests WHERE order_id = oh) <> 'requested'
     OR (SELECT count(*) FROM public.payments WHERE order_id = oh AND status = 'captured') <> 1 THEN
    RAISE EXCEPTION 'FAIL G1b: held order state changed after blocked attempts'; END IF;

  -- service_role (server code / service key) is held to the same rules
  SET LOCAL ROLE service_role;
  BEGIN UPDATE public.orders SET status = 'confirmed' WHERE id = oh; RAISE EXCEPTION 'FAIL G1c: service_role moved a held order';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'ORDER_STATUS_BLOCKED%' THEN RAISE; END IF; blocked := blocked + 1; END;
  RESET ROLE;

  -- legitimate: the manual procedure refunds a held order (oh2) as the named admin, idempotently
  -- (the admin's own RPC refund_held_order is covered by p2_stock_invariant S6 and the API suite)
  r := private.manual_held_order_decision(oh2, 'refund', v_admin_email, 'test: cannot restock');
  IF r->>'result' <> 'refunded' THEN RAISE EXCEPTION 'FAIL G1d0: %', r; END IF;
  r := private.manual_held_order_decision(oh2, 'refund', v_admin_email, 'test: repeat');
  IF r->>'result' <> 'already_refunded' THEN RAISE EXCEPTION 'FAIL G1d1: repeat not idempotent: %', r; END IF;
  IF (SELECT status FROM public.orders WHERE id = oh2) <> 'cancelled' OR (SELECT status FROM public.refund_requests WHERE order_id = oh2) <> 'approved'
     OR (SELECT approved_by FROM public.refund_requests WHERE order_id = oh2) <> v_admin OR (SELECT stock_qty FROM public.products WHERE id = pa) <> 1
     OR (SELECT count(*) FROM public.refund_requests WHERE order_id = oh2) <> 1 THEN
    RAISE EXCEPTION 'FAIL G1d: manual held-order refund wrong'; END IF;

  -- legitimate: manual procedure fulfils a held order after restock; still refuses while short
  BEGIN PERFORM private.manual_held_order_decision(oh, 'fulfil', v_admin_email, 'test: still short');
    RAISE EXCEPTION 'FAIL G1e: fulfilled while still short of stock';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%still short of stock%' THEN RAISE; END IF; END;
  UPDATE public.products SET stock_qty = 5 WHERE id = pa;
  r := private.manual_held_order_decision(oh, 'fulfil', v_admin_email, 'test: restocked');
  IF r->>'result' <> 'fulfilled' OR (SELECT status FROM public.orders WHERE id = oh) <> 'confirmed' OR (SELECT stock_qty FROM public.products WHERE id = pa) <> 3
     OR (SELECT stock_deducted_qty FROM public.order_items WHERE order_id = oh) <> 2 OR (SELECT status FROM public.refund_requests WHERE order_id = oh) <> 'rejected'
     OR (SELECT approved_by FROM public.refund_requests WHERE order_id = oh) <> v_admin THEN
    RAISE EXCEPTION 'FAIL G1f: manual fulfil wrong: % / %', r, (SELECT status FROM public.orders WHERE id = oh); END IF;
  r := private.manual_held_order_decision(oh, 'fulfil', v_admin_email, 'test: repeat');
  IF r->>'result' <> 'already_fulfilled' OR (SELECT stock_qty FROM public.products WHERE id = pa) <> 3 THEN RAISE EXCEPTION 'FAIL G1g: repeat not idempotent: %', r; END IF;
  BEGIN PERFORM private.manual_held_order_decision(oh, 'refund', v_admin_email, 'test: conflicting');
    RAISE EXCEPTION 'FAIL G1h: refund accepted on a fulfilled order';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'MANUAL_DECISION%' THEN RAISE; END IF; END;
  -- once fulfilled it is a normal order again: the dropdown ships and delivers it
  PERFORM set_config('request.jwt.claims', v_admin_claims, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.orders SET status = 'shipped' WHERE id = oh;
  UPDATE public.orders SET status = 'delivered' WHERE id = oh;
  RESET ROLE;
  IF (SELECT status FROM public.orders WHERE id = oh) <> 'delivered' OR (SELECT stock_qty FROM public.products WHERE id = pa) <> 3 THEN RAISE EXCEPTION 'FAIL G1i: fulfilled order could not ship'; END IF;

  ---------------------------------------------------------------- G4 amount mismatch (pending): only cancel
  PERFORM set_config('request.jwt.claims', v_admin_claims, true);
  SET LOCAL ROLE authenticated;
  FOREACH st IN ARRAY ARRAY['paid', 'confirmed', 'shipped', 'delivered', 'rto', 'on_hold'] LOOP
    BEGIN
      EXECUTE format('UPDATE public.orders SET status = %L WHERE id = %s', st, om);
      RAISE EXCEPTION 'FAIL G4: admin moved an AMOUNT-MISMATCH order to %', st;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'ORDER_STATUS_BLOCKED%' THEN RAISE; END IF; blocked := blocked + 1;
    END;
  END LOOP;
  RESET ROLE;
  IF (SELECT status FROM public.orders WHERE id = om) <> 'pending' OR (SELECT stock_deducted_qty FROM public.order_items WHERE order_id = om) IS NOT NULL
     OR (SELECT status FROM public.refund_requests WHERE order_id = om) <> 'requested' OR (SELECT reason FROM public.refund_requests WHERE order_id = om) <> 'amount_mismatch'
     OR (SELECT count(*) FROM public.payments WHERE order_id = om AND status = 'captured') <> 1 OR (SELECT stock_qty FROM public.products WHERE id = pb) <> 47 THEN
    RAISE EXCEPTION 'FAIL G4b: mismatch order state changed after blocked attempts'; END IF;

  -- manual approve: refund approved by the named admin, alert resolved, extra audit row, idempotent, no stock/order change
  SELECT id INTO rr FROM public.refund_requests WHERE order_id = om;
  r := private.manual_refund_decision(rr, 'approve', v_admin_email, 'test: customer overpaid');
  IF r->>'result' <> 'approved' OR (SELECT status FROM public.refund_requests WHERE id = rr) <> 'approved'
     OR (SELECT approved_by FROM public.refund_requests WHERE id = rr) <> v_admin
     OR (SELECT decision_note FROM public.refund_requests WHERE id = rr) <> 'manual: test: customer overpaid'
     OR EXISTS (SELECT 1 FROM public.ops_events WHERE code = 'amount_mismatch' AND entity_id = om AND resolved_at IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.financial_audit WHERE action = 'manual_decision' AND entity = 'refund_request' AND entity_id = rr AND actor = v_admin AND detail->>'decision' = 'approve')
     OR NOT EXISTS (SELECT 1 FROM public.financial_audit WHERE action = 'refund_approved' AND entity_id = rr AND actor = v_admin)
     OR (SELECT status FROM public.orders WHERE id = om) <> 'pending' OR (SELECT stock_qty FROM public.products WHERE id = pb) <> 47 THEN
    RAISE EXCEPTION 'FAIL G4c: manual approve wrong: %', r; END IF;
  SELECT count(*) INTO n FROM public.financial_audit WHERE entity = 'refund_request' AND entity_id = rr;
  r := private.manual_refund_decision(rr, 'approve', v_admin_email, 'test: repeat');
  IF r->>'result' <> 'already_approved' OR (SELECT count(*) FROM public.financial_audit WHERE entity = 'refund_request' AND entity_id = rr) <> n THEN
    RAISE EXCEPTION 'FAIL G4d: repeated approve not idempotent: %', r; END IF;
  BEGIN PERFORM private.manual_refund_decision(rr, 'reject', v_admin_email, 'test: flip'); RAISE EXCEPTION 'FAIL G4e: approved refund was rejected afterwards';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'MANUAL_DECISION%' THEN RAISE; END IF; END;

  -- the second mismatch order: the dropdown MAY cancel it (safe direction) - no new refund, no stock change; then manual reject, idempotent
  PERFORM set_config('request.jwt.claims', v_admin_claims, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.orders SET status = 'cancelled', cancelled_by = 'admin', cancelled_at = now() WHERE id = om2;
  RESET ROLE;
  IF (SELECT status FROM public.orders WHERE id = om2) <> 'cancelled' OR (SELECT count(*) FROM public.refund_requests WHERE order_id = om2) <> 1
     OR (SELECT status FROM public.refund_requests WHERE order_id = om2) <> 'requested' OR (SELECT stock_qty FROM public.products WHERE id = pb) <> 47 THEN
    RAISE EXCEPTION 'FAIL G4f: cancelling a mismatch order went wrong'; END IF;
  SELECT id INTO rr FROM public.refund_requests WHERE order_id = om2;
  r := private.manual_refund_decision(rr, 'reject', v_admin_email, 'test: settled outside');
  IF r->>'result' <> 'rejected' OR (SELECT status FROM public.refund_requests WHERE id = rr) <> 'rejected' OR (SELECT approved_by FROM public.refund_requests WHERE id = rr) <> v_admin THEN
    RAISE EXCEPTION 'FAIL G4g: manual reject wrong: %', r; END IF;
  IF private.manual_refund_decision(rr, 'reject', v_admin_email, 'test: repeat')->>'result' <> 'already_rejected' THEN RAISE EXCEPTION 'FAIL G4h: repeated reject not idempotent'; END IF;

  ---------------------------------------------------------------- G2 rto: final
  PERFORM set_config('request.jwt.claims', v_admin_claims, true);
  SET LOCAL ROLE authenticated;
  FOREACH st IN ARRAY ARRAY['pending', 'paid', 'confirmed', 'shipped', 'delivered', 'cancelled', 'on_hold'] LOOP
    BEGIN
      EXECUTE format('UPDATE public.orders SET status = %L WHERE id = %s', st, orr);
      RAISE EXCEPTION 'FAIL G2: admin moved an RTO order to %', st;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'ORDER_STATUS_BLOCKED%' THEN RAISE; END IF; blocked := blocked + 1;
    END;
  END LOOP;
  RESET ROLE;
  IF (SELECT status FROM public.orders WHERE id = orr) <> 'rto' OR (SELECT stock_qty FROM public.products WHERE id = pb) <> 47
     OR (SELECT stock_restored_at FROM public.order_items WHERE order_id = orr) IS NULL
     OR (SELECT count(*) FROM public.refund_requests WHERE order_id = orr) <> 1 OR (SELECT status FROM public.refund_requests WHERE order_id = orr) <> 'requested' THEN
    RAISE EXCEPTION 'FAIL G2b: rto order state changed after blocked attempts'; END IF;
  SELECT id INTO rr FROM public.refund_requests WHERE order_id = orr;
  r := private.manual_refund_decision(rr, 'approve', v_admin_email, 'test: parcel back in warehouse, checked');
  IF r->>'result' <> 'approved' OR (SELECT status FROM public.orders WHERE id = orr) <> 'rto' OR (SELECT stock_qty FROM public.products WHERE id = pb) <> 47 THEN
    RAISE EXCEPTION 'FAIL G2c: manual approve of RTO refund wrong: %', r; END IF;

  ---------------------------------------------------------------- G3 cancelled: cannot be reopened
  PERFORM set_config('request.jwt.claims', v_admin_claims, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.orders SET status = 'cancelled', cancelled_by = 'admin', cancelled_at = now() WHERE id = oc;   -- legitimate admin cancel
  FOREACH st IN ARRAY ARRAY['pending', 'paid', 'confirmed', 'shipped', 'delivered'] LOOP
    BEGIN
      EXECUTE format('UPDATE public.orders SET status = %L WHERE id = %s', st, oc);
      RAISE EXCEPTION 'FAIL G3: admin reopened a CANCELLED order as %', st;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'ORDER_STATUS_BLOCKED%' THEN RAISE; END IF; blocked := blocked + 1;
    END;
  END LOOP;
  RESET ROLE;
  IF (SELECT status FROM public.orders WHERE id = oc) <> 'cancelled' OR (SELECT stock_qty FROM public.products WHERE id = pb) <> 48
     OR (SELECT status FROM public.refund_requests WHERE order_id = oc) <> 'approved' OR (SELECT reason FROM public.refund_requests WHERE order_id = oc) <> 'admin_cancel' THEN
    RAISE EXCEPTION 'FAIL G3b: admin cancel (refund auto-approved, stock back once) wrong'; END IF;

  ---------------------------------------------------------------- G4 plain unpaid order + G5 into on_hold
  PERFORM set_config('request.jwt.claims', v_admin_claims, true);
  SET LOCAL ROLE authenticated;
  FOREACH st IN ARRAY ARRAY['paid', 'confirmed', 'shipped', 'delivered'] LOOP
    BEGIN
      EXECUTE format('UPDATE public.orders SET status = %L WHERE id = %s', st, op);
      RAISE EXCEPTION 'FAIL G4i: admin confirmed an UNPAID order as %', st;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'ORDER_STATUS_BLOCKED%' THEN RAISE; END IF; blocked := blocked + 1;
    END;
  END LOOP;
  BEGIN UPDATE public.orders SET status = 'on_hold' WHERE id = ok; RAISE EXCEPTION 'FAIL G5: admin put an order on hold';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'ORDER_STATUS_BLOCKED%' THEN RAISE; END IF; blocked := blocked + 1; END;
  UPDATE public.orders SET status = 'cancelled', cancelled_by = 'admin', cancelled_at = now() WHERE id = op;      -- admin may cancel an unpaid order
  ---- legitimate normal flow: paid order confirmed -> shipped -> delivered; COD confirmed -> shipped
  UPDATE public.orders SET status = 'shipped', courier = 'X', tracking_number = 'AWB-G-K1' WHERE id = ok;
  UPDATE public.orders SET status = 'delivered' WHERE id = ok;
  UPDATE public.orders SET status = 'shipped' WHERE id = ocod;
  RESET ROLE;
  IF (SELECT status FROM public.orders WHERE id = op) <> 'cancelled' OR EXISTS (SELECT 1 FROM public.refund_requests WHERE order_id = op)
     OR (SELECT status FROM public.orders WHERE id = ok) <> 'delivered' OR (SELECT status FROM public.orders WHERE id = ocod) <> 'shipped'
     OR (SELECT stock_qty FROM public.products WHERE id = pb) <> 48 THEN
    RAISE EXCEPTION 'FAIL G6: a legitimate admin workflow was blocked or changed stock'; END IF;
  -- the customer may still cancel their own unpaid order
  PERFORM set_config('request.jwt.claims', v_cust_claims, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.orders SET status = 'cancelled', cancelled_by = 'customer', cancelled_at = now() WHERE id = oq;
  RESET ROLE;
  IF (SELECT status FROM public.orders WHERE id = oq) <> 'cancelled' THEN RAISE EXCEPTION 'FAIL G6b: customer cancel blocked'; END IF;
  -- the payment path still confirms a pending order (settle as service_role, as verify-payment / the webhook do)
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone, razorpay_order_id)
    VALUES (v_cust, 1, 'pending', 'online', 'x', '0', 'order_g_s1') RETURNING id INTO op;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (op, pb, 1, 100);
  SELECT total_amount INTO v_tot FROM public.orders WHERE id = op;
  SET LOCAL ROLE service_role;
  r := public.settle_payment('pay_g_s1', 'order_g_s1', (v_tot * 100)::bigint, 'test');
  RESET ROLE;
  IF r->>'result' <> 'confirmed' OR (SELECT stock_qty FROM public.products WHERE id = pb) <> 47 THEN RAISE EXCEPTION 'FAIL G6c: settle_payment blocked: %', r; END IF;
  -- the 30-minute expiry job still cancels unpaid orders
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone, razorpay_order_id, created_at)
    VALUES (v_cust, 1, 'pending', 'online', 'x', '0', 'order_g_e1', now() - interval '2 hours') RETURNING id INTO op;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (op, pb, 1, 100);
  PERFORM private.expire_pending_orders(30);
  IF (SELECT status FROM public.orders WHERE id = op) <> 'cancelled' THEN RAISE EXCEPTION 'FAIL G6d: expiry job blocked'; END IF;

  ---------------------------------------------------------------- G7 privileges + input checks of the manual procedure
  IF has_function_privilege('authenticated', 'private.manual_refund_decision(bigint,text,text,text)', 'execute')
     OR has_function_privilege('anon', 'private.manual_refund_decision(bigint,text,text,text)', 'execute')
     OR has_function_privilege('service_role', 'private.manual_refund_decision(bigint,text,text,text)', 'execute')
     OR has_function_privilege('authenticated', 'private.manual_held_order_decision(bigint,text,text,text)', 'execute')
     OR has_function_privilege('anon', 'private.manual_held_order_decision(bigint,text,text,text)', 'execute')
     OR has_function_privilege('service_role', 'private.manual_held_order_decision(bigint,text,text,text)', 'execute')
     OR has_function_privilege('authenticated', 'private.manual_act_as(uuid)', 'execute')
     OR has_function_privilege('public', 'private.manual_admin_id(text)', 'execute') THEN
    RAISE EXCEPTION 'FAIL G7a: an API role can execute a manual decision function'; END IF;
  PERFORM set_config('request.jwt.claims', v_cust_claims, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM private.manual_refund_decision(rr, 'approve', v_admin_email, 'x'); RAISE EXCEPTION 'FAIL G7b: customer ran the manual procedure';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT id INTO rr FROM public.refund_requests WHERE order_id = oh2;
  BEGIN PERFORM public.approve_refund(rr); RAISE EXCEPTION 'FAIL G7c: customer approved a refund';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  SELECT id INTO rr FROM public.refund_requests WHERE order_id = orr;
  BEGIN PERFORM private.manual_refund_decision(rr, 'approve', 'nobody@example.invalid', 'x'); RAISE EXCEPTION 'FAIL G7d: unknown admin accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM private.manual_refund_decision(rr, 'approve', v_admin_email, '  '); RAISE EXCEPTION 'FAIL G7e: empty note accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'MANUAL_DECISION%' THEN RAISE; END IF; END;
  -- claims are restored after a manual decision (no lingering impersonation in the transaction)
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM private.manual_refund_decision(rr, 'approve', v_admin_email, 'test: claims restored');
  IF COALESCE(current_setting('request.jwt.claims', true), '') <> '' THEN RAISE EXCEPTION 'FAIL G7f: admin claims left set after the procedure'; END IF;

  PERFORM set_config('request.jwt.claims', v_admin_claims, true);
  r := public.audit_chain_status();
  IF (r->>'intact')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FAIL G8: audit chain broken: %', r; END IF;

  RAISE EXCEPTION 'ALL_PASS admin status guard (% unsafe direct updates blocked: held x8 incl service_role, mismatch x6, rto x7, cancelled-reopen x5, unpaid x4, into-hold x1; legit: refund_held_order, manual fulfil/refund held, manual approve/reject mismatch+rto with idempotent repeats, admin cancel, ship/deliver, COD, customer cancel, settle_payment, courier rto, expiry; privileges; audit chain)', blocked;
END $$;
