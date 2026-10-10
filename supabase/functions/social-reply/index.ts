// Dia Shoppe — posts a reply to an Instagram/Facebook comment or DM via the
// Meta Graph API, then marks the message replied. Admin-only (JWT-verified).
// Needs META_PAGE_TOKEN (a Page access token from the connected account).
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
const META_PAGE_TOKEN = Deno.env.get("META_PAGE_TOKEN");

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  // DEFERRED FEATURE (P2): disabled until the social inbox is implemented (it also marks a message "replied" even when the Graph post failed)
  if (Deno.env.get("SOCIAL_INBOX_ENABLED") !== "1") return new Response(JSON.stringify({ error: "social inbox is disabled" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  try {
    // admin gate
    const authHeader = req.headers.get("Authorization") || "";
    const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { data: me } = await admin.from("user_profiles").select("role").eq("id", user.id).single();
    if (me?.role !== "admin") return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { message_id, text } = await req.json();
    if (!message_id || !text?.trim()) return new Response(JSON.stringify({ error: "message_id and text required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: msg } = await admin.from("social_messages").select("*").eq("id", message_id).single();
    if (!msg) return new Response(JSON.stringify({ error: "message not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Post to Meta (only if a page token is configured; otherwise record the
    // reply so the flow works and it can be re-sent once connected).
    let posted = false;
    if (META_PAGE_TOKEN && msg.external_id) {
      const endpoint = msg.kind === "comment"
        ? `https://graph.facebook.com/v21.0/${msg.external_id}/replies`
        : `https://graph.facebook.com/v21.0/me/messages`;
      const payload = msg.kind === "comment"
        ? { message: text }
        : { recipient: { id: msg.from_id }, message: { text } };
      const resp = await fetch(`${endpoint}?access_token=${META_PAGE_TOKEN}`, {
        method: "POST",
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      posted = resp.ok;
    }

    await admin.from("social_messages").update({ replied: true, reply_text: text }).eq("id", message_id);
    return new Response(JSON.stringify({ replied: true, posted }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("social-reply error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
