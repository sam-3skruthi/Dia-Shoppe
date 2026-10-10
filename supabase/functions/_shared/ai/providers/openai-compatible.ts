import { SupportReplyError } from "../types.ts";
import type { AiProvider, ProviderRequest, ProviderResponse } from "../types.ts";

// One adapter for every OpenAI-compatible chat-completions endpoint: NVIDIA's hosted API, a self-hosted NIM, or the DEV mock.
// All provider-specific knowledge lives here and in factory.ts - never in whatsapp-inbound or the worker.
export function openAiCompatible(name: string, baseUrl: string, apiKey: string, fetchImpl: typeof fetch = fetch, jsonMode = false, extraBody: Record<string, unknown> = {}): AiProvider {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    name,
    async chat(req: ProviderRequest): Promise<ProviderResponse> {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), req.timeoutMs);
      try {
        const resp = await fetchImpl(`${base}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          // extraBody carries provider-specific switches (e.g. turning a reasoning mode off); it can never override the core fields below
          body: JSON.stringify({
            ...extraBody,
            model: req.model,
            messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }],
            temperature: req.temperature,
            max_tokens: req.maxTokens,
            stream: false,
            ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
          }),
          signal: ctrl.signal,
        });
        if (!resp.ok) {
          const retryable = resp.status >= 500 || resp.status === 429 || resp.status === 408;
          // never include the response body: it may echo prompt content
          throw new SupportReplyError("provider_error", `provider HTTP ${resp.status}`, retryable);
        }
        // deno-lint-ignore no-explicit-any
        const j: any = await resp.json();
        const text = j?.choices?.[0]?.message?.content;
        if (typeof text !== "string" || !text.trim()) throw new SupportReplyError("bad_output", "provider returned no text");
        return { text, inputTokens: Number(j?.usage?.prompt_tokens ?? 0), outputTokens: Number(j?.usage?.completion_tokens ?? 0) };
      } catch (e) {
        if (e instanceof SupportReplyError) throw e;
        if ((e as Error)?.name === "AbortError") throw new SupportReplyError("timeout", `provider did not answer within ${req.timeoutMs} ms`, true);
        throw new SupportReplyError("provider_error", `network error: ${(e as Error)?.message ?? e}`, true);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
