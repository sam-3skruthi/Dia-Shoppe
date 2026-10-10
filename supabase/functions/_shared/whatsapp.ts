// The ONE WhatsApp sender. Used by the worker (and nothing else talks to the Graph API).
// Pure logic (validation, sanitising, payload building, error classification) is separated from the network call so it can be unit-tested.
// There is no hello_world fallback anywhere: a failed template is a failed message, with Meta's real reason recorded.

export type Category = "utility" | "marketing" | "service" | "authentication";

export type RegistryTemplate = {
  name: string;
  language: string;
  category: "utility" | "marketing" | "authentication";
  status: "pending" | "approved" | "rejected" | "paused" | "disabled";
  body_params: number;
  param_schema: { name: string; kind: string; max: number }[];
  header_type: "none" | "text" | "image" | "video" | "document";
  enabled: boolean;
};

export type SendError = { ok: false; code: number; message: string; retryable: boolean; pauseQueue?: boolean };
export type SendOk = { ok: true; wamid: string };

// Indian 10-digit numbers -> E.164 without the plus (Cloud API format). Same rule as the SQL helper private.wa_e164.
export function normalizePhone(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 10) return `91${d}`;
  if (d.length >= 11 && d.length <= 15) return d;
  return null;
}

// Meta rejects params containing newlines, tabs or 4+ consecutive spaces. Also strip control / zero-width / bidi characters.
export function sanitizeParam(value: unknown, max: number, truncate = false): { ok: true; value: string } | { ok: false; code: string } {
  let s = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f\u0080-\u009f​-‏‪-‮⁠-⁤﻿]/g, " ")
    .replace(/ {4,}/g, "   ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return { ok: false, code: "param_empty" };
  if (s.length > max) {
    if (!truncate) return { ok: false, code: "param_too_long" };
    s = s.slice(0, max).trim();
  }
  return { ok: true, value: s };
}

export type ValidateResult =
  | { ok: true; params: string[] }
  | { ok: false; code: number; message: string; retryable: false };

// Local error codes (not Meta's): 9000xx, so they can never collide with a Meta code and are always permanent.
export const LOCAL = {
  not_registered: 900001, not_approved: 900002, disabled: 900003, param_count: 900004, param_invalid: 900005,
  image_required: 900006, category_mismatch: 900007, no_config: 900008,
} as const;

export function validateTemplateSend(
  tpl: RegistryTemplate | null | undefined, expectedCategory: Category, rawParams: unknown[], headerImageUrl?: string | null,
): ValidateResult {
  const fail = (code: number, message: string): ValidateResult => ({ ok: false, code, message, retryable: false });
  if (!tpl) return fail(LOCAL.not_registered, "template is not in the registry");
  if (!tpl.enabled) return fail(LOCAL.disabled, `template ${tpl.name}/${tpl.language} is disabled`);
  if (tpl.status !== "approved") return fail(LOCAL.not_approved, `template ${tpl.name}/${tpl.language} is ${tpl.status}, not approved`);
  if (tpl.category !== expectedCategory) return fail(LOCAL.category_mismatch, `template category ${tpl.category} does not match the message category ${expectedCategory}`);
  if (rawParams.length !== tpl.body_params) return fail(LOCAL.param_count, `expected ${tpl.body_params} variables, got ${rawParams.length}`);
  if (tpl.header_type === "image" && !headerImageUrl) return fail(LOCAL.image_required, "this template needs a header image URL");
  if (tpl.header_type === "image" && !/^https:\/\//i.test(headerImageUrl ?? "")) return fail(LOCAL.image_required, "header image must be an https URL");
  const out: string[] = [];
  for (let i = 0; i < tpl.body_params; i++) {
    const spec = tpl.param_schema[i];
    const r = sanitizeParam(rawParams[i], spec?.max ?? 200, spec?.kind === "recipient_first_name");
    if (!r.ok) return fail(LOCAL.param_invalid, `variable ${i + 1} (${spec?.name ?? "?"}): ${r.code}`);
    out.push(r.value);
  }
  return { ok: true, params: out };
}

export function buildTemplatePayload(o: { to: string; name: string; language: string; params: string[]; headerImageUrl?: string | null; clientRef?: string }) {
  const components: Record<string, unknown>[] = [];
  if (o.headerImageUrl) components.push({ type: "header", parameters: [{ type: "image", image: { link: o.headerImageUrl } }] });
  if (o.params.length) components.push({ type: "body", parameters: o.params.map((t) => ({ type: "text", text: t })) });
  return {
    messaging_product: "whatsapp", recipient_type: "individual", to: o.to, type: "template",
    template: { name: o.name, language: { code: o.language }, ...(components.length ? { components } : {}) },
    ...(o.clientRef ? { biz_opaque_callback_data: o.clientRef } : {}),
  };
}

export function buildTextPayload(o: { to: string; body: string; clientRef?: string }) {
  return {
    messaging_product: "whatsapp", recipient_type: "individual", to: o.to, type: "text",
    text: { body: o.body, preview_url: false },
    ...(o.clientRef ? { biz_opaque_callback_data: o.clientRef } : {}),
  };
}

// Meta error code -> what to do. Anything unknown with a 4xx is permanent; 5xx / network is transient.
const TRANSIENT = new Set([1, 2, 4, 17, 80007, 130429, 131000, 131016, 131056, 133004, 133005]);
const PERMANENT = new Set([100, 131030, 131008, 131009, 131021, 131026, 131031, 131042, 131045, 131047, 131048, 131049, 131051, 131052, 131053,
  132000, 132001, 132005, 132007, 132012, 132015, 132016, 368, 10, 200]);
const TOKEN = new Set([190, 102, 463, 467]);
const ACCOUNT_LOCKED = new Set([368, 131031]);

// deno-lint-ignore no-explicit-any
export function classifyMetaError(httpStatus: number, body: any): { code: number; message: string; retryable: boolean; pauseQueue: boolean } {
  const e = body?.error ?? {};
  const code = Number(e.code ?? 0);
  const message = String(e.error_data?.details || e.error_user_msg || e.message || `HTTP ${httpStatus}`).slice(0, 500);
  if (TOKEN.has(code) || (httpStatus === 401 && !code)) return { code: code || 190, message, retryable: true, pauseQueue: true };
  if (ACCOUNT_LOCKED.has(code)) return { code, message, retryable: false, pauseQueue: true };
  if (PERMANENT.has(code)) return { code, message, retryable: false, pauseQueue: false };
  if (TRANSIENT.has(code) || httpStatus >= 500 || httpStatus === 429 || httpStatus === 408) return { code: code || httpStatus, message, retryable: true, pauseQueue: false };
  return { code: code || httpStatus, message, retryable: false, pauseQueue: false };
}

export type SenderConfig = { apiBase: string; phoneId: string; token: string; timeoutMs?: number; fetchImpl?: typeof fetch };

export function senderConfigFromEnv(env: (k: string) => string | undefined): SenderConfig | null {
  const token = env("WHATSAPP_TOKEN");
  const phoneId = env("WHATSAPP_PHONE_ID");
  if (!token || !phoneId) return null;
  return { apiBase: (env("WHATSAPP_API_BASE") || "https://graph.facebook.com/v21.0").replace(/\/+$/, ""), phoneId, token };
}

async function post(cfg: SenderConfig, payload: unknown): Promise<SendOk | SendError> {
  const f = cfg.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), cfg.timeoutMs ?? 10000);
  try {
    const resp = await f(`${cfg.apiBase}/${cfg.phoneId}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal: ctrl.signal,
    });
    // deno-lint-ignore no-explicit-any
    let json: any = null;
    try { json = await resp.json(); } catch { /* non-JSON body */ }
    const wamid = json?.messages?.[0]?.id;
    if (resp.ok && wamid) return { ok: true, wamid: String(wamid) };
    if (resp.ok) return { ok: false, code: 0, message: "Graph API answered 2xx without a message id", retryable: false }; // never report "sent" without a wamid
    const c = classifyMetaError(resp.status, json);
    return { ok: false, code: c.code, message: c.message, retryable: c.retryable, pauseQueue: c.pauseQueue };
  } catch (err) {
    const aborted = (err as Error)?.name === "AbortError";
    return { ok: false, code: aborted ? 408 : 0, message: aborted ? "timeout calling the Graph API" : `network error: ${(err as Error)?.message ?? err}`, retryable: true };
  } finally {
    clearTimeout(t);
  }
}

export function sendTemplateMessage(cfg: SenderConfig, o: { to: string; name: string; language: string; params: string[]; headerImageUrl?: string | null; clientRef?: string }) {
  return post(cfg, buildTemplatePayload(o));
}
export function sendTextMessage(cfg: SenderConfig, o: { to: string; body: string; clientRef?: string }) {
  return post(cfg, buildTextPayload(o));
}
