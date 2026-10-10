// Dia Shoppe — daily Razorpay reconciliation. Compares what Razorpay says it captured/refunded in a window with our payments ledger.
// Called by pg_cron once a day (x-hook-secret = Vault hook_reconcile) or by an admin (their own JWT) with {"hours": 48}.
//
//   captured at Razorpay, missing from our ledger   -> (grace 10 min) replay it through settle_payment, the SAME atomic function the webhook
//                                                      uses (idempotent); an unmatched payment is reported as an ORPHAN
//   in our ledger (not legacy), not at Razorpay      -> critical finding
//   amount differs                                    -> critical finding
//   refunded at Razorpay, not tracked by us           -> recorded through settle_refund_event (alert; partial = critical, not recorded)
//   ledger says refunded, Razorpay shows no refund    -> critical finding
// The run and its findings are stored (reconciliation_runs); critical findings raise ops_events. It never refunds anything itself.
// {"dryRun": true}: report only. Nothing is healed or recorded except the run row and its alert (source "...-dry-run"); use it for the first run on a new
// environment and for checks against a real Razorpay account whose history our ledger does not fully contain.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, requireAdmin } from "../_shared/admin.ts";
import { constantTimeEqual } from "../_shared/meta-signature.ts";

const HOOK = Deno.env.get("RECONCILE_HOOK_SECRET");
const KEY_ID = Deno.env.get("RAZORPAY_KEY_ID");
const KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET");
const BASE = (Deno.env.get("RAZORPAY_API_BASE") || "https://api.razorpay.com").replace(/\/+$/, "");
const GRACE_MS = 10 * 60 * 1000;

type Finding = { code: string; severity: "info" | "warning" | "critical"; payment?: string; detail?: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const hook = req.headers.get("x-hook-secret");
  let source = "cron";
  if (!(hook && HOOK && constantTimeEqual(hook, HOOK))) {
    const a = await requireAdmin(req);
    if (!a.ok) return a.res;
    source = "admin";
  }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let hours = 48;
  let dryRun = false;
  try { const b = await req.json(); if (Number(b?.hours) > 0) hours = Math.min(Number(b.hours), 24 * 14); dryRun = b?.dryRun === true; } catch { /* default */ }
  if (dryRun) source = `${source}-dry-run`;
  const to = new Date(); const from = new Date(to.getTime() - hours * 3600_000);
  const findings: Finding[] = [];
  const fail = async (msg: string) => {
    const { data } = await sb.rpc("record_reconciliation_run", { p_from: from.toISOString(), p_to: to.toISOString(), p_rzp: null, p_ledger: null, p_findings: findings, p_error: msg, p_source: source });
    return jsonResponse({ ok: false, run: data, error: msg }, 502);
  };
  if (!KEY_ID || !KEY_SECRET) return await fail("Razorpay credentials are not configured");
  const auth = "Basic " + btoa(`${KEY_ID}:${KEY_SECRET}`);
  const rz = async (path: string) => {
    const r = await fetch(`${BASE}${path}`, { headers: { Authorization: auth } });
    if (!r.ok) throw new Error(`Razorpay ${path.split("?")[0]} -> HTTP ${r.status}`);
    return await r.json();
  };

  try {
    // 1. everything Razorpay captured (or captured-then-refunded) in the window
    // deno-lint-ignore no-explicit-any
    const remote: any[] = [];
    for (let skip = 0, page = 0; page < 40; page++, skip += 100) {
      const j = await rz(`/v1/payments?from=${Math.floor(from.getTime() / 1000)}&to=${Math.floor(to.getTime() / 1000)}&count=100&skip=${skip}`);
      const items = j.items ?? [];
      remote.push(...items);
      if (items.length < 100) break;
    }
    const captured = remote.filter((p) => p.status === "captured" || p.status === "refunded" || Number(p.amount_refunded ?? 0) > 0 && p.captured);
    const ids = captured.map((p) => p.id);

    // 2. our ledger for those ids, and our non-legacy rows in the window that Razorpay did not return
    const { data: ledger } = ids.length ? await sb.from("payments").select("id, razorpay_payment_id, amount, status, order_id, source").in("razorpay_payment_id", ids) : { data: [] };
    const byId = new Map((ledger ?? []).map((l: { razorpay_payment_id: string }) => [l.razorpay_payment_id, l]));
    const { data: ours } = await sb.from("payments").select("razorpay_payment_id, source, created_at").gte("created_at", from.toISOString()).neq("source", "legacy");
    for (const o of ours ?? []) {
      if (!ids.includes(o.razorpay_payment_id) && (o.source === "razorpay-webhook" || o.source === "verify-payment" || o.source === "reconcile")) {
        // it may simply be older than the window (a late webhook): ask Razorpay about this one payment before alarming anyone
        let known = false;
        try { const one = await rz(`/v1/payments/${o.razorpay_payment_id}`); known = one.status === "captured" || one.status === "refunded"; } catch { /* treated as unknown */ }
        if (!known) findings.push({ code: "ledger_not_at_razorpay", severity: "critical", payment: o.razorpay_payment_id, detail: "in our ledger but Razorpay does not show it as captured" });
      }
    }

    for (const p of captured) {
      const led = byId.get(p.id) as { id: number; amount: string; status: string } | undefined;
      const ageMs = Date.now() - Number(p.created_at) * 1000;
      if (!led) {
        if (ageMs < GRACE_MS) { findings.push({ code: "recent_payment_not_yet_recorded", severity: "info", payment: p.id }); continue; }
        if (dryRun) { findings.push({ code: "missing_payment_would_heal", severity: "critical", payment: p.id, detail: `captured at Razorpay, not in our ledger (Razorpay order ${p.order_id}); dry run: not settled` }); continue; }
        const { data: res, error } = await sb.rpc("settle_payment", { p_payment_id: p.id, p_rzp_order_id: p.order_id, p_amount_paise: p.amount, p_source: "reconcile", p_raw: p });
        if (error) { findings.push({ code: "heal_failed", severity: "critical", payment: p.id, detail: error.message }); continue; }
        const r = res?.result;
        findings.push(r === "orphan"
          ? { code: "orphan_payment", severity: "critical", payment: p.id, detail: "captured at Razorpay, matches no order" }
          : { code: "missing_payment_healed", severity: "warning", payment: p.id, detail: `webhook/verify missed it; settled now (${r})` });
        continue;
      }
      if (Math.round(Number(led.amount) * 100) !== Number(p.amount)) findings.push({ code: "amount_mismatch", severity: "critical", payment: p.id, detail: `ledger ${led.amount} vs Razorpay ${Number(p.amount) / 100}` });

      const refunded = Number(p.amount_refunded ?? 0);
      if (refunded > 0) {
        const { data: rr } = await sb.from("refund_requests").select("id").eq("payment_id", led.id).eq("status", "processed").limit(1);
        if (!rr?.length) {
          // refunded at Razorpay without us knowing: record each refund (alerts; a partial one is critical and not recorded)
          const rl = dryRun ? { items: [] } : await rz(`/v1/payments/${p.id}/refunds`);
          for (const f of rl.items ?? []) {
            await sb.rpc("settle_refund_event", { p_refund_id: f.id, p_payment_id: p.id, p_status: f.status ?? "processed", p_amount_paise: f.amount, p_rr_id: Number(f.notes?.refund_request_id) || null });
          }
          findings.push({ code: "refund_untracked", severity: "critical", payment: p.id, detail: `Razorpay shows ${refunded / 100} refunded that our refund requests did not record` });
        }
      } else if (led.status === "refunded") {
        findings.push({ code: "ledger_refunded_not_at_razorpay", severity: "critical", payment: p.id, detail: "our ledger says refunded; Razorpay shows no refund" });
      }
    }

    const { data: runId, error } = await sb.rpc("record_reconciliation_run", {
      p_from: from.toISOString(), p_to: to.toISOString(), p_rzp: captured.length, p_ledger: ledger?.length ?? 0, p_findings: findings, p_error: null, p_source: source });
    if (error) throw error;
    const critical = findings.filter((f) => f.severity === "critical").length;
    return jsonResponse({ ok: critical === 0, dryRun, run: runId, razorpay_captured: captured.length, ledger_matched: ledger?.length ?? 0, findings });
  } catch (e) {
    console.error("razorpay-reconcile error:", (e as Error).message);
    return await fail((e as Error).message);
  }
});
