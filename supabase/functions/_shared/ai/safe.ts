import { CANNED } from "./locale.ts";
import { generateSupportReplyDetailed, SupportReplyError } from "./index.ts";
import type { GenerateOptions } from "./index.ts";
import { preflightSupportMessage } from "./preflight.ts";
import type { Intent, Locale, SupportContext } from "./types.ts";

// The wrapper whatsapp processing calls. Adds everything that must hold even when the model is down, slow, expensive or hostile:
// preflight, circuit breaker, daily spend cap, per-customer rate limit, human escalation and a canned fallback. It never throws.

export type Answer = {
  text: string; intent: Intent; confidence: number; needsHuman: boolean;
  source: "ai" | "canned";
  reason?: string;                       // why the canned path was used (logged in ai_meta, never shown to the customer)
  meta: Record<string, unknown>;
};

const ORDER_QUESTION = /\b(my|mera|meri|nanna|naa)\b[\s\S]{0,20}\b(order|parcel|delivery)\b|\border\s*(status|track|kahan|where)|where is my (order|parcel)|\btrack(ing)?\b[\s\S]{0,20}\b(order|parcel|shipment)\b/i;

type Sb = { rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: any; error: any }>; from: (t: string) => any };

const canned = (locale: Locale, kind: "handoff" | "refuse" | "noOrders", reason: string, needsHuman: boolean, extra: Record<string, unknown> = {}): Answer => ({
  text: CANNED[locale][kind], intent: "other", confidence: 0, needsHuman, source: "canned", reason, meta: { reason, ...extra },
});

export async function answerCustomer(
  sb: Sb,
  o: { phoneE164: string; text: string; ctx: SupportContext; locale: Locale; env: (k: string) => string | undefined; gen?: GenerateOptions },
): Promise<Answer | null> {
  const pf = preflightSupportMessage(o.text, o.ctx, o.locale);
  if (pf.action === "skip") return null;
  if (pf.action === "refuse") return canned(o.locale, "refuse", `preflight:${pf.reason}`, pf.reason === "foreign_order_reference");

  // deterministic, free, and impossible to talk around: an unknown customer asking about "my order" has no orders to discuss
  if (ORDER_QUESTION.test(pf.text) && o.ctx.orders.length === 0) return canned(o.locale, "noOrders", "no_orders_for_number", true);

  if ((o.env("AI_PROVIDER") || "disabled").toLowerCase() === "disabled") return canned(o.locale, "handoff", "ai_disabled", true);
  // Languages the chosen model has been MEASURED to handle (AI_ENABLED_LOCALES, default English only). Any other script goes to a person
  // with a fixed reply in that language: we do not let a model answer in a language nobody has verified it can answer in.
  const enabled = (o.env("AI_ENABLED_LOCALES") || "en").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean);
  if (!enabled.includes(o.locale)) return canned(o.locale, "handoff", `locale_not_enabled:${o.locale}`, true);

  const capMicro = Math.round(Number(o.env("AI_DAILY_CAP_USD") ?? "5") * 1_000_000);
  const perHour = Number(o.env("AI_MAX_PER_CUSTOMER_HOUR") ?? "10");
  try {
    const gate = (await sb.rpc("ai_gate")).data ?? {};
    if (gate.circuit_open) return canned(o.locale, "handoff", "circuit_open", true);
    if (Number(gate.spent_micro_usd ?? 0) >= capMicro) return canned(o.locale, "handoff", "spend_cap_reached", true);
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await sb.from("whatsapp_messages").select("id", { count: "exact", head: true })
      .eq("phone_e164", o.phoneE164).eq("direction", "outbound").eq("message_type", "ai_reply").gte("sent_at", since);
    if ((count ?? 0) >= perHour) return canned(o.locale, "handoff", "customer_rate_limited", true);
  } catch (e) {
    return canned(o.locale, "handoff", `gate_error:${(e as Error).message}`.slice(0, 120), true);   // fail safe, not open
  }

  const priceIn = Number(o.env("AI_PRICE_IN_PER_MTOK") ?? "0");
  const priceOut = Number(o.env("AI_PRICE_OUT_PER_MTOK") ?? "0");
  const cost = (i: number, out: number) => Math.round(i * priceIn + out * priceOut);   // $ per million tokens == micro-$ per token
  try {
    const { reply, usage } = await generateSupportReplyDetailed({ context: o.ctx, userMessage: pf.text, locale: o.locale }, o.gen ?? { env: o.env });
    await sb.rpc("ai_record", { p_ok: true, p_in: usage.inputTokens, p_out: usage.outputTokens, p_cost_micro: cost(usage.inputTokens, usage.outputTokens) });
    return { ...reply, source: "ai", meta: { provider: usage.provider, model: usage.model, latency_ms: usage.latencyMs, attempts: usage.attempts,
      input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, intent: reply.intent, confidence: reply.confidence, needs_human: reply.needsHuman } };
  } catch (e) {
    const err = e as SupportReplyError;
    const kind = err instanceof SupportReplyError ? err.kind : "provider_error";
    if (kind !== "disabled") {
      // a validation failure means the model answered (no outage) but cost tokens; a transport failure counts towards the circuit
      const outage = kind === "timeout" || kind === "provider_error" || kind === "bad_output";
      try { await sb.rpc("ai_record", { p_ok: !outage, p_in: err.usage?.inputTokens ?? 0, p_out: err.usage?.outputTokens ?? 0,
        p_cost_micro: cost(err.usage?.inputTokens ?? 0, err.usage?.outputTokens ?? 0), p_error: `${kind}: ${err.message}`.slice(0, 200) }); } catch { /* best effort */ }
    }
    return canned(o.locale, "handoff", `ai_${kind}`, true, { detail: String(err.message).slice(0, 160) });
  }
}
