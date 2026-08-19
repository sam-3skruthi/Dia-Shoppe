// Dia Shoppe — sends a marketing broadcast on WhatsApp to opted-in customers.
// Admin-only (JWT-verified). Consent is enforced server-side: only profiles
// with whatsapp_marketing_opt_in = true and a phone number are messaged.
// Each send is logged to whatsapp_messages with message_type 'broadcast'.
//
// NOTE: real delivery needs a Meta-APPROVED marketing template. Until then the
// send falls back to hello_world so the pipeline is verifiable; the {{name}}
// personalisation and audience logic are already live.
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

// safety cap per invocation so a mistake can't blast unbounded messages
const MAX_PER_RUN = 1000;

function normalizePhone(raw: string): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

async function sendTemplate(to: string, template: string, params: string[], imageUrl?: string | null) {
  // Build components: an optional image header + the text body.
  // NOTE: for the image to actually attach, the approved marketing template
  // must be created in Meta with an IMAGE header. Without that it's ignored.
  const components: Record<string, unknown>[] = [];
  if (imageUrl) {
    components.push({ type: "header", parameters: [{ type: "image", image: { link: imageUrl } }] });
  }
  if (params.length) {
    components.push({ type: "body", parameters: params.map((t) => ({ type: "text", text: t })) });
  }
  const body: Record<string, unknown> = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: template,
      language: { code: template === "hello_world" ? "en_US" : "en" },
      ...(components.length ? { components } : {}),
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
    // admin gate
    const authHeader = req.headers.get("Authorization") || "";
    const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { data: me } = await admin.from("user_profiles").select("role").eq("id", user.id).single();
    if (me?.role !== "admin") return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { message, imageUrl } = await req.json();
    if (!message || !message.trim()) return new Response(JSON.stringify({ error: "message required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // opted-in audience only
    const { data: audience } = await admin
      .from("user_profiles")
      .select("id, first_name, phone")
      .eq("whatsapp_marketing_opt_in", true)
      .not("phone", "is", null)
      .limit(MAX_PER_RUN);

    let sent = 0, failed = 0;
    const logs: any[] = [];
    for (const p of audience || []) {
      const to = normalizePhone(p.phone || "");
      if (!to) { failed++; continue; }
      const firstName = p.first_name || "there";
      const personalised = message.replace(/\{\{\s*name\s*\}\}/gi, firstName);

      // custom "promo" template preferred (carries the image header when given);
      // hello_world fallback (text only) until promo is approved
      let result = await sendTemplate(to, "promo", [firstName, personalised], imageUrl);
      let templateUsed = "promo";
      if (!result.ok) {
        const fb = await sendTemplate(to, "hello_world", []);
        if (fb.ok) { result = fb; templateUsed = "hello_world"; }
      }
      if (result.ok) sent++; else failed++;

      logs.push({
        user_id: p.id,
        message_type: "broadcast",
        phone_number: to,
        message_text: result.ok
          ? (templateUsed === "hello_world" ? `[hello_world fallback] ${personalised}` : personalised)
          : `[FAILED] ${personalised} — ${JSON.stringify(result.json?.error?.message || result.json)}`,
        direction: "outbound",
      });
    }

    if (logs.length) await admin.from("whatsapp_messages").insert(logs);

    return new Response(JSON.stringify({ audience: (audience || []).length, sent, failed }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("whatsapp-broadcast error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
