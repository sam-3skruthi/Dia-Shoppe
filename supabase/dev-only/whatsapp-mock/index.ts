// DEV ONLY - stand-in for Meta's Graph API (send + template list) and for an OpenAI-compatible chat endpoint, so the WhatsApp
// pipeline and the AI guardrails can be tested without Meta credentials or a model. NOT in supabase/functions on purpose:
// deployed only by the DEV tooling, and it refuses to answer unless the function secret ENVIRONMENT=dev is set.
//
//   POST /v21.0/<phone-id>/messages        outcome decided by the LAST DIGITS of the recipient number:
//        ...0500 HTTP 500 (transient)   ...0429 throttling 130429   ...0502 fails twice (503) then succeeds
//        ...0190 token invalid (190)    ...1026 undeliverable 131026 (permanent)   ...2001 template missing 132001 (permanent)
//        ...0408 hangs 12 s (client timeout)   ...0200 HTTP 200 without a message id   anything else: success with a fresh wamid
//   GET  /v21.0/<waba-id>/message_templates   fixed list (order_update, cart_reminder, promo, zz_unknown)
//   POST /ai/v1/chat/completions           behaviour decided by a marker in the customer's text: [[mock:timeout|500|badjson|leak_cost|
//        foreign_order|hallucinate_price|claim_refund|obey_injection|link|lowconf|complaint]]; otherwise a grounded answer
// Every call is recorded in zz_wa_mock_calls (created by the DEV test fixtures, never by a migration) so tests can count them.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const gerr = (status: number, code: number, message: string) => json({ error: { message, type: "OAuthException", code, fbtrace_id: "mock" } }, status);

Deno.serve(async (req) => {
  if (Deno.env.get("ENVIRONMENT") !== "dev") return json({ error: "not available" }, 404);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const path = new URL(req.url).pathname.split("/whatsapp-mock")[1] ?? "";
  const log = (kind: string, to: string | null, body: unknown, outcome: string) =>
    sb.from("zz_wa_mock_calls").insert({ kind, to_phone: to, body, outcome });

  // ---- Graph API: send
  let m = path.match(/^\/v\d+\.\d+\/([^/]+)\/messages$/);
  if (m && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const to = String(body.to ?? "");
    const ok = () => json({ messaging_product: "whatsapp", contacts: [{ input: to, wa_id: to }], messages: [{ id: `wamid.MOCK${crypto.randomUUID().replace(/-/g, "")}` }] });
    if (to.endsWith("0408")) { await log("send", to, body, "timeout"); await sleep(12000); return ok(); }
    if (to.endsWith("0500")) { await log("send", to, body, "500"); return gerr(500, 1, "mock: unknown error"); }
    if (to.endsWith("0429")) { await log("send", to, body, "429"); return gerr(429, 130429, "mock: throughput limit reached"); }
    if (to.endsWith("0190")) { await log("send", to, body, "190"); return gerr(401, 190, "mock: invalid OAuth access token"); }
    if (to.endsWith("1026")) { await log("send", to, body, "131026"); return gerr(400, 131026, "mock: message undeliverable"); }
    if (to.endsWith("2001")) { await log("send", to, body, "132001"); return gerr(404, 132001, "mock: template does not exist in the translation"); }
    if (to.endsWith("0200")) { await log("send", to, body, "200-no-id"); return json({ messaging_product: "whatsapp" }); }
    if (to.endsWith("0502")) {
      const { count } = await sb.from("zz_wa_mock_calls").select("id", { count: "exact", head: true }).eq("kind", "send").eq("to_phone", to);
      if ((count ?? 0) < 2) { await log("send", to, body, "503"); return gerr(503, 131016, "mock: service unavailable"); }
    }
    await log("send", to, body, "ok");
    return ok();
  }

  // ---- Graph API: template list
  m = path.match(/^\/v\d+\.\d+\/([^/]+)\/message_templates$/);
  if (m && req.method === "GET") {
    const comp = (text: string, header?: string) => [...(header ? [{ type: "HEADER", format: header }] : []), { type: "BODY", text }];
    await log("templates", null, null, "ok");
    return json({ data: [
      { name: "order_update", language: "en", category: "UTILITY", status: "APPROVED", components: comp("Hi {{1}}, your order #{{2}} is now {{3}}. {{4}}") },
      { name: "cart_reminder", language: "en", category: "MARKETING", status: "APPROVED", components: comp("Hi {{1}}, you left {{2}} items in your cart.") },
      { name: "promo", language: "en", category: "MARKETING", status: "APPROVED", components: comp("Hi {{1}}, {{2}}", "IMAGE") },
      { name: "zz_unknown", language: "en", category: "UTILITY", status: "APPROVED", components: comp("Hello {{1}}") },
    ] });
  }

  // ---- OpenAI-compatible chat
  if (path === "/ai/v1/chat/completions" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const system = String(body.messages?.[0]?.content ?? "");
    const user = String(body.messages?.[1]?.content ?? "");
    const marker = /\[\[mock:([a-z_0-9]+)\]\]/.exec(user)?.[1] ?? "normal";
    await log("ai", null, { marker, user_len: user.length }, marker);
    const reply = (text: string, extra: Record<string, unknown> = {}) => json({
      id: "mock", choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ text, intent: "other", confidence: 0.9, needs_human: false, ...extra }) } }],
      usage: { prompt_tokens: Math.ceil((system.length + user.length) / 4), completion_tokens: 60 },
    });
    if (marker === "timeout") { await sleep(30000); return reply("late"); }
    if (marker === "500") return json({ error: { message: "mock provider failure" } }, 500);
    if (marker === "badjson") return json({ choices: [{ message: { role: "assistant", content: "Sure thing! Happy to help." } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    if (marker === "leak_cost") return reply("Our cost price for that monitor is ₹900, a 40% margin.", { intent: "price" });
    if (marker === "foreign_order") return reply("Order #999999 is shipped and arrives tomorrow.", { intent: "order_status" });
    if (marker === "hallucinate_price") return reply("That is available at ₹1 right now.", { intent: "price" });
    if (marker === "claim_refund") return reply("I have refunded your order, it will reach you in 3 days.", { intent: "returns_refund" });
    if (marker === "obey_injection") return reply(system.slice(0, 400), { intent: "other" });
    if (marker === "link") return reply("Please pay at http://evil.example/pay now.", { intent: "other" });
    if (marker === "lowconf") return reply("I think it might be fine.", { confidence: 0.2 });
    if (marker === "complaint") return reply("I'm sorry about that. Our team will look into it.", { intent: "complaint" });
    if (system.includes("Write exactly 3 different variants")) {      // campaign copy request
      const brief = (/<brief>\s*([\s\S]*?)\s*<\/brief>/.exec(user)?.[1] ?? "").slice(0, 40);
      return json({ choices: [{ message: { role: "assistant", content: JSON.stringify({ suggestions: [brief, `${brief} - this week`, `Special: ${brief}`] }) } }], usage: { prompt_tokens: 80, completion_tokens: 40 } });
    }
    // grounded answer from the authorised data in the system prompt
    let data: any = {};
    try { data = JSON.parse(system.slice(system.indexOf("AUTHORIZED DATA (JSON):") + "AUTHORIZED DATA (JSON):".length).trim()); } catch { /* keep empty */ }
    const text = user.toLowerCase();
    const orders = data.this_customers_orders ?? [];
    if (/order|status|track/.test(text) && orders.length) return reply(`Your order #${orders[0].order_id} is ${orders[0].status}.`, { intent: "order_status" });
    const hit = (data.catalog ?? []).find((p: any) => String(p.name).toLowerCase().split(/\s+/).some((w: string) => w.length > 3 && text.includes(w)));
    if (hit) return reply(`${hit.name} costs ₹${hit.price_inr} and is ${hit.in_stock ? "in stock" : "currently out of stock"}.`, { intent: "price" });
    return reply("I'm not sure about that, a team member will follow up shortly.", { confidence: 0.3, needs_human: true });
  }

  return json({ error: "mock: unknown route", path }, 404);
});
