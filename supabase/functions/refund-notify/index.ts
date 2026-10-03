// refund-notify - tells the customer the FINAL outcome of a refund, exactly once.
//
// Called only by DB triggers/cron (hook secret):
//   kind 'refund_processed' - Razorpay confirmed the refund
//   kind 'refund_delayed'   - automatic retries are exhausted; the team has been alerted
// Temporary failures are never sent to the customer: they are retried quietly first.
//
// Exactly-once: a row in customer_notifications (UNIQUE kind + refund + channel) is claimed
// BEFORE sending. A repeated call finds the row and does nothing.
// Channel today: email (Resend). WhatsApp joins through the P1 message queue.
//
// Secrets: REFUND_NOTIFY_HOOK_SECRET, RESEND_API_KEY, EMAIL_FROM (optional), RESEND_API_BASE (DEV mock)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const HOOK_SECRET = Deno.env.get("REFUND_NOTIFY_HOOK_SECRET");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_API_BASE = Deno.env.get("RESEND_API_BASE") || "https://api.resend.com";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") || "Dia Shoppe <onboarding@resend.dev>";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const inr = (n: number) => `Rs. ${Number(n).toLocaleString("en-IN")}`;

Deno.serve(async (req) => {
  if (!HOOK_SECRET || req.headers.get("x-hook-secret") !== HOOK_SECRET) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const { refund_request_id, kind } = await req.json();
    if (!refund_request_id || !["refund_processed", "refund_delayed"].includes(kind)) return json({ error: "bad request" }, 400);

    const { data: rr } = await supabase.from("refund_requests")
      .select("id, order_id, amount, status").eq("id", refund_request_id).maybeSingle();
    if (!rr) return json({ skipped: "unknown refund request" });
    // never announce an outcome the database does not agree with
    if (kind === "refund_processed" && rr.status !== "processed") return json({ skipped: "refund is not processed" });
    if (kind === "refund_delayed" && rr.status !== "failed") return json({ skipped: "refund is not failed" });

    const { data: order } = await supabase.from("orders")
      .select("id, user_id, shipping_name, shipping_email").eq("id", rr.order_id).maybeSingle();
    let to = order?.shipping_email || null;
    if (!to && order?.user_id) {
      const { data: p } = await supabase.from("user_profiles").select("email").eq("id", order.user_id).maybeSingle();
      to = p?.email || null;
    }

    // claim: the UNIQUE constraint makes this exactly-once
    const { data: claim } = await supabase.from("customer_notifications")
      .insert({ kind, order_id: rr.order_id, refund_request_id: rr.id, channel: "email", recipient: to, status: "sending" })
      .select("id").maybeSingle();
    if (!claim) return json({ skipped: "already notified" });

    const finish = (status: string, error?: string) =>
      supabase.from("customer_notifications").update({ status, error: error ?? null }).eq("id", claim.id);

    if (!to) { await finish("skipped", "no email address on the order"); return json({ skipped: "no email address" }); }
    if (!RESEND_API_KEY) { await finish("skipped", "no email provider configured"); return json({ skipped: "no email provider" }); }

    const first = (order?.shipping_name || "there").split(" ")[0];
    const subject = kind === "refund_processed"
      ? `Your refund for order #${rr.order_id} has been processed`
      : `About your refund for order #${rr.order_id}`;
    const body = kind === "refund_processed"
      ? `Hi ${first}, your refund of ${inr(rr.amount)} for order #${rr.order_id} has been processed. It usually reaches your account within 5-7 working days.`
      : `Hi ${first}, we are having trouble completing the refund of ${inr(rr.amount)} for order #${rr.order_id}. Our team has been alerted and will contact you. You do not need to do anything.`;

    const resp = await fetch(`${RESEND_API_BASE}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to, subject, html: `<p>${body}</p><p>Dia Shoppe</p>` }),
    });
    if (!resp.ok) { await finish("failed", `email provider returned ${resp.status}`); return json({ sent: false }); }
    await finish("sent");
    return json({ sent: true });
  } catch (err) {
    console.error("refund-notify error:", String(err));
    return json({ sent: false, error: "internal error" });
  }
});
