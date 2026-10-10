import { hasScript } from "./locale.ts";
import { INTENTS, SupportReplyError } from "./types.ts";
import type { Intent, Locale, SupportContext, SupportReply } from "./types.ts";

// Output validation: the model's text is untrusted too. A reply that fails ANY check is discarded and replaced by the safe
// handoff message - we never "fix up" model output. Every number, order id, link and phone number must come from the
// server-built context.

export const MAX_REPLY_CHARS = 700;
const MIN_CONFIDENCE = 0.5;

// first {...} block; models sometimes wrap JSON in prose or code fences
export function extractJson(raw: string): unknown {
  const s = String(raw ?? "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) throw new SupportReplyError("bad_output", "no JSON object in model output");
  try { return JSON.parse(s.slice(start, end + 1)); } catch { throw new SupportReplyError("bad_output", "model output is not valid JSON"); }
}

const numberSet = (ctx: SupportContext): Set<string> => {
  const s = new Set<string>();
  const add = (n: number) => { s.add(String(Math.round(n))); s.add(Number(n).toFixed(2)); s.add(String(n)); };
  ctx.catalog.forEach((p) => add(p.price));
  ctx.orders.forEach((o) => add(o.total));
  return s;
};

function hostOf(u: string): string {
  try { return new URL(/^https?:/i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return u.toLowerCase(); }
}

export type Validation = { ok: true; reply: SupportReply } | { ok: false; reason: string };

export function validateSupportReply(raw: string, ctx: SupportContext, locale: Locale): Validation {
  let obj: any;
  try { obj = extractJson(raw); } catch (e) { return { ok: false, reason: (e as Error).message }; }

  const text = typeof obj?.text === "string" ? obj.text.replace(/\s+\n/g, "\n").trim() : "";
  const intent: Intent = INTENTS.includes(obj?.intent) ? obj.intent : "other";
  const confidence = typeof obj?.confidence === "number" && obj.confidence >= 0 && obj.confidence <= 1 ? obj.confidence : NaN;
  const needsHumanRaw = obj?.needs_human ?? obj?.needsHuman;
  if (!text) return { ok: false, reason: "empty text" };
  if (Number.isNaN(confidence)) return { ok: false, reason: "confidence missing or out of range" };
  if (typeof needsHumanRaw !== "boolean") return { ok: false, reason: "needs_human missing" };
  if (text.length > MAX_REPLY_CHARS) return { ok: false, reason: "reply too long" };

  // links: only the store's own site
  const allowedHosts = new Set([ctx.store.website ? hostOf(ctx.store.website) : ""].filter(Boolean));
  for (const m of text.matchAll(/\b(?:https?:\/\/|www\.)[^\s)]+/gi)) {
    if (!allowedHosts.has(hostOf(m[0]))) return { ok: false, reason: "link not on the allow-list" };
  }
  // phone numbers: only the store's
  const phones = new Set(ctx.store.phones.map((p) => p.replace(/\D/g, "").slice(-10)));
  for (const m of text.matchAll(/(?:\+?\d[\d\s-]{8,}\d)/g)) {
    const d = m[0].replace(/\D/g, "");
    if (d.length >= 10 && !phones.has(d.slice(-10))) return { ok: false, reason: "phone number not on the allow-list" };
  }
  // e-mail addresses: only the store's
  const emails = new Set(ctx.store.emails.map((e) => e.toLowerCase()));
  for (const m of text.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) {
    if (!emails.has(m[0].toLowerCase())) return { ok: false, reason: "email not on the allow-list" };
  }
  // money: every rupee amount must be a catalog price or one of THIS customer's order totals
  const allowedNums = numberSet(ctx);
  for (const m of text.matchAll(/(?:₹|rs\.?|inr|रु|रूपये|ರೂ|రూ)\s*([\d,]+(?:\.\d+)?)/gi)) {
    const n = m[1].replace(/,/g, "");
    if (!allowedNums.has(n) && !allowedNums.has(String(Number(n)))) return { ok: false, reason: `amount ${n} is not in the provided data` };
  }
  // order numbers: only this customer's
  const own = new Set(ctx.orders.map((o) => o.id));
  for (const m of text.matchAll(/(?:#\s?|order\s*(?:no\.?|number|id|#)?\s*[:#]?\s*)(\d{1,9})\b/gi)) {
    if (!own.has(Number(m[1]))) return { ok: false, reason: `order ${m[1]} is not this customer's` };
  }
  // internal business data / prompt leakage
  if (/\b(cost\s*price|purchase\s*price|buying\s*price|profit\s*margin|supplier|wholesale)\b/i.test(text)) return { ok: false, reason: "mentions internal costs" };
  if (/(authorized data|system prompt|these rules|<customer_message>|this_customers_orders|in_stock\b)/i.test(text)) return { ok: false, reason: "leaks prompt internals" };
  // the assistant cannot act: it must not claim it did
  if (/\b(i|we)(\s+(have|has)|'ve|\s+will|'ll|\s+am going to)\s+(just\s+|already\s+)?((issued?|initiated?|process(?:e[ds])?|started?|approved?|cancel+ed|cancel|refund(ed)?|reduced?|restocked?|marked)\b|(updated?|changed?)\b(?!\s+(you\b|your\s+(status|progress)\b)))/i.test(text)) {
    return { ok: false, reason: "claims an action it cannot perform" };
  }
  // medical advice
  if (/\b(\d+\s?(mg|ml|mcg|units?|iu)\b|dosage|you should take|take\s+\d+)/i.test(text)) return { ok: false, reason: "contains medical dosing advice" };
  if (!hasScript(text, locale)) return { ok: false, reason: "reply language does not match the customer's script" };

  // intents that must reach a person regardless of what the model said
  const mustEscalate = intent === "returns_refund" || intent === "complaint";
  const needsHuman = needsHumanRaw || mustEscalate || confidence < MIN_CONFIDENCE;
  return { ok: true, reply: { text, intent, confidence, needsHuman } };
}

// campaign copy: suggestions only, same suspicion
export function validateCopySuggestions(raw: string, maxLen: number, brief: string): { ok: true; suggestions: string[] } | { ok: false; reason: string } {
  let obj: any;
  try { obj = extractJson(raw); } catch (e) { return { ok: false, reason: (e as Error).message }; }
  const arr: unknown = obj?.suggestions;
  if (!Array.isArray(arr) || arr.length < 1) return { ok: false, reason: "no suggestions" };
  const briefNums = new Set((brief.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/,/g, "")));
  const out: string[] = [];
  for (const s of arr.slice(0, 5)) {
    if (typeof s !== "string") continue;
    const t = s.replace(/\s+/g, " ").trim();
    if (!t || t.length > maxLen) continue;
    if (/(https?:\/\/|www\.|@\w+\.\w+)/i.test(t)) continue;
    if (/\b(cure|cures|guarantee|guaranteed|100%|miracle|treat(s|ment)? (diabetes|cancer|bp))\b/i.test(t)) continue;
    const nums = t.match(/\d[\d,.]*/g) ?? [];
    if (nums.some((n) => !briefNums.has(n.replace(/,/g, "")))) continue;     // numbers/prices must come from the owner's brief
    out.push(t);
  }
  return out.length ? { ok: true, suggestions: out } : { ok: false, reason: "no suggestion passed validation" };
}
