// process-refund — executes ONE approved refund request against Razorpay.
//
// Money moves here, so everything is gated by the database:
//   * the caller must hold the process-refund hook secret (sent by the
//     trg_dispatch_refund trigger, which fires only when a refund_request
//     becomes 'approved' - either automatically for customer/admin cancellations
//     and late payments, or by an ADMIN for RTO / courier / amount-mismatch);
//   * the request is CLAIMED atomically (approved -> processing), so two
//     concurrent calls can never both refund;
//   * a partial unique index guarantees one live refund per payment;
//   * every outcome is written back (processed / failed + error) and audited.
//
// Secrets: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, REFUND_HOOK_SECRET
// Optional: RAZORPAY_API_BASE (DEV mock).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID")!;
const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET")!;
const RAZORPAY_API_BASE = Deno.env.get("RAZORPAY_API_BASE") || "https://api.razorpay.com";
const HOOK_SECRET = Deno.env.get("REFUND_HOOK_SECRET");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  // fail closed: no configured secret means nobody is authorised
  if (!HOOK_SECRET || req.headers.get("x-hook-secret") !== HOOK_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { refund_request_id } = await req.json();
    if (!refund_request_id) return json({ error: "refund_request_id required" }, 400);

    // atomic claim: only an 'approved' request can start, and only once
    const { data: claimed } = await supabase
      .from("refund_requests")
      .update({ status: "processing", processing_since: new Date().toISOString() })
      .eq("id", refund_request_id)
      .eq("status", "approved")
      .select("id, payment_id, order_id, amount, attempts")
      .maybeSingle();
    if (!claimed) return json({ skipped: "not in approved state (already handled, awaiting approval, or unknown)" });

    await supabase.from("refund_requests").update({ attempts: claimed.attempts + 1 }).eq("id", claimed.id);

    const { data: payment } = await supabase
      .from("payments").select("id, razorpay_payment_id, amount").eq("id", claimed.payment_id).single();
    if (!payment) {
      await supabase.from("refund_requests")
        .update({ status: "failed", error: "payment row not found" }).eq("id", claimed.id);
      return json({ refunded: false, error: "payment row not found" });
    }

    const amountPaise = Math.round(Number(claimed.amount) * 100);
    if (amountPaise > Math.round(Number(payment.amount) * 100)) {
      await supabase.from("refund_requests")
        .update({ status: "failed", error: "refund amount exceeds captured amount" }).eq("id", claimed.id);
      return json({ refunded: false, error: "refund amount exceeds captured amount" });
    }

    const auth = btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`);

    // Crash recovery: a previous attempt may already have reached Razorpay but died before
    // saving the result. Ask Razorpay first; if a refund tagged with this request id exists,
    // just record it - never create a second one.
    try {
      const lr = await fetch(`${RAZORPAY_API_BASE}/v1/payments/${payment.razorpay_payment_id}/refunds`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (lr.ok) {
        const list = await lr.json();
        const existing = (list.items ?? []).find((x: any) => String(x?.notes?.refund_request_id) === String(claimed.id));
        if (existing) {
          await supabase.from("refund_requests").update({
            status: "processed", razorpay_refund_id: existing.id, error: null, processed_at: new Date().toISOString(),
          }).eq("id", claimed.id);
          await supabase.from("payments").update({ status: "refunded" }).eq("id", payment.id);
          return json({ refunded: true, reconciled: true, refund_id: existing.id });
        }
      }
      // a failed lookup is not fatal: fall through to the idempotency-keyed create below
    } catch (_e) { /* fall through */ }

    let res: Response, body: any;
    try {
      res = await fetch(`${RAZORPAY_API_BASE}/v1/payments/${payment.razorpay_payment_id}/refund`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
          "X-Payment-Idempotency": `refund-req-${claimed.id}`,
        },
        body: JSON.stringify({
          amount: amountPaise,
          speed: "normal",
          notes: { order_id: String(claimed.order_id), refund_request_id: String(claimed.id) },
        }),
      });
      body = await res.json();
    } catch (netErr) {
      await supabase.from("refund_requests")
        .update({ status: "failed", error: `network: ${String(netErr)}` }).eq("id", claimed.id);
      return json({ refunded: false, error: "network error" });
    }

    if (!res.ok) {
      const message = body?.error?.description || `Razorpay returned ${res.status}`;
      await supabase.from("refund_requests").update({ status: "failed", error: message }).eq("id", claimed.id);
      // 200 so pg_net does not spin; the failure is stored and visible to admins
      return json({ refunded: false, error: message });
    }

    await supabase.from("refund_requests").update({
      status: "processed",
      razorpay_refund_id: body.id,
      error: null,
      processed_at: new Date().toISOString(),
    }).eq("id", claimed.id);
    await supabase.from("payments").update({ status: "refunded" }).eq("id", payment.id);

    return json({ refunded: true, refund_id: body.id, status: body.status });
  } catch (err) {
    console.error("process-refund error:", err);
    return json({ refunded: false, error: String(err) });
  }
});
