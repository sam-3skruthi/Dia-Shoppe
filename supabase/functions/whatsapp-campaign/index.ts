// Dia Shoppe — marketing campaign helper (admin only). The campaign lifecycle itself is database RPCs the admin UI calls with
// its own JWT (each checks is_admin()):  wa_create_campaign -> [this function: AI copy SUGGESTIONS] -> wa_set_campaign_variables
// -> wa_approve_campaign (a logged-in human; resolves the audience, queues one row per consenting recipient) / wa_cancel_campaign.
//
// What the AI can do here: propose wording for ONE template variable, from the owner's brief. It never sees customer data, never
// chooses recipients (the audience is a whitelisted filter resolved by SQL and always joined with marketing consent), never
// approves and never sends. Its output is stored as a suggestion; only an admin's wa_set_campaign_variables makes it content.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, requireAdmin } from "../_shared/admin.ts";
import { generateCampaignCopy, SupportReplyError } from "../_shared/ai/index.ts";

const LANG: Record<string, string> = { en: "English", en_US: "English", hi: "Hindi", kn: "Kannada", te: "Telugu" };
const env = (k: string) => Deno.env.get(k);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const a = await requireAdmin(req);
  if (!a.ok) return a.res;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const body = await req.json();
    if (body.action !== "generate_copy") return jsonResponse({ error: "unknown action" }, 400);
    const brief = String(body.brief ?? "").trim();
    if (!brief || brief.length > 600) return jsonResponse({ error: "brief is required (max 600 characters)" }, 400);

    const { data: c } = await sb.from("whatsapp_campaigns").select("id, status, template_name, template_language").eq("id", body.campaign_id).maybeSingle();
    if (!c || !["draft", "copy_ready"].includes(c.status)) return jsonResponse({ error: "campaign not found or not editable" }, 404);
    const { data: t } = await sb.from("whatsapp_templates").select("param_schema").eq("name", c.template_name).eq("language", c.template_language).single();
    const spec = (t?.param_schema ?? []).find((p: { kind: string; name: string }) => p.kind === "static" && (!body.variable || p.name === body.variable));
    if (!spec) return jsonResponse({ error: "this template has no free-text variable to write" }, 400);

    const gate = (await sb.rpc("ai_gate")).data ?? {};
    const capMicro = Math.round(Number(env("AI_DAILY_CAP_USD") ?? "5") * 1_000_000);
    if (gate.circuit_open || Number(gate.spent_micro_usd ?? 0) >= capMicro) return jsonResponse({ error: "AI is unavailable right now (circuit open or daily cap reached); write the copy by hand" }, 503);

    try {
      const { suggestions, usage } = await generateCampaignCopy({ brief, maxLen: spec.max, language: LANG[c.template_language] ?? "English" }, { env });
      const cost = Math.round(usage.inputTokens * Number(env("AI_PRICE_IN_PER_MTOK") ?? "0") + usage.outputTokens * Number(env("AI_PRICE_OUT_PER_MTOK") ?? "0"));
      await sb.rpc("ai_record", { p_ok: true, p_in: usage.inputTokens, p_out: usage.outputTokens, p_cost_micro: cost });
      await sb.from("whatsapp_campaigns").update({ ai_copy: { variable: spec.name, suggestions, provider: usage.provider, model: usage.model, at: new Date().toISOString() } }).eq("id", c.id);
      return jsonResponse({ ok: true, variable: spec.name, suggestions });
    } catch (e) {
      const kind = e instanceof SupportReplyError ? e.kind : "provider_error";
      if (kind !== "disabled") await sb.rpc("ai_record", { p_ok: kind === "validation", p_in: 0, p_out: 0, p_cost_micro: 0, p_error: `${kind}: ${(e as Error).message}`.slice(0, 200) });
      return jsonResponse({ error: `AI copy unavailable (${kind}); write the copy by hand` }, 503);
    }
  } catch (e) {
    console.error("whatsapp-campaign error:", (e as Error).message);
    return jsonResponse({ error: "failed" }, 500);
  }
});
