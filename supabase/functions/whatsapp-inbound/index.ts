// Dia Shoppe — WhatsApp webhook (Meta Cloud API). This function ONLY authenticates, deduplicates, stores and acknowledges.
//   GET  : Meta's one-time verification handshake (hub.challenge)
//   POST : 1. read the RAW bytes, verify X-Hub-Signature-256 (HMAC-SHA256 with the Meta app secret) -> 401 otherwise, nothing stored
//          2. each message: INSERT ... ON CONFLICT (wamid) DO NOTHING      (atomic dedup; a repeat changes nothing)
//          3. each status : monotonic update by wamid (sent -> delivered -> read | failed), unknown wamid parked for reconciliation
//          4. answer 200 immediately; everything slow (identity, context, AI, sending) runs in the queue worker afterwards.
// There is NO AI and NO provider-specific code in this file: AI replies are produced by whatsapp-worker through _shared/ai.
// DEV only: WHATSAPP_CAPTURE_PAYLOADS=1 stores each VERIFIED real payload (raw body + signature header) in whatsapp_payload_captures
// (a table that exists only where the DEV setup script created it) so a real round trip can be replayed/validated offline.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyMetaSignature } from "../_shared/meta-signature.ts";
import { parseWhatsAppWebhook } from "../_shared/meta-payload.ts";
import { processBatch } from "../_shared/whatsapp-pipeline.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN");
const APP_SECRET = Deno.env.get("META_APP_SECRET_WHATSAPP");
const CAPTURE = Deno.env.get("WHATSAPP_CAPTURE_PAYLOADS") === "1" && Deno.env.get("ENVIRONMENT") === "dev";
const env = (k: string) => Deno.env.get(k);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const ok = VERIFY_TOKEN && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === VERIFY_TOKEN;
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 }) : new Response("Forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // exact raw bytes: never re-serialise before verifying
  const raw = new Uint8Array(await req.arrayBuffer());
  const sigHeader = req.headers.get("x-hub-signature-256");
  const sig = await verifyMetaSignature(raw, sigHeader, APP_SECRET);
  if (!sig.ok) {
    console.warn("whatsapp-inbound: signature rejected:", sig.reason);   // metric only: the forged body is not stored or logged
    return json({ error: "invalid signature" }, sig.reason === "no_secret" ? 500 : 401);
  }

  // deno-lint-ignore no-explicit-any
  let payload: any;
  const bodyStr = new TextDecoder().decode(raw);
  try { payload = JSON.parse(bodyStr); } catch { return json({ received: true, ignored: "not json" }); }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  if (CAPTURE) { try { await sb.from("whatsapp_payload_captures").insert({ signature: sigHeader, body: bodyStr }); } catch { /* DEV aid only */ } }

  const parsed = parseWhatsAppWebhook(payload);
  for (const e of parsed.errors) console.warn("whatsapp-inbound: webhook-level error from Meta:", e.code, e.title);
  let stored = 0, duplicates = 0, statuses = 0;
  try {
    for (const m of parsed.messages) {
      const { data, error } = await sb.rpc("wa_record_inbound", { p_wamid: m.id, p_phone: m.from, p_text: m.text, p_type: m.type, p_media: m.media });
      if (error) throw error;
      if (data?.duplicate) duplicates++; else stored++;
    }
    for (const st of parsed.statuses) {
      const { data, error } = await sb.rpc("wa_apply_status", {
        p_wamid: st.id, p_status: st.status, p_ts: st.ts, p_client_ref: st.clientRef, p_error_code: st.errorCode, p_error_message: st.errorMessage,
      });
      if (error) throw error;
      // not linked yet but Meta echoed OUR reference: link it now (covers "send succeeded, response lost")
      if (data === "parked" && st.clientRef) {
        const linked = await sb.rpc("wa_link_by_client_ref", { p_client_ref: st.clientRef, p_wamid: st.id });
        if (linked.data) await sb.rpc("wa_apply_pending_events", { p_wamid: st.id });
      }
      statuses++;
    }
  } catch (e) {
    // storing failed: tell Meta to retry (it will redeliver the same wamids, which dedup makes safe)
    console.error("whatsapp-inbound store error:", (e as Error).message);
    return json({ error: "temporary failure" }, 500);
  }

  // acknowledge first, work afterwards (the cron worker is the safety net if this background kick is lost)
  if (stored > 0) {
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    const work = processBatch(sb, env).catch((e) => console.error("background processing failed:", (e as Error).message));
    if (rt?.waitUntil) rt.waitUntil(work);
  }
  return json({ received: true, stored, duplicates, statuses });
});
