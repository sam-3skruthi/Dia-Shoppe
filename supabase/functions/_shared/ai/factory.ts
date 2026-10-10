import { openAiCompatible } from "./providers/openai-compatible.ts";
import { SupportReplyError } from "./types.ts";
import type { AiProvider } from "./types.ts";

export type AiEnv = (k: string) => string | undefined;

// AI_PROVIDER: nvidia-hosted | nim-selfhosted | openai-compatible | mock | disabled (default: disabled)
//   AI_MODEL, AI_BASE_URL, AI_API_KEY as specified. A hosted NVIDIA endpoint needs no AI_BASE_URL (documented default below);
//   a self-hosted NIM and the mock always need one.
export function getProvider(env: AiEnv, fetchImpl: typeof fetch = fetch): { provider: AiProvider; model: string } {
  const kind = (env("AI_PROVIDER") || "disabled").toLowerCase();
  if (kind === "disabled") throw new SupportReplyError("disabled", "AI_PROVIDER is disabled");
  const model = env("AI_MODEL");
  const key = env("AI_API_KEY") || "none";
  const jsonMode = env("AI_JSON_MODE") === "1";
  let extra: Record<string, unknown> = {};
  if (env("AI_EXTRA_BODY")) {
    try { const j = JSON.parse(env("AI_EXTRA_BODY")!); if (j && typeof j === "object" && !Array.isArray(j)) extra = j; else throw new Error("not an object"); }
    catch { throw new SupportReplyError("disabled", "AI_EXTRA_BODY must be a JSON object"); }
  }
  if (!model) throw new SupportReplyError("disabled", "AI_MODEL is not set");
  if (kind === "nvidia-hosted") {
    return { provider: openAiCompatible(kind, env("AI_BASE_URL") || "https://integrate.api.nvidia.com/v1", key, fetchImpl, jsonMode, extra), model };
  }
  if (kind === "nim-selfhosted" || kind === "openai-compatible" || kind === "mock") {
    const base = env("AI_BASE_URL");
    if (!base) throw new SupportReplyError("disabled", `AI_BASE_URL is required for ${kind}`);
    return { provider: openAiCompatible(kind, base, key, fetchImpl, jsonMode, extra), model };
  }
  throw new SupportReplyError("disabled", `unknown AI_PROVIDER '${kind}'`);
}
