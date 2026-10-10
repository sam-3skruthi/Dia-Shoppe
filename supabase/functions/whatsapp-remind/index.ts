// Dia Shoppe — abandoned-cart reminder (admin Leads page). Cart reminders are MARKETING under Meta's rules, so this goes through
// the same gate as a campaign: registered+approved marketing template, active marketing consent, queued, rate-limited, retried.
// It no longer sends anything itself and no longer falls back to hello_world; the response says "queued" (or why it was not).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, requireAdmin } from "../_shared/admin.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const a = await requireAdmin(req);
  if (!a.ok) return a.res;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const { user_id } = await req.json();
    if (!user_id) return jsonResponse({ error: "user_id required" }, 400);

    const { data: profile } = await sb.from("user_profiles").select("first_name, phone").eq("id", user_id).single();
    if (!profile?.phone) return jsonResponse({ queued: false, skipped: true, reason: "no phone" });

    const { data: cart } = await sb.from("cart_items").select("quantity").eq("user_id", user_id);
    const itemCount = (cart ?? []).reduce((s: number, r: { quantity: number }) => s + r.quantity, 0);
    if (itemCount === 0) return jsonResponse({ queued: false, skipped: true, reason: "empty cart" });

    const day = new Date().toISOString().slice(0, 10);
    const first = profile.first_name || "there";
    const { data, error } = await sb.rpc("wa_enqueue", {
      p_phone: profile.phone, p_category: "marketing", p_message_type: "cart_reminder", p_template_name: "cart_reminder", p_template_language: "en",
      p_params: [first, String(itemCount)], p_text: `Hi ${first}, you left ${itemCount} item${itemCount === 1 ? "" : "s"} in your Dia Shoppe cart.`,
      p_idem: `cart:${user_id}:${day}`, p_user: user_id,        // at most one reminder per customer per day
    });
    if (error) throw error;
    if (data?.duplicate) return jsonResponse({ queued: false, skipped: true, reason: "already reminded today" });
    if (data?.status === "skipped") return jsonResponse({ queued: false, skipped: true, reason: data.gate === "no_marketing_consent" ? "no consent" : data.gate });
    return jsonResponse({ queued: true });
  } catch (e) {
    console.error("whatsapp-remind error:", (e as Error).message);
    return jsonResponse({ error: "failed" }, 500);
  }
});
