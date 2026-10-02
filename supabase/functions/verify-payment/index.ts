// Dia Shoppe — verifies a Razorpay payment signature and marks the order paid.
// Called by the frontend right after Razorpay's checkout modal reports success.
// Also sends the order-confirmation email via Resend and fires a PostHog
// payment_success event (both best-effort: they never fail the verification).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET")!;
const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID")!;
// overridable so DEV can point at a mock instead of the real Razorpay API
const RAZORPAY_API_BASE = Deno.env.get("RAZORPAY_API_BASE") || "https://api.razorpay.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
// Until a custom domain is verified in Resend, use their shared test sender
// (can only deliver to the Resend account owner's inbox — fine for dev)
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") || "Dia Shoppe <onboarding@resend.dev>";

const POSTHOG_KEY = Deno.env.get("POSTHOG_KEY");
const POSTHOG_HOST = Deno.env.get("POSTHOG_HOST") || "https://us.i.posthog.com";

// Server-side analytics (doc §11) — distinct_id is the Supabase user id so
// these stitch onto the same person as the frontend events
async function trackEvent(userId: string, event: string, properties: Record<string, unknown>) {
  if (!POSTHOG_KEY) return;
  const resp = await fetch(`${POSTHOG_HOST}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: POSTHOG_KEY, event, distinct_id: userId, properties }),
  });
  if (!resp.ok) console.error("PostHog capture failed:", resp.status, await resp.text());
}

const inr = (n: number) => `₹${Number(n).toLocaleString("en-IN")}`;

async function sendConfirmationEmail(
  to: string,
  order: { id: number; total_amount: number; shipping_name: string | null },
  items: { name: string; quantity: number; price: number }[]
) {
  if (!RESEND_API_KEY) return;
  const firstName = order.shipping_name?.split(" ")[0] || "there";
  const rows = items
    .map(
      (i) =>
        `<tr><td style="padding:6px 0;">${i.name} × ${i.quantity}</td><td style="padding:6px 0;text-align:right;">${inr(i.price * i.quantity)}</td></tr>`
    )
    .join("");
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b;">
      <h1 style="color:#1d4ed8;">Thank you for your order, ${firstName}!</h1>
      <p>Your payment was received and order <strong>#${order.id}</strong> is confirmed. We'll email you again when it ships.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
        ${rows}
        <tr><td style="padding:10px 0;border-top:1px solid #e2e8f0;font-weight:bold;">Total Paid</td>
            <td style="padding:10px 0;border-top:1px solid #e2e8f0;text-align:right;font-weight:bold;">${inr(order.total_amount)}</td></tr>
      </table>
      <p style="color:#64748b;font-size:13px;">Dia Shoppe Surgical Distributors — trusted medical equipment since 2004.</p>
    </div>`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to,
      subject: `Order Confirmed — #${order.id} · Dia Shoppe`,
      html,
    }),
  });
  if (!resp.ok) {
    console.error("Resend email failed:", resp.status, await resp.text());
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, internal_order_id } =
      await req.json();

    // Verify signature — proves the payment response really came from Razorpay
    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = await hmacSHA256(RAZORPAY_KEY_SECRET, body);
    if (expectedSignature !== razorpay_signature) {
      return new Response(JSON.stringify({ success: false, error: "Invalid signature" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, user_id, status, razorpay_order_id, total_amount, shipping_name")
      .eq("id", internal_order_id)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ success: false, error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (order.user_id !== user.id) {
      return new Response(JSON.stringify({ success: false, error: "Not your order" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (order.razorpay_order_id !== razorpay_order_id) {
      return new Response(JSON.stringify({ success: false, error: "Order mismatch" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ask Razorpay (server to server) what was really captured - the amount and
    // order come from Razorpay, never from the browser.
    const pr = await fetch(`${RAZORPAY_API_BASE}/v1/payments/${encodeURIComponent(razorpay_payment_id)}`, {
      headers: { Authorization: `Basic ${btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`)}` },
    });
    const payment = await pr.json();
    if (!pr.ok || payment.order_id !== razorpay_order_id) {
      return new Response(JSON.stringify({ success: false, error: "Could not confirm the payment with Razorpay" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ONE atomic DB call records the payment in the ledger, confirms the order
    // (only if still pending) and takes stock. If the order was cancelled first,
    // it creates an automatic full refund instead. Safe to repeat and to race the
    // webhook.
    const { data: result, error: settleError } = await supabase.rpc("settle_payment", {
      p_payment_id: razorpay_payment_id,
      p_rzp_order_id: razorpay_order_id,
      p_amount_paise: payment.amount,
      p_source: "verify-payment",
      p_raw: payment,
    });
    if (settleError) throw settleError;

    const refunded = ["late_payment_refund", "duplicate_payment_refund", "amount_mismatch"].includes(result?.result) ||
      (result?.result === "duplicate_event" && ["cancelled", "rto"].includes(result?.order_status));
    if (refunded) {
      // never tell the customer "paid" for an order that is not going ahead
      const code = result.result === "amount_mismatch" ? "AMOUNT_MISMATCH_UNDER_REVIEW" : "ORDER_CANCELLED_REFUND_INITIATED";
      return new Response(JSON.stringify({ success: false, code, error: "This order was cancelled before your payment arrived. A full refund has been started." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (result?.result !== "confirmed") {
      return new Response(JSON.stringify({ success: true, alreadyProcessed: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // The confirmation email is sent by the order-email function, which fires
    // from a DB trigger on 'confirmed' — so cash-on-delivery orders get one too.

    // Analytics — best-effort
    try {
      await trackEvent(user.id, "payment_success", {
        order_id: order.id,
        amount: Number(order.total_amount),
        payment_id: razorpay_payment_id,
        source: "verify-payment",
      });
    } catch (phError) {
      console.error("PostHog capture failed:", phError);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
