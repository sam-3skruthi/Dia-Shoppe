// Runs the 186-case evaluation for several exact deployment configurations and writes one comparison table.
//   node supabase/tests/ai-eval/run-eval-matrix.mjs supabase/tests/ai-eval/candidates.json [--rpm 30]
// candidates.json (NO keys inside; each entry names the environment variable that holds its key):
//   [ { "name": "nano-via-<provider>", "provider": "openai-compatible", "baseUrl": "https://.../v1", "model": "<exact id>", "keyEnv": "PROVIDER_KEY",
//       "extraBody": { "chat_template_kwargs": { "enable_thinking": false } }, "priceInPerMtok": 0.05, "priceOutPerMtok": 0.20 } ]
// Output: results/matrix-<timestamp>.md plus the per-model JSON files. Nothing secret is printed or written.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const cfgPath = process.argv[2];
if (!cfgPath) { console.error("usage: run-eval-matrix.mjs candidates.json [--rpm N]"); process.exit(2); }
const rpm = process.argv.includes("--rpm") ? process.argv[process.argv.indexOf("--rpm") + 1] : "30";
const cands = JSON.parse(readFileSync(cfgPath, "utf8"));
const here = fileURLToPath(new URL(".", import.meta.url)); mkdirSync(here + "results", { recursive: true });
const rows = [];
for (const c of cands) {
  const key = c.keyEnv ? process.env[c.keyEnv] : "none";
  if (c.keyEnv && !key) { rows.push({ name: c.name, error: `environment variable ${c.keyEnv} is not set` }); continue; }
  const env = { ...process.env, AI_PROVIDER: c.provider, AI_MODEL: c.model, AI_API_KEY: key, AI_BASE_URL: c.baseUrl ?? "",
    AI_EXTRA_BODY: c.extraBody ? JSON.stringify(c.extraBody) : "", AI_PRICE_IN_PER_MTOK: String(c.priceInPerMtok ?? 0), AI_PRICE_OUT_PER_MTOK: String(c.priceOutPerMtok ?? 0) };
  console.log(`== ${c.name} (${c.model})`);
  const r = spawnSync(process.execPath, [here + "run-eval.mjs", "--rpm", rpm], { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const m = /\{\s*"model"[\s\S]*?\n\}/.exec(r.stdout ?? "");
  if (!m) { rows.push({ name: c.name, error: (r.stderr || r.stdout || "no output").slice(0, 200) }); continue; }
  rows.push({ name: c.name, model: c.model, s: JSON.parse(m[0]) });
}
const L = ["# Evaluation matrix (generated)", "", `Generated ${new Date().toISOString()} from ${cfgPath}. Same 186 cases, same production answer path, for each configuration.`, "",
  "| Configuration | Pass % | Hard failures | Escalation % | Model answered % | hi / kn / te pass | Lang. mismatch | p95 latency ms | Reply >400 chars % | Tokens in/out | USD per 1,000 msgs |", "|---|---|---|---|---|---|---|---|---|---|---|"];
for (const r of rows) {
  if (r.error) { L.push(`| ${r.name} | NOT RUN: ${r.error} | | | | | | | | | |`); continue; }
  const s = r.s, bl = s.by_locale;
  L.push(`| ${r.name} (${r.model}) | ${s.pass_rate_pct} | **${s.hard_failures}** | ${s.escalation_accuracy_pct} | ${s.model_answered_pct} | ${bl.hi ?? "-"} / ${bl.kn ?? "-"} / ${bl.te ?? "-"} | ${s.language_mismatch} | ${s.latency_ms.p95} | ${s.reply_length_chars.over_400_pct} | ${s.tokens.input}/${s.tokens.output} | ${s.cost_usd_per_1000_messages} |`);
}
L.push("", "Acceptance rules are in NEMOTRON_MODEL_RECOMMENDATION.md section 6. Any hard failure disqualifies a configuration.");
const out = here + `results/matrix-${Date.now()}.md`;
writeFileSync(out, L.join("\n") + "\n");
console.log(L.join("\n")); console.log("written:", out);
