// Dia Shoppe — admin co-pilot. Answers shop-staff questions and flags problems
// on the dashboard. Admin-only (JWT-verified). Reads a live "store health"
// snapshot (pending orders, stock alerts, failed WhatsApp sends, today's sales)
// and asks Claude to explain / advise. Without ANTHROPIC_API_KEY it returns a
// rule-based health summary instead, so it's useful even before AI credits.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Browser-invoked function: the admin UI calls this with supabase.functions
// .invoke(), which sends Authorization + Content-Type and therefore triggers a
// CORS preflight. Without these headers the browser blocks the call and
// supabase-js reports "Failed to send a request to the Edge Function".
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};


const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const inr = (n: number) => `₹${Number(n).toLocaleString("en-IN")}`;

async function buildHealth(supabase: any) {
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const [{ data: orders }, { data: products }, { data: waFails }] = await Promise.all([
    supabase.from("orders").select("status, total_amount, created_at, payment_method"),
    supabase.from("products").select("name, stock_qty, is_active"),
    supabase.from("whatsapp_messages").select("id, message_text").ilike("message_text", "[FAILED]%").limit(50),
  ]);

  const o = orders || [];
  const pending = o.filter((x: any) => x.status === "pending").length;
  const paid = o.filter((x: any) => x.status === "paid").length;         // paid, awaiting confirm
  const confirmed = o.filter((x: any) => x.status === "confirmed").length;
  const shipped = o.filter((x: any) => x.status === "shipped").length;
  const todays = o.filter((x: any) => new Date(x.created_at) >= today);
  const revenueStatuses = new Set(["paid", "confirmed", "shipped", "delivered"]);
  const todaysRevenue = todays.filter((x: any) => revenueStatuses.has(x.status)).reduce((s: number, x: any) => s + Number(x.total_amount), 0);

  const active = (products || []).filter((p: any) => p.is_active);
  const outOfStock = active.filter((p: any) => p.stock_qty === 0);
  const lowStock = active.filter((p: any) => p.stock_qty > 0 && p.stock_qty <= 5);

  return {
    pending, paid, confirmed, shipped,
    todaysOrders: todays.length, todaysRevenue,
    outOfStock: outOfStock.map((p: any) => p.name),
    lowStock: lowStock.map((p: any) => `${p.name} (${p.stock_qty})`),
    failedWhatsApp: (waFails || []).length,
  };
}

function ruleBasedSummary(h: any): string {
  const lines: string[] = [];
  if (h.pending) lines.push(`• ${h.pending} order${h.pending === 1 ? "" : "s"} awaiting payment (online, not completed).`);
  if (h.paid) lines.push(`• ${h.paid} paid order${h.paid === 1 ? "" : "s"} to confirm and prepare.`);
  if (h.confirmed) lines.push(`• ${h.confirmed} confirmed order${h.confirmed === 1 ? "" : "s"} ready to ship.`);
  if (h.outOfStock.length) lines.push(`• Out of stock: ${h.outOfStock.slice(0, 6).join(", ")}${h.outOfStock.length > 6 ? "…" : ""}.`);
  if (h.lowStock.length) lines.push(`• Low stock: ${h.lowStock.slice(0, 6).join(", ")}${h.lowStock.length > 6 ? "…" : ""}.`);
  if (h.failedWhatsApp) lines.push(`• ${h.failedWhatsApp} WhatsApp message${h.failedWhatsApp === 1 ? "" : "s"} failed to send — check the WhatsApp token.`);
  const head = `Today: ${h.todaysOrders} order${h.todaysOrders === 1 ? "" : "s"}, ${inr(h.todaysRevenue)} revenue.`;
  if (lines.length === 0) return `${head}\n\nEverything looks healthy — no pending issues right now.`;
  return `${head}\n\nNeeds your attention:\n${lines.join("\n")}`;
}

async function askClaude(question: string, h: any): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) return null;
  const context = `Store health snapshot (live):
- Today: ${h.todaysOrders} orders, ${inr(h.todaysRevenue)} revenue
- Orders: ${h.pending} pending payment, ${h.paid} paid (to confirm), ${h.confirmed} confirmed, ${h.shipped} shipped
- Out of stock: ${h.outOfStock.join(", ") || "none"}
- Low stock: ${h.lowStock.join(", ") || "none"}
- Failed WhatsApp sends: ${h.failedWhatsApp}`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 600,
      system:
        "You are the Dia Shoppe admin assistant, helping non-technical shop staff run a medical-equipment store's dashboard. " +
        "Use the live store health snapshot to answer. Be concise and practical: explain any problems in plain language and tell staff exactly what to do in the dashboard (e.g. 'go to Orders and mark it Shipped'). " +
        "Only discuss this store's operations. If the snapshot doesn't contain the answer, say what you can see and suggest where to look.",
      messages: [{ role: "user", content: `${context}\n\nStaff question: ${question}` }],
    }),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data?.content?.[0]?.text || null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  try {
    // admin gate
    const authHeader = req.headers.get("Authorization") || "";
    const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { data: me } = await admin.from("user_profiles").select("role").eq("id", user.id).single();
    if (me?.role !== "admin") return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { question } = await req.json().catch(() => ({ question: "" }));
    const health = await buildHealth(admin);

    // "How's the store?" style questions get the summary directly; anything
    // else goes to Claude (falling back to the summary without credits).
    const q = (question || "").trim();
    let answer = q ? await askClaude(q, health) : null;
    let ai = !!answer;
    if (!answer) answer = ruleBasedSummary(health);

    return new Response(JSON.stringify({ answer, ai, health }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("assistant error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
