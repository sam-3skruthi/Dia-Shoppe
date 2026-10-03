// courier-webhook — receives shipment status pushes from the courier
// aggregator (Shiprocket / NimbusPost / direct courier) and moves the order
// through shipped → delivered automatically, so nobody has to click.
//
// Setup (Shiprocket): Settings → API → Webhooks → add
//   URL:   https://<project-ref>.supabase.co/functions/v1/courier-webhook
//   Token: the same value you set as COURIER_WEBHOOK_TOKEN
//
// Secrets to set:
//   supabase secrets set COURIER_WEBHOOK_TOKEN=<a long random string>
//
// The payload shape differs slightly per provider, so we read the common
// fields defensively rather than assuming one vendor's schema.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, content-type",
};

// Courier wording → our order status. Anything not listed is logged but does
// not change the order (e.g. "pickup scheduled", "in transit" are informational).
const STATUS_MAP: Record<string, string> = {
  "shipped": "shipped",
  "in transit": "shipped",
  "out for delivery": "shipped",
  "pickup generated": "shipped",
  "picked up": "shipped",
  "delivered": "delivered",
  // Only the DEFINITIVE return state maps to 'rto': the parcel is back with the seller.
  // "RTO initiated" / "RTO in transit" are deliberately NOT mapped (logged as courier_status only),
  // so stock is not restored and no refund request exists until the item is really back.
  // At 'rto': stock is restored once and an admin must approve any refund (never automatic).
  "rto delivered": "rto",
  "cancelled": "cancelled",
  "canceled": "cancelled",
};

const pick = (obj: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  return null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // shared-secret check — the aggregator sends it as a token header
  const expected = Deno.env.get("COURIER_WEBHOOK_TOKEN");
  const provided =
    req.headers.get("x-api-key") ||
    req.headers.get("x-webhook-token") ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!expected || provided !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    // Shiprocket posts a single object; some providers wrap it in an array
    const payload = Array.isArray(body) ? body[0] : body;

    const rawStatus = pick(payload, ["current_status", "status", "shipment_status", "orderStatus"]);
    const awb = pick(payload, ["awb", "awb_code", "waybill", "tracking_number"]);
    // our order id is echoed back as the merchant/client order reference
    const orderRef = pick(payload, ["order_id", "channel_order_id", "client_order_id", "merchant_order_id"]);
    const courier = pick(payload, ["courier_name", "courier", "carrier"]);

    if (!rawStatus || (!orderRef && !awb)) {
      return new Response(JSON.stringify({ received: true, ignored: "missing status or order reference" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // find the order by our id first, else by the AWB we stored when shipping
    let query = supabase.from("orders").select("id, status").limit(1);
    query = orderRef ? query.eq("id", orderRef) : query.eq("tracking_number", awb);
    const { data: order } = await query.maybeSingle();

    if (!order) {
      return new Response(JSON.stringify({ received: true, ignored: "unknown order" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // normalise "RTO_Delivered" / "rto-delivered" / "RTO  Delivered" to one spelling
    const mapped = STATUS_MAP[rawStatus.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ")];

    const patch: Record<string, unknown> = {
      courier_status: rawStatus,
      courier_updated_at: new Date().toISOString(),
    };
    if (awb) patch.tracking_number = awb;
    if (courier) patch.courier = courier;

    // Never move a finished order backwards, and never resurrect a cancelled one.
    const terminal = new Set(["delivered", "cancelled", "rto"]);
    if (mapped && !terminal.has(order.status) && order.status !== mapped) {
      patch.status = mapped;
      if (mapped === "cancelled") {
        patch.cancellation_reason = `Courier: ${rawStatus}`;
        patch.cancelled_at = new Date().toISOString();
        patch.cancelled_by = "courier";
      }
    }

    await supabase.from("orders").update(patch).eq("id", order.id);

    return new Response(
      JSON.stringify({ received: true, order: order.id, courierStatus: rawStatus, newStatus: patch.status ?? order.status }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    // Always 200 on parse errors so the aggregator doesn't retry forever
    return new Response(JSON.stringify({ received: true, error: String(err) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
