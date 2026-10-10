// Provider-neutral courier webhook helpers (pure, unit-tested). NO provider's wording or payload schema is assumed to be correct:
// field names below are a generic best effort and every real provider must be checked against its own documentation before launch.
import { constantTimeEqual, hmacSha256Hex } from "./meta-signature.ts";

export type CourierAuthMode = "token" | "hmac";
export type AuthResult = { ok: true } | { ok: false; reason: string };

export type CourierAuthConfig = {
  mode: CourierAuthMode;
  secret: string | undefined;                // token value (mode token) or HMAC key (mode hmac)
  signatureHeader?: string;                  // hmac: header carrying the signature
  encoding?: "hex" | "base64";               // hmac: how the signature is encoded
  prefix?: string;                           // hmac: literal prefix before the signature, e.g. "sha256="
};

const b64 = (hex: string) => btoa(hex.match(/../g)!.map((h) => String.fromCharCode(parseInt(h, 16))).join(""));

// Fails closed: no secret configured = nobody is authorised. Constant-time comparisons.
export async function verifyCourierAuth(headers: Headers, rawBody: Uint8Array, cfg: CourierAuthConfig): Promise<AuthResult> {
  if (!cfg.secret) return { ok: false, reason: "not_configured" };
  if (cfg.mode === "token") {
    const provided = headers.get("x-api-key") || headers.get("x-webhook-token") || (headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!provided) return { ok: false, reason: "missing_token" };
    return constantTimeEqual(provided, cfg.secret) ? { ok: true } : { ok: false, reason: "bad_token" };
  }
  const header = headers.get(cfg.signatureHeader || "x-signature");
  if (!header) return { ok: false, reason: "missing_signature" };
  let sig = header.trim();
  if (cfg.prefix) { if (!sig.startsWith(cfg.prefix)) return { ok: false, reason: "bad_signature_format" }; sig = sig.slice(cfg.prefix.length); }
  const hex = await hmacSha256Hex(cfg.secret, rawBody);
  const expected = cfg.encoding === "base64" ? b64(hex) : hex;
  return constantTimeEqual(cfg.encoding === "base64" ? sig : sig.toLowerCase(), expected) ? { ok: true } : { ok: false, reason: "bad_signature" };
}

const pick = (obj: Record<string, unknown> | null | undefined, keys: string[]): string | null => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "" && typeof v !== "object") return String(v);
  }
  return null;
};

export type CourierEvent = { status: string | null; awb: string | null; orderRef: string | null; courier: string | null; timestamp: string | null };

// Generic field extraction. A provider whose payload differs needs its own small adapter here, written from its documentation.
export function extractGeneric(body: unknown): CourierEvent {
  const payload = (Array.isArray(body) ? body[0] : body) as Record<string, unknown> | null;
  return {
    status: pick(payload, ["current_status", "status", "shipment_status", "orderStatus"]),
    awb: pick(payload, ["awb", "awb_code", "waybill", "tracking_number"]),
    orderRef: pick(payload, ["order_id", "channel_order_id", "client_order_id", "merchant_order_id"]),
    courier: pick(payload, ["courier_name", "courier", "carrier"]),
    timestamp: pick(payload, ["current_timestamp", "timestamp", "status_date", "updated_at", "event_time"]),
  };
}

// Deterministic dedup key: the same provider/awb/status/timestamp is one event however many times it is delivered.
export async function eventKey(provider: string, e: CourierEvent): Promise<string> {
  const data = new TextEncoder().encode([provider, e.awb ?? "", e.orderRef ?? "", (e.status ?? "").toLowerCase(), e.timestamp ?? ""].join("|"));
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(h).map((b) => b.toString(16).padStart(2, "0")).join("");
}
