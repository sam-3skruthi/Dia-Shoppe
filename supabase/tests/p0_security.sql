-- Security: cost_price isolation, privilege escalation, price tampering, internal fn access.
DO $$
DECLARE
  v_cust UUID; v_admin UUID; v_cat BIGINT; v_prod BIGINT; v_o BIGINT; n INTEGER; price NUMERIC; ok BOOLEAN;
BEGIN
  SELECT id INTO v_cust  FROM public.user_profiles WHERE role = 'customer' LIMIT 1;
  SELECT id INTO v_admin FROM public.user_profiles WHERE role = 'admin' LIMIT 1;
  SELECT id INTO v_cat FROM public.categories LIMIT 1;
  IF v_cust IS NULL OR v_admin IS NULL THEN RAISE EXCEPTION 'FAIL setup: need one customer and one admin profile'; END IF;

  -- admin writes cost via the legacy column -> must land in the private table, column stays NULL
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.products (name, price, sku, category_id, stock_qty, is_active, cost_price)
    VALUES ('ZZ cost test', 500, 'ZZ-COST', v_cat, 5, true, 321.50) RETURNING id INTO v_prod;
  IF (SELECT cost_price FROM public.products WHERE id = v_prod) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL C1: products.cost_price still holds a value'; END IF;
  IF (SELECT cost_price FROM public.product_costs WHERE product_id = v_prod) IS DISTINCT FROM 321.50 THEN
    RAISE EXCEPTION 'FAIL C2: admin cannot read the stored cost'; END IF;
  UPDATE public.products SET cost_price = 400 WHERE id = v_prod;
  IF (SELECT cost_price FROM public.product_costs WHERE product_id = v_prod) IS DISTINCT FROM 400 THEN
    RAISE EXCEPTION 'FAIL C3: cost update not diverted'; END IF;
  RESET ROLE;

  -- anon: no access to the cost table, nothing in the public column
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM public.product_costs LIMIT 1;
    RAISE EXCEPTION 'FAIL C4: anon could read product_costs';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT count(*) INTO n FROM public.products WHERE cost_price IS NOT NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL C5: anon sees % products with cost_price', n; END IF;
  RESET ROLE;

  -- customer: RLS hides every cost row
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.product_costs;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL C6: customer sees % cost rows', n; END IF;

  -- customer cannot make themselves admin
  BEGIN
    UPDATE public.user_profiles SET role = 'admin' WHERE id = v_cust;
    RAISE EXCEPTION 'FAIL E1: customer updated own role';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- customer cannot touch money columns or call privileged functions
  INSERT INTO public.orders (user_id, total_amount, status, payment_method, shipping_address, shipping_phone)
    VALUES (v_cust, 1, 'pending', 'online', 'x', '0') RETURNING id INTO v_o;
  BEGIN
    UPDATE public.orders SET total_amount = 1 WHERE id = v_o;
    RAISE EXCEPTION 'FAIL E2: customer updated total_amount';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.confirm_online_payment(v_o, 'pay_forged');
    RAISE EXCEPTION 'FAIL E3: customer executed confirm_online_payment';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM private.hook_secret('hook_order_email');
    RAISE EXCEPTION 'FAIL E4: customer read a hook secret';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- price tampering: client claims 1 rupee, DB must charge the catalogue price
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.order_items (order_id, product_id, quantity, price_at_purchase) VALUES (v_o, v_prod, 1, 1);
  RESET ROLE;
  SELECT price_at_purchase INTO price FROM public.order_items WHERE order_id = v_o;
  IF price <> 500 THEN RAISE EXCEPTION 'FAIL P1: price_at_purchase = % (expected 500)', price; END IF;
  IF (SELECT total_amount FROM public.orders WHERE id = v_o) <> 599 THEN
    RAISE EXCEPTION 'FAIL P2: total_amount = % (expected 599 = 500 + 99 shipping)', (SELECT total_amount FROM public.orders WHERE id = v_o); END IF;

  -- hook secrets exist in Vault, are distinct, and no trigger function still embeds a literal
  SELECT count(DISTINCT decrypted_secret) INTO n FROM vault.decrypted_secrets
   WHERE name IN ('hook_whatsapp_notify', 'hook_order_email', 'hook_process_refund');
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL H1: expected 3 distinct vault hook secrets, found %', n; END IF;
  SELECT count(*) INTO n FROM pg_proc
   WHERE proname IN ('notify_whatsapp_status', 'notify_order_email', 'trigger_order_refund')
     AND (prosrc LIKE '%x-hook-secret'', ''%' OR prosrc ~ 'x-hook-secret''\s*,\s*''[0-9a-f]{16,}');
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL H2: % trigger function(s) still embed a literal secret', n; END IF;

  RAISE EXCEPTION 'ALL_PASS security (cost isolation x6, role escalation, money cols, private fns, price tamper, vault secrets)';
END $$;
