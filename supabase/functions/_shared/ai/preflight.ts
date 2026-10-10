import { CANNED } from "./locale.ts";
import type { Locale, SupportContext } from "./types.ts";

// Deterministic checks that run BEFORE any model is called. They are a cheap first line (and save a model call); the real
// protection is structural: the model only ever sees this customer's own data, and its output is validated afterwards.
// These patterns are heuristics - they will not catch every phrasing, which is exactly why they are not the only layer.

const INJECTION = [
  /ignore\s+(all|any|the|your|previous|above|prior)[\s\S]{0,40}(instruction|rule|prompt|guideline)/i,
  /disregard\s+(all|any|the|your|previous|above)/i,
  /(reveal|show|print|repeat|output|tell me)[\s\S]{0,30}(system\s*prompt|your\s*(instructions|rules|prompt)|hidden\s*(rules|prompt))/i,
  /\b(you are now|from now on you|act as|pretend to be|roleplay as)\b[\s\S]{0,40}(admin|developer|owner|root|unrestricted|jailbreak|dan)/i,
  /\b(developer mode|jailbreak|do anything now)\b/i,
  /<\s*\/?\s*(system|assistant|customer_message)\s*>/i,
  // Hindi / Kannada / Telugu (wording from the evaluation set; needs native review, and is NOT exhaustive)
  /(\u092a\u093f\u091b\u0932\u0947|\u090a\u092a\u0930 \u0915\u0947)[\s\S]{0,20}\u0928\u093f\u0930\u094d\u0926\u0947\u0936[\s\S]{0,30}(\u092d\u0942\u0932|\u0928\u091c\u093c\u0930\u0905\u0902\u0926\u093e\u091c|\u0905\u0928\u0926\u0947\u0916\u093e)/,
  /\u0938\u093f\u0938\u094d\u091f\u092e \u092a\u094d\u0930\u0949\u092e\u094d\u092a\u094d\u091f/,
  /\u0cb8\u0cc2\u0c9a\u0ca8\u0cc6[\s\S]{0,30}\u0cb5\u0cbf\u0cb8\u0ccd\u0cae\u0cb0\u0cbf\u0cb8\u0cbf|\u0cb8\u0cbf\u0cb8\u0ccd\u0c9f\u0cae\u0ccd \u0caa\u0ccd\u0cb0\u0cbe\u0c82\u0caa\u0ccd\u0c9f\u0ccd/,
  /\u0c38\u0c42\u0c1a\u0c28[\s\S]{0,30}\u0c35\u0c3f\u0c38\u0c4d\u0c2e\u0c30\u0c3f\u0c02\u0c1a\u0c3f|\u0c38\u0c3f\u0c38\u0c4d\u0c1f\u0c2e\u0c4d \u0c2a\u0c4d\u0c30\u0c3e\u0c02\u0c2a\u0c4d\u0c1f\u0c4d/,
];
const COST_REQUEST = /\b(cost\s*price|purchase\s*price|buying\s*price|wholesale|profit\s*margin|your\s*margin|supplier\s*price|dealer\s*price|landed\s*cost)\b|\u0932\u093e\u0917\u0924 \u092e\u0942\u0932\u094d\u092f|\u0916\u0930\u0940\u0926 \u092e\u0942\u0932\u094d\u092f|\u092e\u093e\u0930\u094d\u091c\u093f\u0928|\u092e\u0941\u0928\u093e\u092b|\u0c96\u0cb0\u0cc0\u0ca6\u0cbf \u0cac\u0cc6\u0cb2\u0cc6|\u0cae\u0cbe\u0cb0\u0ccd\u0c9c\u0cbf\u0ca8\u0ccd|\u0cb2\u0cbe\u0cad|\u0c15\u0c4a\u0c28\u0c41\u0c17\u0c4b\u0c32\u0c41 \u0c27\u0c30|\u0c2e\u0c3e\u0c30\u0c4d\u0c1c\u0c3f\u0c28\u0c4d|\u0c32\u0c3e\u0c2d\u0c02/i;
const BULK_DATA = /\b(all|every|other|someone|somebody|another|different)\b[\s\S]{0,25}\b(orders?|customers?|users?|phone numbers?|addresses|emails?)\b/i;
const ORDER_REF = /(?:#\s?|order\s*(?:no\.?|number|id|#)?\s*[:#]?\s*)(\d{1,9})\b/gi;

export type Preflight =
  | { action: "proceed"; text: string }
  | { action: "refuse"; reason: string; text: string }
  | { action: "skip"; reason: string };

export function orderRefs(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(ORDER_REF)) out.push(Number(m[1]));
  return out;
}

export function preflightSupportMessage(raw: string, ctx: SupportContext, locale: Locale): Preflight {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { action: "skip", reason: "empty" };
  const clipped = text.slice(0, 1000);
  const refuse = (reason: string): Preflight => ({ action: "refuse", reason, text: CANNED[locale].refuse });

  if (INJECTION.some((r) => r.test(clipped))) return refuse("prompt_injection");
  if (COST_REQUEST.test(clipped)) return refuse("cost_price_request");
  const own = new Set(ctx.orders.map((o) => o.id));
  if (orderRefs(clipped).some((id) => !own.has(id))) return refuse("foreign_order_reference");
  if (BULK_DATA.test(clipped) && !/\bmy\b/i.test(clipped)) return refuse("bulk_or_other_customer_data");
  return { action: "proceed", text: clipped };
}
