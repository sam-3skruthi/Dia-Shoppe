// Dia Shoppe — sends a WhatsApp order-status update via Meta's Cloud API.
// Called by a Postgres trigger (pg_net) whenever an order's status changes,
// so it fires no matter who changed the status (admin UI, verify-payment,
// webhook). Authenticated with a shared secret header, not a user JWT.
// Every attempt is logged to whatsapp_messages for the admin WhatsApp page.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN")!;
const WHATSAPP_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_ID")!;
const HOOK_SECRET = Deno.env.get("WHATSAPP_HOOK_SECRET")!;

// Statuses customers should hear about (pending/paid are covered by email)
const NOTIFY_STATUSES = new Set(["confirmed", "shipped", "delivered", "cancelled"]);

// Defaults — overridden by the owner's wording in site_settings (Admin → Settings)
const DEFAULT_STATUS_LINE: Record<string, string> = {
  confirmed: "We are preparing it for dispatch.",
  shipped: "It is on the way!",
  delivered: "We hope everything arrived in perfect condition.",
  cancelled: "If you were charged, the amount will be refunded.",
};

// Owner-editable message wording (falls back to defaults if unset)
async function getStatusLines(supabase: any): Promise<Record<string, string>> {
  const { data } = await supabase.from("site_settings").select("value").eq("key", "message_settings").maybeSingle();
  const s = data?.value || {};
  return {
    confirmed: s.status_confirmed || DEFAULT_STATUS_LINE.confirmed,
    shipped: s.status_shipped || DEFAULT_STATUS_LINE.shipped,
    delivered: s.status_delivered || DEFAULT_STATUS_LINE.delivered,
    cancelled: s.status_cancelled || DEFAULT_STATUS_LINE.cancelled,
  };
}

// Indian 10-digit numbers → E.164 without the plus (Cloud API format)
function normalizePhone(raw: string): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

async function sendTemplate(to: string, template: string, params: string[], lang?: string) {
  const body: Record<string, unknown> = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: template,
      language: { code: lang ?? (template === "hello_world" ? "en_US" : "en") },
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
  const json = await resp.json();
  return { ok: resp.ok, json };
}

serve(async (req) => {
  if (req.headers.get("x-hook-secret") !== HOOK_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { order_id, new_status } = await req.json();
    if (!order_id || !NOTIFY_STATUSES.has(new_status)) {
      return new Response(JSON.stringify({ skipped: true }), { status: 200 });
    }

    const { data: order } = await supabase
      .from("orders")
      .select("id, user_id, shipping_name, shipping_phone, courier, tracking_number, whatsapp_opt_in")
      .eq("id", order_id)
      .single();
    if (!order) return new Response(JSON.stringify({ error: "Order not found" }), { status: 404 });

    // Respect the customer's choice — no WhatsApp update if they opted out.
    if (order.whatsapp_opt_in === false) {
      return new Response(JSON.stringify({ skipped: true, reason: "opted out" }), { status: 200 });
    }

    const to = normalizePhone(order.shipping_phone);
    if (!to) {
      return new Response(JSON.stringify({ skipped: true, reason: "invalid phone" }), { status: 200 });
    }

    const STATUS_LINE = await getStatusLines(supabase);
    const firstName = order.shipping_name?.split(" ")[0] || "there";
    let extra = STATUS_LINE[new_status] || "";
    if (new_status === "shipped" && (order.courier || order.tracking_number)) {
      extra = `Courier: ${order.courier || "-"}, tracking no ${order.tracking_number || "-"}.`;
    }
    const messageText = `Hi ${firstName}, your Dia Shoppe order #${order.id} is now ${new_status}. ${extra} Thank you for shopping with us!`;

    // order_update is our approved utility template; until Meta finishes
    // reviewing it, fall back to the sandbox hello_world template so the
    // pipeline can still be demoed end to end
    // Meta stores a template per language, and "English" vs "English (US)" are
    // different codes. Try both before giving up, so an approved template is
    // never skipped just because it was created under the other one.
    const params = [firstName, String(order.id), new_status, extra];
    let result = await sendTemplate(to, "order_update", params, "en");
    if (!result.ok) result = await sendTemplate(to, "order_update", params, "en_US");
    let templateUsed = "order_update";
    // Keep Meta's reason for the real template failing — otherwise a successful
    // fallback hides it and the log gives no clue why customers get hello_world.
    let realTemplateError = "";
    if (!result.ok) {
      realTemplateError = String(
        result.json?.error?.error_user_msg || result.json?.error?.message || "unknown error",
      );
      const fallback = await sendTemplate(to, "hello_world", []);
      if (fallback.ok) {
        result = fallback;
        templateUsed = "hello_world";
      }
    }

    await supabase.from("whatsapp_messages").insert({
      user_id: order.user_id,
      order_id: order.id,
      message_type: `order_${new_status}`,
      phone_number: to,
      message_text: result.ok
        ? (templateUsed === "hello_world"
            ? `[hello_world fallback] ${messageText} — order_update failed: ${realTemplateError}`
            : messageText)
        : `[FAILED] ${messageText} — ${JSON.stringify(result.json?.error?.message || result.json)}`,
      direction: "outbound",
    });

    return new Response(JSON.stringify({ sent: result.ok, template: templateUsed, response: result.json }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("whatsapp-notify error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});
