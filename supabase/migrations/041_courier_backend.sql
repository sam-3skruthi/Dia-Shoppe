-- 041 — provider-neutral courier backend (DEV first; NOT applied to production)
--
-- The courier provider has NOT been chosen and no provider documentation or credentials are available, so NO provider wording is
-- hard-coded or guessed. Instead:
--   courier_status_map : (provider, normalised provider wording) -> one of OUR canonical events. Empty for every real provider until
--                        someone reads that provider's documentation and fills it in (set_courier_mapping, admin only).
--                        The built-in provider 'canonical' maps our own event names to themselves (testing / a future adapter).
--   courier_events     : every webhook call, deduplicated, with what was done about it (audit trail, replay-safe).
--   courier_apply_event: ONE atomic function that applies an event to an order. Idempotent. Never moves a finished order backwards.
-- Canonical events: shipped, in_transit, out_for_delivery, delivered, rto_initiated, rto_in_transit, rto_delivered, shipment_cancelled, ignore
-- Effects on the order:
--   shipped / in_transit / out_for_delivery : courier status recorded; confirmed|paid -> shipped
--   delivered                               : shipped|confirmed|paid -> delivered
--   rto_initiated / rto_in_transit          : recorded ONLY (stock is not restored, no refund exists while the parcel is still travelling)
--   rto_delivered (back with the seller)    : shipped|confirmed|paid -> 'rto'. The existing triggers then restore stock EXACTLY ONCE and open a
--                                             refund request that needs ADMIN approval (never automatic)
--   shipment_cancelled                      : recorded + admin alert only. A cancelled SHIPMENT is not a cancelled ORDER; nothing is refunded
--   anything else / unknown wording         : recorded, order untouched, one open "unmapped status" alert per wording
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.courier_status_map (
  provider       TEXT NOT NULL,
  raw_normalized TEXT NOT NULL,          -- lower case, '_' and '-' turned into spaces, whitespace collapsed
  event          TEXT NOT NULL CHECK (event IN ('shipped', 'in_transit', 'out_for_delivery', 'delivered', 'rto_initiated', 'rto_in_transit',
                                                'rto_delivered', 'shipment_cancelled', 'ignore')),
  note           TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, raw_normalized)
);
INSERT INTO public.courier_status_map (provider, raw_normalized, event, note) VALUES
  ('canonical', 'shipped', 'shipped', 'our own vocabulary'), ('canonical', 'in transit', 'in_transit', 'our own vocabulary'),
  ('canonical', 'out for delivery', 'out_for_delivery', 'our own vocabulary'), ('canonical', 'delivered', 'delivered', 'our own vocabulary'),
  ('canonical', 'rto initiated', 'rto_initiated', 'our own vocabulary'), ('canonical', 'rto in transit', 'rto_in_transit', 'our own vocabulary'),
  ('canonical', 'rto delivered', 'rto_delivered', 'our own vocabulary'), ('canonical', 'shipment cancelled', 'shipment_cancelled', 'our own vocabulary')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.courier_events (
  id            BIGSERIAL PRIMARY KEY,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider      TEXT NOT NULL,
  event_key     TEXT NOT NULL,
  order_id      BIGINT,
  awb           TEXT,
  raw_status    TEXT NOT NULL,
  event         TEXT,                     -- canonical event, null when unmapped
  result        TEXT NOT NULL,
  UNIQUE (provider, event_key)
);

CREATE OR REPLACE FUNCTION public.courier_apply_event(
  p_provider TEXT, p_event_key TEXT, p_order_ref TEXT, p_awb TEXT, p_raw_status TEXT, p_courier TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE o public.orders%ROWTYPE; v_norm TEXT; v_event TEXT; v_result TEXT; v_new_status TEXT; v_hash BIGINT; v_id BIGINT;
BEGIN
  v_norm := trim(regexp_replace(regexp_replace(lower(coalesce(p_raw_status, '')), '[_-]+', ' ', 'g'), '\s+', ' ', 'g'));
  IF v_norm = '' THEN RETURN jsonb_build_object('result', 'ignored_no_status'); END IF;

  INSERT INTO public.courier_events (provider, event_key, awb, raw_status, result) VALUES (p_provider, p_event_key, p_awb, left(p_raw_status, 200), 'received')
  ON CONFLICT (provider, event_key) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('result', 'duplicate'); END IF;

  -- resolve the order: our id first, else the tracking number we stored when shipping; both given must agree
  IF p_order_ref ~ '^\d{1,12}$' THEN SELECT * INTO o FROM public.orders WHERE id = p_order_ref::bigint FOR UPDATE; END IF;
  IF o.id IS NULL AND p_awb IS NOT NULL THEN SELECT * INTO o FROM public.orders WHERE tracking_number = p_awb ORDER BY id DESC LIMIT 1 FOR UPDATE; END IF;
  IF o.id IS NULL THEN
    UPDATE public.courier_events SET result = 'unknown_order' WHERE id = v_id;
    RETURN jsonb_build_object('result', 'unknown_order');
  END IF;
  IF p_awb IS NOT NULL AND o.tracking_number IS NOT NULL AND o.tracking_number <> p_awb THEN
    v_hash := abs(hashtext(p_provider || ':' || o.id || ':' || p_awb))::bigint;
    PERFORM private.raise_ops_event('warning', 'courier', 'courier_reference_mismatch',
      'A courier event carries a tracking number that differs from the order''s; it was NOT applied', 'order', o.id, jsonb_build_object('awb', p_awb, 'stored', o.tracking_number));
    UPDATE public.courier_events SET order_id = o.id, result = 'reference_mismatch' WHERE id = v_id;
    RETURN jsonb_build_object('result', 'reference_mismatch', 'order_id', o.id);
  END IF;

  SELECT event INTO v_event FROM public.courier_status_map WHERE provider = p_provider AND raw_normalized = v_norm;
  UPDATE public.orders SET courier_status = left(p_raw_status, 200), courier_updated_at = now(),
         tracking_number = coalesce(tracking_number, p_awb), courier = coalesce(courier, left(p_courier, 100))
   WHERE id = o.id;

  IF v_event IS NULL THEN
    v_hash := abs(hashtext(p_provider || ':' || v_norm))::bigint;
    PERFORM private.raise_ops_event('info', 'courier', 'courier_status_unmapped',
      'Courier "' || p_provider || '" sent a status we have no mapping for: "' || left(p_raw_status, 80) || '" (order untouched)', 'courier_status', v_hash,
      jsonb_build_object('provider', p_provider, 'raw', p_raw_status));
    v_result := 'unmapped';
  ELSIF v_event = 'ignore' THEN v_result := 'ignored';
  ELSIF v_event IN ('in_transit', 'out_for_delivery', 'shipped') THEN
    IF o.status IN ('confirmed', 'paid') THEN UPDATE public.orders SET status = 'shipped' WHERE id = o.id; v_new_status := 'shipped'; v_result := 'applied';
    ELSE v_result := 'recorded'; END IF;
  ELSIF v_event = 'delivered' THEN
    IF o.status IN ('shipped', 'confirmed', 'paid') THEN UPDATE public.orders SET status = 'delivered' WHERE id = o.id; v_new_status := 'delivered'; v_result := 'applied';
    ELSIF o.status = 'delivered' THEN v_result := 'already_delivered';
    ELSE
      PERFORM private.raise_ops_event('warning', 'courier', 'courier_conflict',
        'Courier says delivered but the order is ' || o.status, 'order', o.id, jsonb_build_object('event', v_event, 'order_status', o.status));
      v_result := 'conflict';
    END IF;
  ELSIF v_event IN ('rto_initiated', 'rto_in_transit') THEN v_result := 'recorded';
  ELSIF v_event = 'rto_delivered' THEN
    IF o.status IN ('shipped', 'confirmed', 'paid') THEN
      UPDATE public.orders SET status = 'rto' WHERE id = o.id;      -- triggers: stock restored once, refund request (admin approval)
      v_new_status := 'rto'; v_result := 'applied';
    ELSIF o.status = 'rto' THEN v_result := 'already_rto';
    ELSE
      PERFORM private.raise_ops_event('warning', 'courier', 'courier_conflict',
        'Courier says the parcel is back with the seller but the order is ' || o.status, 'order', o.id, jsonb_build_object('event', v_event, 'order_status', o.status));
      v_result := 'conflict';
    END IF;
  ELSIF v_event = 'shipment_cancelled' THEN
    PERFORM private.raise_ops_event('warning', 'courier', 'courier_shipment_cancelled',
      'The courier cancelled the shipment for this order; decide whether to reship or cancel the order', 'order', o.id, jsonb_build_object('raw', p_raw_status));
    v_result := 'alerted';
  END IF;

  UPDATE public.courier_events SET order_id = o.id, event = v_event, result = v_result WHERE id = v_id;
  RETURN jsonb_build_object('result', v_result, 'event', v_event, 'order_id', o.id, 'order_status', coalesce(v_new_status, o.status));
END $$;

-- admin-only mapping maintenance (after reading the provider's documentation)
CREATE OR REPLACE FUNCTION public.set_courier_mapping(p_provider TEXT, p_raw TEXT, p_event TEXT, p_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only' USING ERRCODE = '42501'; END IF;
  IF p_provider = 'canonical' THEN RAISE EXCEPTION 'the canonical mapping is fixed'; END IF;
  INSERT INTO public.courier_status_map (provider, raw_normalized, event, note)
  VALUES (p_provider, trim(regexp_replace(regexp_replace(lower(p_raw), '[_-]+', ' ', 'g'), '\s+', ' ', 'g')), p_event, p_note)
  ON CONFLICT (provider, raw_normalized) DO UPDATE SET event = EXCLUDED.event, note = EXCLUDED.note, updated_at = now();
END $$;

ALTER TABLE public.courier_status_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_events ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['courier_status_map', 'courier_events'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Admins read %1$s" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "Admins read %1$s" ON public.%1$I FOR SELECT USING (public.is_admin())', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
REVOKE ALL ON FUNCTION public.courier_apply_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.courier_apply_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.set_courier_mapping(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_courier_mapping(TEXT, TEXT, TEXT, TEXT) TO authenticated;
