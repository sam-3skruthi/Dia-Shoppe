// Meta webhook signature: X-Hub-Signature-256 = "sha256=" + hex(HMAC-SHA256(app secret, EXACT raw request bytes)).
// Read the body ONCE as bytes, verify, and only then parse. Fails closed on any problem, including a missing secret.
const enc = new TextEncoder();

export function constantTimeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function hmacSha256Hex(secret: string, bytes: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes));
  return Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type SignatureResult = { ok: true } | { ok: false; reason: "no_secret" | "missing_header" | "bad_format" | "mismatch" };

export async function verifyMetaSignature(rawBody: Uint8Array, header: string | null, secret: string | undefined): Promise<SignatureResult> {
  if (!secret) return { ok: false, reason: "no_secret" };
  if (!header) return { ok: false, reason: "missing_header" };
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return { ok: false, reason: "bad_format" };
  const expected = await hmacSha256Hex(secret, rawBody);
  return constantTimeEqual(expected, m[1].toLowerCase()) ? { ok: true } : { ok: false, reason: "mismatch" };
}
