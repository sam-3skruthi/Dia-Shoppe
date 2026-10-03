-- Migration 036: an order is NEVER confirmed unless its full quantity was taken from stock.
-- Rolls back; leaves nothing behind.
DO $$
DECLARE
  v_cust UUID; v_admin UUID; v_cat BIGINT; v_p BIGINT;
  oa BIGINT; ob BIGINT; oc BIGINT; od BIGINT; oe BIGINT;
  r JSONB; n INTEGER; s INTEGER; v_req BIGINT;
BEGIN
  SELECT id INTO v_cust  FROM public.user_profiles WHERE role = 'customer' LIMIT 1;
  SELECT id INTO v_admin FROM public.user_profiles WHERE role = 'admin' LIMIT 1;
  SELECT id INTO v_cat FROM public.categories LIMIT 1;
  INSERT INTO public.products (name, price, sku, category_id, stock_qty, is_active)
    VALUES ('ZZ stock', 100, 'ZZ-STK', v_cat, 5, false) RETURNING id INTO v_p;

  ---- S1 an order line for more than exists is refused outright
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone)
    VALUES (v_cust, 1, 'pending', 'online', 'x', '0') RETURNING id INTO oa;
  BEGIN
    INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (oa, v_p, 6, 1);
    RAISE EXCEPTION 'FAIL S1: 6 units accepted with 5 in stock';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM NOT LIKE 'INSUFFICIENT_STOCK%' THEN RAISE; END IF;
  END;

  ---- S2 COD: exact fit is accepted and fully deducted; the next unit is refused, stock untouched
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone)
    VALUES (v_cust, 1, 'confirmed', 'cod', 'x', '0') RETURNING id INTO oa;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (oa, v_p, 5, 1);
  IF (SELECT stock_qty FROM public.products WHERE id = v_p) <> 0 THEN RAISE EXCEPTION 'FAIL S2a: COD exact fit not fully deducted'; END IF;
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone)
    VALUES (v_cust, 1, 'confirmed', 'cod', 'x', '0') RETURNING id INTO ob;
  BEGIN
    INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (ob, v_p, 1, 1);
    RAISE EXCEPTION 'FAIL S2b: COD line accepted with zero stock';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
  IF (SELECT stock_qty FROM public.products WHERE id = v_p) <> 0 THEN RAISE EXCEPTION 'FAIL S2c: refused COD line changed stock'; END IF;
  UPDATE public.products SET stock_qty = 3 WHERE id = v_p;

  ---- S3 two online orders both fit at creation (3 in stock) but only one can be paid for
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone, razorpay_order_id)
    VALUES (v_cust, 1, 'pending', 'online', 'x', '0', 'order_s3a') RETURNING id INTO oa;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (oa, v_p, 3, 1);     -- 399
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone, razorpay_order_id)
    VALUES (v_cust, 1, 'pending', 'online', 'x', '0', 'order_s3b') RETURNING id INTO ob;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (ob, v_p, 2, 1);     -- 299
  r := public.settle_payment('pay_s3a', 'order_s3a', 39900, 'test');
  IF r->>'result' <> 'confirmed' OR (SELECT stock_qty FROM public.products WHERE id = v_p) <> 0 THEN RAISE EXCEPTION 'FAIL S3a: %', r; END IF;

  r := public.settle_payment('pay_s3b', 'order_s3b', 29900, 'test');
  IF r->>'result' <> 'held_insufficient_stock' THEN RAISE EXCEPTION 'FAIL S3b: expected hold, got %', r; END IF;
  IF (SELECT status || '/' || hold_reason FROM public.orders WHERE id = ob) <> 'on_hold/insufficient_stock' THEN RAISE EXCEPTION 'FAIL S3c: order not on hold'; END IF;
  IF (SELECT stock_qty FROM public.products WHERE id = v_p) <> 0 THEN RAISE EXCEPTION 'FAIL S3d: stock moved on a held order'; END IF;
  IF (SELECT stock_deducted_qty FROM public.order_items WHERE order_id = ob) IS NOT NULL THEN RAISE EXCEPTION 'FAIL S3e: partial deduction recorded'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payments WHERE razorpay_payment_id = 'pay_s3b' AND order_id = ob) THEN RAISE EXCEPTION 'FAIL S3f: payment not recorded'; END IF;
  SELECT id INTO v_req FROM public.refund_requests WHERE order_id = ob;
  IF (SELECT reason || '/' || status || '/' || requires_approval::text FROM public.refund_requests WHERE id = v_req) <> 'insufficient_stock/requested/true' THEN
    RAISE EXCEPTION 'FAIL S3g: refund request not opened for admin review'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ops_events WHERE code = 'insufficient_stock' AND entity_id = ob AND severity = 'critical' AND resolved_at IS NULL) THEN
    RAISE EXCEPTION 'FAIL S3h: no admin-visible ops event'; END IF;

  ---- S4 idempotent: the same payment event again changes nothing
  r := public.settle_payment('pay_s3b', 'order_s3b', 29900, 'test');
  IF r->>'result' <> 'duplicate_event' THEN RAISE EXCEPTION 'FAIL S4a: %', r; END IF;
  SELECT count(*) INTO n FROM public.refund_requests WHERE order_id = ob;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL S4b: % refund requests', n; END IF;
  SELECT count(*) INTO n FROM public.ops_events WHERE code = 'insufficient_stock' AND entity_id = ob;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL S4c: % ops events', n; END IF;

  ---- S5 a customer can resolve nothing
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.refund_held_order(ob); RAISE EXCEPTION 'FAIL S5a'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.fulfil_held_order(ob);  RAISE EXCEPTION 'FAIL S5b'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT count(*) INTO n FROM public.ops_events; IF n <> 0 THEN RAISE EXCEPTION 'FAIL S5c: customer reads ops events'; END IF;
  RESET ROLE;

  ---- S6 admin refunds the held order: cancelled, refund approved by that admin, alert resolved, stock unchanged
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.ops_events WHERE resolved_at IS NULL;
  IF n < 1 THEN RAISE EXCEPTION 'FAIL S6a: admin cannot see open alerts'; END IF;
  PERFORM public.refund_held_order(ob);
  RESET ROLE;
  IF (SELECT status FROM public.orders WHERE id = ob) <> 'cancelled' THEN RAISE EXCEPTION 'FAIL S6b'; END IF;
  IF (SELECT status || '/' || approved_by::text FROM public.refund_requests WHERE id = v_req) <> 'approved/' || v_admin::text THEN RAISE EXCEPTION 'FAIL S6c: approver not recorded'; END IF;
  IF EXISTS (SELECT 1 FROM public.ops_events WHERE code = 'insufficient_stock' AND entity_id = ob AND resolved_at IS NULL) THEN RAISE EXCEPTION 'FAIL S6d: alert not resolved'; END IF;
  IF (SELECT stock_qty FROM public.products WHERE id = v_p) <> 0 THEN RAISE EXCEPTION 'FAIL S6e: stock changed by refunding a held order'; END IF;

  ---- S7 admin fulfils a held order after restocking (and cannot while still short)
  UPDATE public.products SET stock_qty = 2 WHERE id = v_p;
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone, razorpay_order_id)
    VALUES (v_cust, 1, 'pending', 'online', 'x', '0', 'order_s7') RETURNING id INTO oc;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (oc, v_p, 2, 1);     -- 299
  UPDATE public.products SET stock_qty = 1 WHERE id = v_p;                                                         -- someone else bought one
  r := public.settle_payment('pay_s7', 'order_s7', 29900, 'test');
  IF r->>'result' <> 'held_insufficient_stock' THEN RAISE EXCEPTION 'FAIL S7a: %', r; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.fulfil_held_order(oc); RAISE EXCEPTION 'FAIL S7b: fulfilled while short';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  RESET ROLE;
  UPDATE public.products SET stock_qty = 5 WHERE id = v_p;
  SET LOCAL ROLE authenticated;
  PERFORM public.fulfil_held_order(oc);
  RESET ROLE;
  IF (SELECT status FROM public.orders WHERE id = oc) <> 'confirmed' OR (SELECT stock_qty FROM public.products WHERE id = v_p) <> 3 THEN
    RAISE EXCEPTION 'FAIL S7c: fulfilment did not confirm + deduct exactly 2'; END IF;
  IF (SELECT status FROM public.refund_requests WHERE order_id = oc) <> 'rejected' THEN RAISE EXCEPTION 'FAIL S7d: refund request not closed'; END IF;

  ---- S8 the invariant, stated as a query: no confirmed/shipped/delivered order of ours has an undeducted or short line
  SELECT count(*) INTO n FROM public.orders o JOIN public.order_items oi ON oi.order_id = o.id
   WHERE o.user_id = v_cust AND o.status IN ('confirmed', 'shipped', 'delivered')
     AND (oi.stock_deducted_qty IS NULL OR oi.stock_deducted_qty < oi.quantity);
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL S8: % confirmed order line(s) not fully deducted', n; END IF;

  ---- S9 safety net: an order whose items never arrived is cancelled; a recent or complete one is not
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone, created_at)
    VALUES (v_cust, 1, 'confirmed', 'cod', 'x', '0', now() - interval '20 minutes') RETURNING id INTO od;
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone)
    VALUES (v_cust, 1, 'confirmed', 'cod', 'x', '0') RETURNING id INTO oe;
  PERFORM private.cancel_empty_orders(10);
  IF (SELECT status FROM public.orders WHERE id = od) <> 'cancelled' THEN RAISE EXCEPTION 'FAIL S9a: stale empty order kept'; END IF;
  IF (SELECT status FROM public.orders WHERE id = oe) <> 'confirmed' THEN RAISE EXCEPTION 'FAIL S9b: fresh order cancelled'; END IF;
  IF (SELECT status FROM public.orders WHERE id = oc) <> 'confirmed' THEN RAISE EXCEPTION 'FAIL S9c: order with items cancelled'; END IF;

  RAISE EXCEPTION 'ALL_PASS stock invariant (refuse oversize line, COD exact fit, hold instead of short-confirm, no partial deduction, idempotent, alert, RBAC, admin refund + fulfil, invariant query, empty-order sweep)';
END $$;
