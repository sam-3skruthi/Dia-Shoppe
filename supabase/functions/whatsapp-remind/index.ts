// Dia Shoppe — sends an abandoned-cart reminder on WhatsApp.
// Called from the admin Leads page (supabase.functions.invoke). JWT-verified:
// only a logged-in ADMIN may trigger it, and it only messages customers who
// gave WhatsApp marketing consent. Every attempt is logged to whatsapp_messages.
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
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN")!;
const WHATSAPP_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_ID")!;

function normalizePhone(raw: string): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

async function sendTemplate(to: string, template: string, params: string[]) {
  const body: Record<string, unknown> = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: template,
      language: { code: template === "hello_world" ? "en_US" : "en" },
      ...(params.length
        ? { components: [{ type: "body", parameters: params.map((t) => ({ type: "text", text: t })) }] }
        : {}),
    },
  };
  const resp = await fetch(`https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: resp.ok, json: await resp.json() };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // 1 — the caller must be a logged-in admin
    const authHeader = req.headers.get("Authorization") || "";
    const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { data: me } = await admin.from("user_profiles").select("role").eq("id", user.id).single();
    if (me?.role !== "admin") return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // 2 — target customer + consent check
    const { user_id } = await req.json();
    if (!user_id) return new Response(JSON.stringify({ error: "user_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: profile } = await admin
      .from("user_profiles")
      .select("first_name, phone, whatsapp_marketing_opt_in")
      .eq("id", user_id)
      .single();
    if (!profile?.whatsapp_marketing_opt_in) {
      return new Response(JSON.stringify({ skipped: true, reason: "no consent" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const to = normalizePhone(profile.phone || "");
    if (!to) return new Response(JSON.stringify({ skipped: true, reason: "no phone" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // 3 — cart snapshot
    const { data: cart } = await admin
      .from("cart_items")
      .select("quantity, products(name)")
      .eq("user_id", user_id);
    const itemCount = (cart || []).reduce((s: number, r: any) => s + r.quantity, 0);
    if (itemCount === 0) return new Response(JSON.stringify({ skipped: true, reason: "empty cart" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // owner-editable reminder wording (Admin → Settings), with a safe default
    const { data: msgSettings } = await admin.from("site_settings").select("value").eq("key", "message_settings").maybeSingle();
    const reminderLine = msgSettings?.value?.cart_reminder
      || "Complete your order before it sells out — we're here if you need any help!";

    const firstName = profile.first_name || "there";
    const messageText = `Hi ${firstName}, you left ${itemCount} item${itemCount === 1 ? "" : "s"} in your Dia Shoppe cart. ${reminderLine}`;

    // cart_reminder is our (pending) marketing template; fall back to
    // hello_world until Meta approves it, same pattern as order updates
    let result = await sendTemplate(to, "cart_reminder", [firstName, String(itemCount)]);
    let templateUsed = "cart_reminder";
    if (!result.ok) {
      const fb = await sendTemplate(to, "hello_world", []);
      if (fb.ok) { result = fb; templateUsed = "hello_world"; }
    }

    await admin.from("whatsapp_messages").insert({
      user_id,
      message_type: "cart_reminder",
      phone_number: to,
      message_text: result.ok
        ? (templateUsed === "hello_world" ? `[hello_world fallback] ${messageText}` : messageText)
        : `[FAILED] ${messageText} — ${JSON.stringify(result.json?.error?.message || result.json)}`,
      direction: "outbound",
    });

    return new Response(JSON.stringify({ sent: result.ok, template: templateUsed }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("whatsapp-remind error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
