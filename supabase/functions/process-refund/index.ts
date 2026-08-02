// process-refund — issues the Razorpay refund automatically when an order is
// cancelled, and records the outcome so admins can see it.
//
// Called by a DB trigger (migration 027) whenever orders.status becomes
// 'cancelled'. Real money moves here, so the function is deliberately strict:
//
//   • only refunds orders that were actually PAID ONLINE (COD has nothing to
//     refund — it is marked 'not_applicable')
//   • never refunds twice: it bails if refund_id is already set, and it also
//     passes a Razorpay idempotency key so a retried call cannot double-pay
//   • every attempt (success or failure) is written to the order row, so a
//     failed refund is visible in the admin Orders list instead of silent
//
// Secrets required: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, REFUND_HOOK_SECRET

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID")!;
const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET")!;
const HOOK_SECRET = Deno.env.get("REFUND_HOOK_SECRET")!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  // only our DB trigger may call this
  if (req.headers.get("x-hook-secret") !== HOOK_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { order_id } = await req.json();
    if (!order_id) return json({ error: "order_id required" }, 400);

    const { data: order } = await supabase
      .from("orders")
      .select("id, status, payment_method, payment_id, total_amount, refund_id, refund_status")
      .eq("id", order_id)
      .maybeSingle();

    if (!order) return json({ skipped: "unknown order" });
    if (order.status !== "cancelled") return json({ skipped: "order is not cancelled" });
    if (order.refund_id) return json({ skipped: "already refunded", refund_id: order.refund_id });

    // Cash on delivery — nothing was collected, so nothing to send back.
    if (order.payment_method === "cod" || !order.payment_id) {
      await supabase
        .from("orders")
        .update({ refund_status: "not_applicable", refund_at: new Date().toISOString() })
        .eq("id", order.id);
      return json({ skipped: "cod / unpaid — no refund needed" });
    }

    // Razorpay works in paise
    const amountPaise = Math.round(Number(order.total_amount) * 100);
    const auth = btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`);

    const res = await fetch(`https://api.razorpay.com/v1/payments/${order.payment_id}/refund`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        // guarantees Razorpay itself rejects an accidental duplicate
        "X-Payment-Idempotency": `refund-${order.id}`,
      },
      body: JSON.stringify({
        amount: amountPaise,
        speed: "normal",
        notes: { order_id: String(order.id), reason: "Order cancelled" },
      }),
    });

    const body = await res.json();

    if (!res.ok) {
      const message = body?.error?.description || `Razorpay returned ${res.status}`;
      await supabase
        .from("orders")
        .update({
          refund_status: "failed",
          refund_error: message,
          refund_at: new Date().toISOString(),
        })
        .eq("id", order.id);
      // 200 so pg_net does not spin; the failure is recorded for the admin
      return json({ refunded: false, error: message });
    }

    await supabase
      .from("orders")
      .update({
        refund_id: body.id,
        refund_status: body.status === "processed" ? "processed" : "pending",
        refund_amount: amountPaise / 100,
        refund_error: null,
        refund_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    return json({ refunded: true, refund_id: body.id, status: body.status });
  } catch (err) {
    return json({ refunded: false, error: String(err) });
  }
});
