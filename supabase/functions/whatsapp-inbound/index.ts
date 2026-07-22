// Dia Shoppe — WhatsApp inbound webhook + AI auto-reply (Phase B).
// Meta calls this when a customer messages the shop number. Flow:
//   1. GET  = Meta's one-time webhook verification handshake (hub.challenge)
//   2. POST = incoming messages: log → build store context from the live DB
//      (catalog + this customer's orders, matched by phone) → Claude drafts a
//      reply → send it back through the Cloud API → log the outbound.
// Replies ride the free 24h customer-service window (customer messaged first),
// so no template approval is needed for these.
// Without ANTHROPIC_API_KEY set, falls back to a polite human-handoff message
// so the pipeline still works before/without AI.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN")!;
const WHATSAPP_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_ID")!;
const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const HANDOFF_MESSAGE =
  "Thank you for reaching out to Dia Shoppe! 🙏 A team member will get back to you shortly. For order updates, you can also track your order live on our website under My Orders.";

async function sendText(to: string, body: string) {
  const resp = await fetch(`https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  const json = await resp.json();
  return { ok: resp.ok, json };
}

// deno-lint-ignore no-explicit-any
async function buildStoreContext(supabase: any, phone: string) {
  const last10 = phone.slice(-10);
  const [productsRes, ordersRes] = await Promise.all([
    supabase
      .from("products")
      .select("name, brand, price, stock_qty, description, categories(name)")
      .eq("is_active", true),
    supabase
      .from("orders")
      .select("id, status, total_amount, created_at, courier, tracking_number, order_items(quantity, products(name))")
      .like("shipping_phone", `%${last10}`)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  // deno-lint-ignore no-explicit-any
  const catalog = (productsRes.data || []).map((p: any) =>
    `${p.name} (${p.brand}, ${p.categories?.name || "General"}) — ₹${p.price}, ${p.stock_qty > 0 ? `${p.stock_qty} in stock` : "OUT OF STOCK"}`
  ).join("\n");

  // deno-lint-ignore no-explicit-any
  const orders = (ordersRes.data || []).map((o: any) => {
    // deno-lint-ignore no-explicit-any
    const items = (o.order_items || []).map((i: any) => `${i.products?.name} x${i.quantity}`).join(", ");
    const tracking = o.tracking_number ? ` | courier ${o.courier}, tracking ${o.tracking_number}` : "";
    return `Order #${o.id}: ${o.status}, ₹${o.total_amount}, placed ${o.created_at.slice(0, 10)} [${items}]${tracking}`;
  }).join("\n");

  return { catalog, orders: orders || "No orders found for this phone number." };
}

async function draftReply(customerText: string, catalog: string, orders: string, ownerInstructions: string): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) return null;

  const system = `You are the WhatsApp assistant for Dia Shoppe, a trusted Indian medical equipment store (glucose monitors, BP monitors, respiratory & hospital equipment) serving customers since 2004.

Rules:
- Answer ONLY questions about Dia Shoppe: products, prices, stock, this customer's orders, delivery, and how to order on the website. Use ONLY the store data below — never invent products, prices, stock levels, or order details.
- Keep replies short and warm (2-4 sentences), suitable for WhatsApp. Reply in the customer's language (English, Hindi, Telugu, etc. — match them).
- If the customer asks their order status, use their order history below.
- Never give medical advice (dosage, diagnosis, which device treats what condition) — suggest they consult their doctor, then help with product specs only.
- If you cannot answer confidently from the data, or the customer wants a return/refund/complaint/payment issue, reply that a Dia Shoppe team member will follow up shortly. Do not guess.
${ownerInstructions ? `\nAdditional instructions from the store owner (follow these):\n${ownerInstructions}\n` : ""}
STORE CATALOG:
${catalog}

THIS CUSTOMER'S RECENT ORDERS (matched by their WhatsApp number):
${orders}`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      // Haiku: fast + ~₹0.2/reply — right fit for catalog/order Q&A from provided
      // data (owner's cost decision; swap to claude-opus-4-8 for max smarts)
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: customerText }],
    }),
  });

  if (!resp.ok) {
    console.error("Anthropic API error:", resp.status, await resp.text());
    return null;
  }
  const data = await resp.json();
  // deno-lint-ignore no-explicit-any
  const text = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  return text || null;
}

serve(async (req) => {
  const url = new URL(req.url);

  // Meta's webhook verification handshake
  if (req.method === "GET") {
    if (
      url.searchParams.get("hub.mode") === "subscribe" &&
      url.searchParams.get("hub.verify_token") === VERIFY_TOKEN
    ) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const payload = await req.json();

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const messages = change.value?.messages ?? [];
        for (const msg of messages) {
          if (msg.type !== "text") continue; // Phase B handles text only
          const from = msg.from as string;
          const text = msg.text?.body as string;
          if (!from || !text) continue;

          // Log the inbound message
          await supabase.from("whatsapp_messages").insert({
            message_type: "customer_inbound",
            phone_number: from,
            message_text: text,
            direction: "inbound",
          });

          // Draft: AI when configured, polite handoff otherwise
          const context = await buildStoreContext(supabase, from);
          // owner-editable AI instructions (Admin → Settings)
          const { data: msgSettings } = await supabase.from("site_settings").select("value").eq("key", "message_settings").maybeSingle();
          const ownerInstructions = msgSettings?.value?.ai_instructions || "";
          let reply: string | null = null;
          try {
            reply = await draftReply(text, context.catalog, context.orders, ownerInstructions);
          } catch (aiError) {
            console.error("AI draft failed:", aiError);
          }
          const outbound = reply ?? HANDOFF_MESSAGE;
          const isAi = reply !== null;

          const result = await sendText(from, outbound);

          await supabase.from("whatsapp_messages").insert({
            message_type: isAi ? "ai_reply" : "handoff_reply",
            phone_number: from,
            message_text: result.ok
              ? outbound
              : `[FAILED] ${outbound} — ${JSON.stringify(result.json?.error?.message || result.json)}`,
            direction: "outbound",
          });
        }
      }
    }

    // Always 200 so Meta doesn't retry-storm us
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (error) {
    console.error("whatsapp-inbound error:", error);
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }
});
