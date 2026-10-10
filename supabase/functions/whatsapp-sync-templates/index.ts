// Dia Shoppe — pulls template status/category/variable counts from Meta into the registry (whatsapp_templates).
// Called daily by pg_cron (x-hook-secret) or by an admin. The registry stays authoritative: Meta can change a template's
// STATUS, but a variable-count mismatch DISABLES the template (and alerts) instead of sending with the wrong variables.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, requireAdmin } from "../_shared/admin.ts";
import { constantTimeEqual } from "../_shared/meta-signature.ts";

const SECRET = Deno.env.get("WHATSAPP_WORKER_SECRET");
const STATUS: Record<string, string> = { APPROVED: "approved", PENDING: "pending", IN_APPEAL: "pending", REJECTED: "rejected", PAUSED: "paused", DISABLED: "disabled", FLAGGED: "paused" };
const CATEGORY: Record<string, string> = { UTILITY: "utility", MARKETING: "marketing", AUTHENTICATION: "authentication" };

// deno-lint-ignore no-explicit-any
function shape(t: any) {
  // deno-lint-ignore no-explicit-any
  const body = (t.components ?? []).find((c: any) => c.type === "BODY");
  // deno-lint-ignore no-explicit-any
  const header = (t.components ?? []).find((c: any) => c.type === "HEADER");
  const nums = [...String(body?.text ?? "").matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
  return { body_params: nums.length ? Math.max(...nums) : 0, header_type: header ? String(header.format ?? "TEXT").toLowerCase() : "none" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const hook = req.headers.get("x-hook-secret");
  if (!(hook && SECRET && constantTimeEqual(hook, SECRET))) {
    const a = await requireAdmin(req);
    if (!a.ok) return a.res;
  }
  const waba = Deno.env.get("WHATSAPP_WABA_ID"); const token = Deno.env.get("WHATSAPP_TOKEN");
  if (!waba || !token) return jsonResponse({ error: "WHATSAPP_WABA_ID / WHATSAPP_TOKEN not configured" }, 500);
  const base = (Deno.env.get("WHATSAPP_API_BASE") || "https://graph.facebook.com/v21.0").replace(/\/+$/, "");
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    // deno-lint-ignore no-explicit-any
    const remote: any[] = [];
    let next: string | null = `${base}/${waba}/message_templates?limit=100&fields=name,language,category,status,components`;
    for (let page = 0; next && page < 10; page++) {
      const r = await fetch(next, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return jsonResponse({ error: `Graph API HTTP ${r.status}` }, 502);
      const j = await r.json();
      remote.push(...(j.data ?? []));
      next = j.paging?.next ?? null;
    }
    const { data: local } = await sb.from("whatsapp_templates").select("*");
    const key = (n: string, l: string) => `${n}/${l}`;
    const have = new Map((local ?? []).map((t: { name: string; language: string }) => [key(t.name, t.language), t]));
    const seen = new Set<string>();
    const out = { updated: 0, added_disabled: 0, mismatched: 0, missing_at_meta: 0 };

    for (const t of remote) {
      const k = key(t.name, t.language); seen.add(k);
      const s = shape(t);
      const status = STATUS[String(t.status).toUpperCase()] ?? "pending";
      const category = CATEGORY[String(t.category).toUpperCase()];
      if (!category) continue;                                  // unknown category: ignore
      // deno-lint-ignore no-explicit-any
      const mine = have.get(k) as any;
      if (!mine) {                                              // unknown to us: recorded but DISABLED until someone defines its variables
        await sb.from("whatsapp_templates").insert({
          name: t.name, language: t.language, category, status, body_params: s.body_params, header_type: ["none", "text", "image", "video", "document"].includes(s.header_type) ? s.header_type : "none",
          param_schema: Array.from({ length: s.body_params }, (_, i) => ({ name: `p${i + 1}`, kind: "static", max: 200 })), enabled: false, last_synced_at: new Date().toISOString(),
        });
        out.added_disabled++; continue;
      }
      const patch: Record<string, unknown> = { status, category, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      if (mine.body_params !== s.body_params) {
        patch.enabled = false; out.mismatched++;
        await sb.rpc("wa_ops_event", { p_severity: "warning", p_code: "whatsapp_template_mismatch",
          p_message: `template ${t.name}/${t.language}: Meta has ${s.body_params} variables, registry has ${mine.body_params}; disabled`,
          p_entity: "whatsapp_template", p_entity_id: [...`${t.name}/${t.language}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 2147483647, 7) });
      }
      await sb.from("whatsapp_templates").update(patch).eq("name", t.name).eq("language", t.language);
      out.updated++;
    }
    for (const [k, t] of have) {                                // in our registry but gone at Meta
      if (!seen.has(k)) {
        // deno-lint-ignore no-explicit-any
        await sb.from("whatsapp_templates").update({ status: "disabled", last_synced_at: new Date().toISOString() }).eq("name", (t as any).name).eq("language", (t as any).language);
        out.missing_at_meta++;
      }
    }
    return jsonResponse({ ok: true, remote: remote.length, ...out });
  } catch (e) {
    console.error("whatsapp-sync-templates error:", (e as Error).message);
    return jsonResponse({ error: "sync failed" }, 500);
  }
});
