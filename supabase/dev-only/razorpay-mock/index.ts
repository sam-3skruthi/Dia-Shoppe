// DEV ONLY - a stand-in for the Razorpay REST API so payment/refund logic can be
// tested without real credentials. It is NOT in supabase/functions on purpose, is
// deployed only by the DEV bootstrap script, and refuses to answer unless the
// function secret ENVIRONMENT=dev is set.
//
//   GET  /v1/payments/:id          -> payment entity decoded from the id
//   POST /v1/payments/:id/refund   -> first call succeeds, repeat call = 400 (like Razorpay)
//   POST /v1/orders                -> fake order
//
// Payment ids encode the scenario so tests need no state:
//   pay_<status>_<amountPaise>_<unique>__<razorpayOrderId>
//   e.g. pay_captured_149900_a1__order_zz_1
//   an id containing "failrefund" makes the refund call fail.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (Deno.env.get("ENVIRONMENT") !== "dev") return json({ error: "not available" }, 404);
  const path = new URL(req.url).pathname.split("/razorpay-mock")[1] ?? "";

  let m = path.match(/^\/v1\/payments\/([^/]+)\/refund$/);
  if (m && req.method === "POST") {
    const id = decodeURIComponent(m[1]);
    const body = await req.json().catch(() => ({}));
    if (id.includes("failrefund")) return json({ error: { description: "mock: refund rejected by bank" } }, 400);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const refundId = `rfnd_mock_${id.slice(-12).replace(/\W/g, "")}`;
    const { error } = await supabase.from("zz_mock_refunds").insert({ payment_id: id, amount: body.amount, refund_id: refundId });
    if (error) return json({ error: { description: "The payment has been fully refunded already" } }, 400);
    return json({ id: refundId, payment_id: id, amount: body.amount, status: "processed" });
  }

  m = path.match(/^\/v1\/payments\/([^/]+)$/);
  if (m && req.method === "GET") {
    const id = decodeURIComponent(m[1]);
    const [head, orderId] = id.split("__");
    const parts = head.split("_");               // pay, status, amount, unique
    if (!orderId || parts.length < 3) return json({ error: { description: "mock: unknown payment" } }, 404);
    return json({ id, entity: "payment", status: parts[1], amount: Number(parts[2]), currency: "INR", order_id: orderId });
  }

  if (path === "/v1/orders" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    return json({ id: `order_mock_${crypto.randomUUID().slice(0, 8)}`, amount: body.amount, currency: "INR", entity: "order" });
  }
  return json({ error: { description: "mock: no such route" } }, 404);
});
