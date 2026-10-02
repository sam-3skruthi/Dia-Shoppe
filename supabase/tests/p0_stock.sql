-- Inventory: restock bug regression, atomic confirm, idempotency, floor at zero, flag tamper.
DO $$
DECLARE
  v_user UUID; v_cat BIGINT; v_prod BIGINT; v_prod2 BIGINT;
  v_o BIGINT; v_item BIGINT; s INTEGER; r JSONB;
BEGIN
  SELECT id INTO v_user FROM public.user_profiles LIMIT 1;
  SELECT id INTO v_cat FROM public.categories LIMIT 1;
  INSERT INTO public.products (name, price, sku, category_id, stock_qty, is_active)
    VALUES ('ZZ test A', 100, 'ZZ-TEST-A', v_cat, 10, false) RETURNING id INTO v_prod;
  INSERT INTO public.products (name, price, sku, category_id, stock_qty, is_active)
    VALUES ('ZZ test B', 100, 'ZZ-TEST-B', v_cat, 1, false) RETURNING id INTO v_prod2;

  ---- 1. pending unpaid online order: cancel must NOT add stock
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone)
    VALUES (v_user, 1, 'pending', 'online', 'x', '0') RETURNING id INTO v_o;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (v_o, v_prod, 2, 1);
  SELECT stock_qty INTO s FROM public.products WHERE id = v_prod;
  IF s <> 10 THEN RAISE EXCEPTION 'FAIL 1a: online order must not take stock before payment (got %)', s; END IF;
  UPDATE public.orders SET status = 'cancelled' WHERE id = v_o;
  SELECT stock_qty INTO s FROM public.products WHERE id = v_prod;
  IF s <> 10 THEN RAISE EXCEPTION 'FAIL 1b: pending->cancelled changed stock to % (expected 10)', s; END IF;

  ---- 2. paid order: confirm takes stock once, replay is a no-op, cancel restores once
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone)
    VALUES (v_user, 1, 'pending', 'online', 'x', '0') RETURNING id INTO v_o;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (v_o, v_prod, 2, 1);
  r := public.confirm_online_payment(v_o, 'pay_test_1');
  IF (r->>'won')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FAIL 2a: first confirm should win: %', r; END IF;
  r := public.confirm_online_payment(v_o, 'pay_test_1');
  IF (r->>'won')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'FAIL 2b: replay must not win: %', r; END IF;
  SELECT stock_qty INTO s FROM public.products WHERE id = v_prod;
  IF s <> 8 THEN RAISE EXCEPTION 'FAIL 2c: stock after confirm+replay = % (expected 8)', s; END IF;
  UPDATE public.orders SET status = 'cancelled' WHERE id = v_o;
  SELECT stock_qty INTO s FROM public.products WHERE id = v_prod;
  IF s <> 10 THEN RAISE EXCEPTION 'FAIL 2d: confirmed->cancelled should restore to 10, got %', s; END IF;
  UPDATE public.orders SET status = 'confirmed' WHERE id = v_o;
  UPDATE public.orders SET status = 'cancelled' WHERE id = v_o;
  SELECT stock_qty INTO s FROM public.products WHERE id = v_prod;
  IF s <> 10 THEN RAISE EXCEPTION 'FAIL 2e: repeated cancel restored twice, stock=%', s; END IF;

  ---- 3. COD: stock taken at placement, restored once on cancel
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone)
    VALUES (v_user, 1, 'confirmed', 'cod', 'x', '0') RETURNING id INTO v_o;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (v_o, v_prod, 3, 1);
  SELECT stock_qty INTO s FROM public.products WHERE id = v_prod;
  IF s <> 7 THEN RAISE EXCEPTION 'FAIL 3a: COD placement should take stock (got %)', s; END IF;
  UPDATE public.orders SET status = 'cancelled' WHERE id = v_o;
  SELECT stock_qty INTO s FROM public.products WHERE id = v_prod;
  IF s <> 10 THEN RAISE EXCEPTION 'FAIL 3b: COD cancel should restore (got %)', s; END IF;

  ---- 4. never below zero; restore returns only what was really taken
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone)
    VALUES (v_user, 1, 'pending', 'online', 'x', '0') RETURNING id INTO v_o;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (v_o, v_prod2, 3, 1);
  PERFORM public.confirm_online_payment(v_o, 'pay_test_2');
  SELECT stock_qty INTO s FROM public.products WHERE id = v_prod2;
  IF s <> 0 THEN RAISE EXCEPTION 'FAIL 4a: stock must floor at 0 (got %)', s; END IF;
  UPDATE public.orders SET status = 'cancelled' WHERE id = v_o;
  SELECT stock_qty INTO s FROM public.products WHERE id = v_prod2;
  IF s <> 1 THEN RAISE EXCEPTION 'FAIL 4b: restore must return only the 1 unit taken (got %)', s; END IF;

  ---- 5. client cannot pre-set the accounting flags
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone)
    VALUES (v_user, 1, 'pending', 'online', 'x', '0') RETURNING id INTO v_o;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase, stock_deducted_qty, stock_restored_at)
    VALUES (v_o, v_prod, 1, 1, 5, now()) RETURNING id INTO v_item;
  IF (SELECT stock_deducted_qty FROM public.order_items WHERE id = v_item) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 5: stock_deducted_qty was client-settable'; END IF;

  RAISE EXCEPTION 'ALL_PASS stock (pending-cancel, confirm, replay, double-cancel, COD, floor, flag tamper)';
END $$;
