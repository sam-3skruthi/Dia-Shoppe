import { getProvider } from "./factory.ts";
import type { AiEnv } from "./factory.ts";
import { extractJson, validateCopySuggestions, validateSupportReply } from "./guardrails.ts";
import { buildCopySystemPrompt, buildSystemPrompt, wrapUserMessage } from "./prompt.ts";
import { SupportReplyError } from "./types.ts";
import type { AiProvider, Locale, SupportContext, SupportReply } from "./types.ts";

export type { Locale, SupportContext, SupportReply } from "./types.ts";
export { SupportReplyError } from "./types.ts";

export type Usage = { provider: string; model: string; inputTokens: number; outputTokens: number; latencyMs: number; attempts: number };
export type GenerateOptions = {
  env?: AiEnv; fetchImpl?: typeof fetch; provider?: { provider: AiProvider; model: string };
  timeoutMs?: number; retries?: number; maxTokens?: number;
};

const denoEnv: AiEnv = (k) => (globalThis as any).Deno?.env?.get(k);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// provider call with timeout (inside the adapter) and ONE retry on a transient failure
async function callWithRetry(
  p: { provider: AiProvider; model: string }, system: string, user: string, o: GenerateOptions,
) {
  const retries = o.retries ?? 1;
  const timeoutMs = o.timeoutMs ?? (Number((o.env ?? denoEnv)("AI_TIMEOUT_MS")) || 8000);
  let last: unknown;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const t0 = Date.now();
    try {
      const r = await p.provider.chat({ system, user, model: p.model, timeoutMs, maxTokens: o.maxTokens ?? 400, temperature: 0.2 });
      return { r, attempts: attempt, latencyMs: Date.now() - t0 };
    } catch (e) {
      last = e;
      if (!(e instanceof SupportReplyError) || !e.retryable || attempt > retries) throw e;
      await sleep(300 * attempt);
    }
  }
  throw last;
}

// The public contract: server-built context + the customer's text -> a validated reply.
// Throws SupportReplyError (disabled | timeout | provider_error | bad_output | validation); callers decide the fallback.
export async function generateSupportReplyDetailed(
  input: { context: SupportContext; userMessage: string; locale: Locale }, o: GenerateOptions = {},
): Promise<{ reply: SupportReply; usage: Usage }> {
  const p = o.provider ?? getProvider(o.env ?? denoEnv, o.fetchImpl);
  const { r, attempts, latencyMs } = await callWithRetry(p, buildSystemPrompt(input.context, input.locale), wrapUserMessage(input.userMessage), o);
  const v = validateSupportReply(r.text, input.context, input.locale);
  if (!v.ok) {
    // unparseable output = the endpoint/model is misbehaving (counts towards the circuit); parseable-but-unacceptable = validation
    const unparseable = /no JSON object|not valid JSON/.test(v.reason);
    const err = new SupportReplyError(unparseable ? "bad_output" : "validation", v.reason);
    err.usage = { inputTokens: r.inputTokens, outputTokens: r.outputTokens };
    throw err;
  }
  return { reply: v.reply, usage: { provider: p.provider.name, model: p.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, latencyMs, attempts } };
}

export async function generateSupportReply(
  input: { context: SupportContext; userMessage: string; locale: Locale }, o: GenerateOptions = {},
): Promise<SupportReply> {
  return (await generateSupportReplyDetailed(input, o)).reply;
}

// Campaign copy: 1-3 SUGGESTIONS for one template variable. The model never sees customer data and never picks recipients.
export async function generateCampaignCopy(
  input: { brief: string; maxLen: number; language: string }, o: GenerateOptions = {},
): Promise<{ suggestions: string[]; usage: Usage }> {
  const p = o.provider ?? getProvider(o.env ?? denoEnv, o.fetchImpl);
  const brief = input.brief.replace(/\s+/g, " ").trim().slice(0, 600);
  if (!brief) throw new SupportReplyError("validation", "empty brief");
  const { r, attempts, latencyMs } = await callWithRetry(p, buildCopySystemPrompt(input.maxLen, input.language), `<brief>\n${brief}\n</brief>`, { ...o, maxTokens: o.maxTokens ?? 500 });
  extractJson(r.text);
  const v = validateCopySuggestions(r.text, input.maxLen, brief);
  if (!v.ok) throw new SupportReplyError("validation", v.reason);
  return { suggestions: v.suggestions, usage: { provider: p.provider.name, model: p.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, latencyMs, attempts } };
}
