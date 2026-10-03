// order-email — sends the order confirmation email for EVERY confirmed order.
//
// Previously the email lived inside verify-payment, so it only ever went to
// customers who paid online; cash-on-delivery buyers got nothing. This runs
// from the same DB trigger that drives the WhatsApp update, so both payment
// methods are covered by one code path.
//
// Idempotent: orders.email_sent_at is stamped after a successful send and
// checked first, so a retried webhook or a status flip-flop cannot send twice.
//
// Secrets: RESEND_API_KEY, EMAIL_FROM (optional), ORDER_EMAIL_HOOK_SECRET

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
// Until a custom domain is verified in Resend, their shared sender only
// delivers to the Resend account owner's own inbox.
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") || "Dia Shoppe <onboarding@resend.dev>";
const HOOK_SECRET = Deno.env.get("ORDER_EMAIL_HOOK_SECRET");
const RESEND_API_BASE = Deno.env.get("RESEND_API_BASE") || "https://api.resend.com";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

const inr = (n: number) => `₹${Number(n).toLocaleString("en-IN")}`;
const esc = (s: string) =>
  String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]!));

function buildHtml(
  order: { id: number; total_amount: number; shipping_name: string | null; payment_method: string },
  items: { name: string; quantity: number; price: number }[],
) {
  const firstName = esc(order.shipping_name?.split(" ")[0] || "there");
  const isCod = order.payment_method === "cod";
  const rows = items
    .map(
      (i) =>
        `<tr><td style="padding:6px 0;">${esc(i.name)} × ${i.quantity}</td>` +
        `<td style="padding:6px 0;text-align:right;">${inr(i.price * i.quantity)}</td></tr>`,
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b;">
      <h1 style="color:#1d4ed8;">Thank you for your order, ${firstName}!</h1>
      <p>Your order <strong>#${order.id}</strong> is confirmed${
        isCod ? " — you'll pay cash when it's delivered" : " and your payment was received"
      }. We'll message you again when it ships.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
        ${rows}
        <tr>
          <td style="padding:10px 0;border-top:1px solid #e2e8f0;font-weight:bold;">${isCod ? "Amount due on delivery" : "Total Paid"}</td>
          <td style="padding:10px 0;border-top:1px solid #e2e8f0;text-align:right;font-weight:bold;">${inr(order.total_amount)}</td>
        </tr>
      </table>
      <p style="color:#64748b;font-size:13px;">Dia Shoppe Surgical Distributors — trusted medical equipment since 2004.</p>
    </div>`;
}

Deno.serve(async (req) => {
  // fail closed: with no secret configured nobody is authorised
  if (!HOOK_SECRET || req.headers.get("x-hook-secret") !== HOOK_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }
  if (!RESEND_API_KEY) return json({ skipped: "RESEND_API_KEY not set" });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { order_id } = await req.json();
    if (!order_id) return json({ error: "order_id required" }, 400);

    const { data: order } = await supabase
      .from("orders")
      .select("id, status, total_amount, shipping_name, shipping_email, payment_method, email_sent_at, user_id")
      .eq("id", order_id)
      .maybeSingle();

    if (!order) return json({ skipped: "unknown order" });
    if (order.status !== "confirmed") return json({ skipped: `status is ${order.status}` });
    if (order.email_sent_at) return json({ skipped: "already emailed" });

    // checkout email first; fall back to the account address
    let to = order.shipping_email;
    if (!to && order.user_id) {
      const { data: profile } = await supabase
        .from("user_profiles").select("email").eq("id", order.user_id).maybeSingle();
      to = profile?.email || null;
    }
    if (!to) return json({ skipped: "no email address on the order" });

    const { data: items } = await supabase
      .from("order_items")
      .select("quantity, price_at_purchase, products(name)")
      .eq("order_id", order.id);

    const lines = (items || []).map((i: any) => ({
      name: i.products?.name || "Item",
      quantity: i.quantity,
      price: Number(i.price_at_purchase),
    }));

    const resp = await fetch(`${RESEND_API_BASE}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to,
        subject: `Order Confirmed — #${order.id} · Dia Shoppe`,
        html: buildHtml(order as any, lines),
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      console.error("Resend failed:", resp.status, detail);
      return json({ sent: false, error: detail });
    }

    // stamp only after a confirmed success, so a failure can be retried
    await supabase.from("orders").update({ email_sent_at: new Date().toISOString() }).eq("id", order.id);
    return json({ sent: true, to });
  } catch (err) {
    return json({ sent: false, error: String(err) });
  }
});
