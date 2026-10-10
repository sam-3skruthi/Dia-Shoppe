// Dia Shoppe — Instagram/Facebook webhook (comments & DMs) -> social_messages.
// DEFERRED FEATURE (P2). Until the social inbox is actually implemented this endpoint is DISABLED: it answers 503 to everything unless
// SOCIAL_INBOX_ENABLED=1 AND the Meta app secret is set. When enabled it is safe to expose: every POST must carry a valid
// X-Hub-Signature-256 over the exact raw bytes (META_APP_SECRET_SOCIAL), checked before anything is parsed or stored.
// Deploy with --no-verify-jwt (Meta calls it directly with no Supabase JWT).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyMetaSignature } from "../_shared/meta-signature.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERIFY_TOKEN = Deno.env.get("SOCIAL_VERIFY_TOKEN");
const APP_SECRET = Deno.env.get("META_APP_SECRET_SOCIAL");
const ENABLED = Deno.env.get("SOCIAL_INBOX_ENABLED") === "1";

const text = (body: string, status: number) => new Response(body, { status });

serve(async (req) => {
  if (!ENABLED || !APP_SECRET) return text("social inbox is disabled", 503);       // deferred feature: nothing is exposed
  const url = new URL(req.url);

  if (req.method === "GET") {
    const ok = VERIFY_TOKEN && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === VERIFY_TOKEN;
    return ok ? text(url.searchParams.get("hub.challenge") ?? "", 200) : text("Forbidden", 403);
  }
  if (req.method !== "POST") return text("Method not allowed", 405);

  const raw = new Uint8Array(await req.arrayBuffer());
  const sig = await verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), APP_SECRET);
  if (!sig.ok) { console.warn("social-webhook: signature rejected:", sig.reason); return text(JSON.stringify({ error: "invalid signature" }), 401); }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  try {
    const body = JSON.parse(new TextDecoder().decode(raw));
    // deno-lint-ignore no-explicit-any
    const rows: any[] = [];
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const v = change.value || {};
        if (change.field === "comments" || v.item === "comment") {
          rows.push({
            platform: body.object?.includes("instagram") ? "instagram" : "facebook", kind: "comment", external_id: v.id || v.comment_id,
            from_name: v.from?.name || v.from?.username || null, from_id: v.from?.id || null, text: v.text || v.message || "", permalink: v.permalink || null,
          });
        }
      }
      for (const m of entry.messaging || []) {
        if (m.message?.text) {
          rows.push({ platform: entry.messaging_product === "instagram" ? "instagram" : "facebook", kind: "dm", external_id: m.message.mid, from_id: m.sender?.id || null, text: m.message.text });
        }
      }
    }
    if (rows.length) await supabase.from("social_messages").upsert(rows, { onConflict: "external_id", ignoreDuplicates: true });   // idempotent on Meta's id
    return text(JSON.stringify({ received: rows.length }), 200);
  } catch (error) {
    console.error("social-webhook error:", (error as Error).message);
    return text(JSON.stringify({ error: "temporary failure" }), 500);          // a signed request we could not store: let Meta retry
  }
});
