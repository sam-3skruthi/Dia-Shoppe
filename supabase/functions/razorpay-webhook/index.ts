// Dia Shoppe — Razorpay webhook (backup verification path).
// Razorpay calls this server-to-server on payment.captured / order.paid, so
// orders get marked paid even if the customer closed their browser before
// the frontend could call verify-payment. Idempotent: if verify-payment
// already handled the order, this does nothing.
//
// Deployed with --no-verify-jwt (Razorpay doesn't send a Supabase JWT);
// authenticity is proven by the x-razorpay-signature HMAC instead.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RAZORPAY_WEBHOOK_SECRET = Deno.env.get("RAZORPAY_WEBHOOK_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const POSTHOG_KEY = Deno.env.get("POSTHOG_KEY");
const POSTHOG_HOST = Deno.env.get("POSTHOG_HOST") || "https://us.i.posthog.com";

async function trackEvent(userId: string, event: string, properties: Record<string, unknown>) {
  if (!POSTHOG_KEY) return;
  const resp = await fetch(`${POSTHOG_HOST}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: POSTHOG_KEY, event, distinct_id: userId, properties }),
  });
  if (!resp.ok) console.error("PostHog capture failed:", resp.status, await resp.text());
}

async function hmacSHA256(key: string, message: string) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req) => {
  try {
    // Verify the webhook signature against the RAW body
    const rawBody = await req.text();
    const signature = req.headers.get("x-razorpay-signature") ?? "";
    const expected = await hmacSHA256(RAZORPAY_WEBHOOK_SECRET, rawBody);
    if (expected !== signature) {
      return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 400 });
    }

    const event = JSON.parse(rawBody);
    if (event.event !== "payment.captured" && event.event !== "order.paid") {
      // Not an event we act on — acknowledge so Razorpay stops retrying
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    const payment = event.payload?.payment?.entity;
    const razorpayOrderId = payment?.order_id;
    const paymentId = payment?.id;
    if (!razorpayOrderId) {
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // One atomic DB call: ledger entry + confirm-if-pending + stock, or an
    // automatic full refund if the order was cancelled before the money arrived.
    // Duplicate deliveries of the same payment are no-ops.
    const { data: result, error: settleError } = await supabase.rpc("settle_payment", {
      p_payment_id: paymentId,
      p_rzp_order_id: razorpayOrderId,
      p_amount_paise: payment.amount,
      p_source: "razorpay-webhook",
      p_raw: payment,
    });
    if (settleError) throw settleError; // 500 -> Razorpay retries the webhook
    if (result?.result !== "confirmed") {
      return new Response(JSON.stringify({ received: true, result: result?.result }), { status: 200 });
    }
    const { data: order } = await supabase
      .from("orders").select("id, user_id, total_amount").eq("razorpay_order_id", razorpayOrderId).maybeSingle();
    if (!order) return new Response(JSON.stringify({ received: true }), { status: 200 });

    // Analytics — best-effort, never fails the webhook ack
    try {
      await trackEvent(order.user_id, "payment_success", {
        order_id: order.id,
        amount: Number(order.total_amount),
        payment_id: paymentId,
        source: "razorpay-webhook",
      });
    } catch (phError) {
      console.error("PostHog capture failed:", phError);
    }

    return new Response(JSON.stringify({ received: true, orderId: order.id }), { status: 200 });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});
