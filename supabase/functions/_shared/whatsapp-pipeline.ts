// The queue worker core: claims due rows (outbound sends AND inbound jobs) and processes them.
// Used by the whatsapp-worker function (pg_cron, every minute) and kicked by whatsapp-inbound after it has answered Meta.
// Nothing here runs inside the webhook's request path.
import { answerCustomer } from "./ai/safe.ts";
import { CANNED, detectLocale } from "./ai/locale.ts";
import { buildSupportContext } from "./support-context.ts";
import {
  LOCAL, normalizePhone, sendTemplateMessage, sendTextMessage, senderConfigFromEnv, validateTemplateSend,
} from "./whatsapp.ts";
import type { Category, RegistryTemplate, SenderConfig } from "./whatsapp.ts";

// deno-lint-ignore no-explicit-any
type Sb = any;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
type Env = (k: string) => string | undefined;

const DEFAULT_STOP = ["stop", "unsubscribe", "stop all", "cancel subscription", "opt out", "optout", "band karo", "रुकें", "रोकें", "बंद करो", "ನಿಲ್ಲಿಸಿ", "ఆపండి"];
const DEFAULT_START = ["start", "subscribe", "unstop", "शुरू करें"];
const MEDIA_TYPES = new Set(["image", "audio", "voice", "video", "document", "sticker", "location", "contacts"]);
const TEXT_TYPES = new Set(["text", "button", "interactive"]);

const norm = (s: string) => s.toLowerCase().replace(/[.!?,;:'"()\-_*~]+/g, " ").replace(/\s+/g, " ").trim();

export async function sendOne(sb: Sb, env: Env, row: Row, cfg: SenderConfig | null): Promise<string> {
  const fail = async (code: number, msg: string, retryable: boolean) =>
    (await sb.rpc("wa_mark_failure", { p_id: row.id, p_code: code, p_message: msg, p_retryable: retryable })).data as string;

  if (!cfg) return fail(LOCAL.no_config, "WHATSAPP_TOKEN / WHATSAPP_PHONE_ID are not configured", true);
  const to = row.phone_e164 ?? normalizePhone(row.phone_number);
  if (!to) return fail(LOCAL.param_invalid, "invalid phone number", false);

  // consent / window are checked AGAIN at send time: the customer may have said STOP since this was queued
  const gate = (await sb.rpc("wa_can_send", { p_phone: to, p_category: row.category, p_order_id: row.order_id })).data as string;
  if (gate !== "ok") { await sb.rpc("wa_mark_skipped", { p_id: row.id, p_reason: gate }); return `skipped:${gate}`; }

  let res;
  if (row.template_name) {
    const { data: tpl } = await sb.from("whatsapp_templates").select("*").eq("name", row.template_name).eq("language", row.template_language).maybeSingle();
    const params = Array.isArray(row.template_params) ? row.template_params : [];
    const image = row.media_meta?.header_image_url ?? null;
    const v = validateTemplateSend(tpl as RegistryTemplate | null, row.category as Category, params, image);
    if (!v.ok) return fail(v.code, v.message, false);
    res = await sendTemplateMessage(cfg, { to, name: row.template_name, language: row.template_language, params: v.params, headerImageUrl: image, clientRef: row.client_ref });
  } else {
    if (!row.message_text) return fail(LOCAL.param_invalid, "free-text message has no body", false);
    res = await sendTextMessage(cfg, { to, body: String(row.message_text).slice(0, 1500), clientRef: row.client_ref });
  }

  if (res.ok) { await sb.rpc("wa_mark_accepted", { p_id: row.id, p_wamid: res.wamid }); return "accepted"; }
  if (res.pauseQueue && res.code !== 190) await sb.rpc("wa_pause_queue", { p_reason: `Meta error ${res.code}: ${res.message}`.slice(0, 200) });
  return fail(res.code, res.message, res.retryable && !(res.pauseQueue && res.code !== 190));
}

export async function processInbound(sb: Sb, env: Env, row: Row): Promise<string> {
  const phone = row.phone_e164 as string | null;
  if (!phone) { await sb.rpc("wa_mark_processed", { p_id: row.id, p_status: "skipped", p_error: "no valid phone" }); return "skipped"; }
  const type = String(row.content_type ?? "text");
  const text = String(row.message_text ?? "");
  const locale = detectLocale(text);
  const reply = async (body: string, kind: string, suffix: string) =>
    sb.rpc("wa_enqueue", { p_phone: phone, p_category: "service", p_message_type: kind, p_template_name: null, p_template_language: null,
      p_params: null, p_text: body, p_idem: `${suffix}:${row.wamid}`, p_user: row.user_id ?? null });

  // 1. consent keywords come before any AI. Exact-message match only ("don't stop my delivery" is not an opt-out).
  if (TEXT_TYPES.has(type)) {
    const { data: s } = await sb.from("site_settings").select("value").eq("key", "whatsapp_stop_keywords").maybeSingle();
    const stop = (Array.isArray(s?.value) ? s.value : DEFAULT_STOP).map((k: string) => norm(k));
    const start = DEFAULT_START.map(norm);
    const t = norm(text);
    if (stop.includes(t)) {
      await sb.rpc("wa_set_consent", { p_phone: phone, p_scope: "marketing", p_status: "revoked", p_source: "whatsapp_stop", p_evidence: { wamid: row.wamid } });
      await reply(CANNED[locale].stop, "optout_confirmation", "stop-confirm");
      await sb.rpc("wa_mark_processed", { p_id: row.id, p_status: "processed", p_ai_meta: { handled: "stop" } });
      return "stop";
    }
    if (start.includes(t)) {
      await sb.rpc("wa_set_consent", { p_phone: phone, p_scope: "marketing", p_status: "granted", p_source: "whatsapp_start", p_evidence: { wamid: row.wamid } });
      await reply(CANNED[locale].start, "optin_confirmation", "start-confirm");
      await sb.rpc("wa_mark_processed", { p_id: row.id, p_status: "processed", p_ai_meta: { handled: "start" } });
      return "start";
    }
  }

  // 2. media: we cannot read it; a person should look
  if (MEDIA_TYPES.has(type)) {
    await reply(CANNED[locale].media, "handoff_reply", "media-reply");
    await sb.rpc("wa_raise_needs_human", { p_msg_id: row.id, p_reason: `customer sent ${type}` });
    await sb.rpc("wa_mark_processed", { p_id: row.id, p_status: "processed", p_ai_meta: { handled: "media", content_type: type, needs_human: true } });
    return "media";
  }
  if (!TEXT_TYPES.has(type) || !text.trim()) {
    await sb.rpc("wa_mark_processed", { p_id: row.id, p_status: "skipped", p_error: `nothing to answer (${type})` });
    return "skipped";
  }

  // 3. customer question: server-built context -> guarded answer -> queue (never sent from here)
  const ctx = await buildSupportContext(sb, phone, env);
  const answer = await answerCustomer(sb, { phoneE164: phone, text, ctx, locale, env });
  if (!answer) { await sb.rpc("wa_mark_processed", { p_id: row.id, p_status: "skipped", p_error: "empty message" }); return "skipped"; }
  await reply(answer.text, answer.source === "ai" ? "ai_reply" : "handoff_reply", "reply");
  if (answer.needsHuman) await sb.rpc("wa_raise_needs_human", { p_msg_id: row.id, p_reason: answer.reason ?? answer.intent });
  await sb.rpc("wa_mark_processed", { p_id: row.id, p_status: "processed", p_ai_meta: { ...answer.meta, source: answer.source, reason: answer.reason ?? null, needs_human: answer.needsHuman } });
  return answer.source;
}

export type BatchResult = { claimed: number; results: Record<string, number>; stale: number; ms: number };

export async function processBatch(sb: Sb, env: Env, o: { budgetMs?: number } = {}): Promise<BatchResult> {
  const t0 = Date.now();
  const budget = o.budgetMs ?? 45000;
  const cfg = senderConfigFromEnv(env);
  const { data: q } = await sb.from("site_settings").select("value").eq("key", "whatsapp_queue").maybeSingle();
  const perRun = Number(q?.value?.per_run ?? 20);
  const marketingPerRun = Number(q?.value?.marketing_per_run ?? 10);
  const stale = Number((await sb.rpc("wa_requeue_stale")).data ?? 0);
  const results: Record<string, number> = {};
  let claimed = 0;
  let marketingClaimed = 0;

  // More than one round only exists to send replies that an inbound job just queued. Outbound-only rounds stop after one:
  // the per-run caps (perRun, marketingPerRun) are the rate control, and cron runs once a minute.
  for (let round = 0; round < 5 && Date.now() - t0 < budget; round++) {
    const { data: rows, error } = await sb.rpc("wa_claim_batch", {
      p_limit: perRun, p_marketing_limit: Math.max(0, marketingPerRun - marketingClaimed), p_lease_secs: 120 });
    if (error) throw new Error(`claim failed: ${error.message}`);
    if (!rows?.length) break;
    let sawInbound = false;
    for (const row of rows as Row[]) {
      claimed++;
      if (row.category === "marketing") marketingClaimed++;
      if (row.direction === "inbound") sawInbound = true;
      let outcome: string;
      try {
        outcome = row.direction === "inbound" ? await processInbound(sb, env, row) : await sendOne(sb, env, row, cfg);
      } catch (e) {
        const msg = `worker exception: ${(e as Error).message}`.slice(0, 300);
        outcome = row.direction === "inbound"
          ? ((await sb.rpc("wa_inbound_retry", { p_id: row.id, p_error: msg })).data as string)
          : ((await sb.rpc("wa_mark_failure", { p_id: row.id, p_code: 0, p_message: msg, p_retryable: true })).data as string);
      }
      results[outcome] = (results[outcome] ?? 0) + 1;
      if (Date.now() - t0 >= budget) break;
    }
    if (!sawInbound) break;
  }
  return { claimed, results, stale, ms: Date.now() - t0 };
}
