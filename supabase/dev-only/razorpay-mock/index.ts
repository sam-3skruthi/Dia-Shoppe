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
    if (id.includes("flaky")) {                       // temporary outage: fails twice, then works
      const { data: a } = await supabase.from("zz_mock_attempts").select("n").eq("payment_id", id).maybeSingle();
      const n = (a?.n ?? 0) + 1;
      await supabase.from("zz_mock_attempts").upsert({ payment_id: id, n });
      if (n <= 2) return json({ error: { description: "mock: temporary gateway error" } }, 503);
    }
    const refundId = `rfnd_mock_${id.slice(-12).replace(/\W/g, "")}`;
    const { error } = await supabase.from("zz_mock_refunds").insert({ payment_id: id, amount: body.amount, refund_id: refundId, rr_id: String(body.notes?.refund_request_id ?? "") });
    if (error) return json({ error: { description: "The payment has been fully refunded already" } }, 400);
    return json({ id: refundId, payment_id: id, amount: body.amount, status: "processed" });
  }

  m = path.match(/^\/v1\/payments\/([^/]+)\/refunds$/);
  if (m && req.method === "GET") {
    const id = decodeURIComponent(m[1]);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data } = await supabase.from("zz_mock_refunds").select("refund_id, amount, rr_id").eq("payment_id", id);
    return json({ entity: "collection", count: data?.length ?? 0,
      items: (data ?? []).map((r: any) => ({ id: r.refund_id, amount: r.amount, status: r.status ?? "processed", notes: { refund_request_id: r.rr_id } })) });
  }

  // DEV test fixtures (zz_mock_payments, created by the test runners): the payment list Razorpay's reconciliation API would return
  if (path === "/v1/payments" && req.method === "GET") {
    const u = new URL(req.url); const from = Number(u.searchParams.get("from") ?? 0); const to = Number(u.searchParams.get("to") ?? 9e12);
    const count = Number(u.searchParams.get("count") ?? 10); const skip = Number(u.searchParams.get("skip") ?? 0);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data } = await supabase.from("zz_mock_payments").select("*").gte("created_at", from).lte("created_at", to).order("created_at").range(skip, skip + count - 1);
    return json({ entity: "collection", count: data?.length ?? 0, items: (data ?? []).map((r: any) => ({ id: r.id, entity: "payment", amount: Number(r.amount), currency: "INR", status: r.status, order_id: r.order_id, captured: r.captured, amount_refunded: Number(r.amount_refunded ?? 0), created_at: Number(r.created_at) })) });
  }

  m = path.match(/^\/v1\/payments\/([^/]+)$/);
  if (m && req.method === "GET") {
    const id = decodeURIComponent(m[1]);
    {
      const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: row } = await supabase.from("zz_mock_payments").select("*").eq("id", id).maybeSingle();
      if (row) return json({ id, entity: "payment", status: row.status, amount: Number(row.amount), currency: "INR", order_id: row.order_id, captured: row.captured, amount_refunded: Number(row.amount_refunded ?? 0), created_at: Number(row.created_at) });
    }
    const [head, orderId] = id.split("__");
    const parts = head.split("_");               // pay, status, amount, unique
    if (!orderId || parts.length < 3) return json({ error: { description: "mock: unknown payment" } }, 404);
    return json({ id, entity: "payment", status: parts[1], amount: Number(parts[2]), currency: "INR", order_id: orderId });
  }

  if (path === "/emails" && req.method === "POST") {          // stands in for Resend in DEV
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await supabase.from("zz_mock_emails").insert({ to_address: String(body.to ?? ""), subject: String(body.subject ?? "") });
    return json({ id: `email_mock_${crypto.randomUUID().slice(0, 8)}` });
  }

  if (path === "/v1/orders" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    return json({ id: `order_mock_${crypto.randomUUID().slice(0, 8)}`, amount: body.amount, currency: "INR", entity: "order" });
  }
  return json({ error: { description: "mock: no such route" } }, 404);
});
