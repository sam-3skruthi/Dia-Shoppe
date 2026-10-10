# Backend final handoff checklist

Date: 2026-10-10. Frontend untouched and frozen for the first month. Production untouched (read-only inventory only: projects, functions, secret names, SELECT queries). **Production rollout: NO-GO** (section 13).
Legend: ☑ done and verified as stated · ◐ built and verified on DEV with mocks only · ☐ not done / needs an external action.

## 0. Results that need you (cannot be PASS until you act)
| Item | Result | What unblocks it |
|---|---|---|
| Real Meta webhook challenge | **NOT RUN** | `META_REAL_INTEGRATION_RUNBOOK.md` §6 Blocks A-B |
| X-Hub-Signature-256 over real bytes | **NOT RUN** | Block C (`p6` R4) |
| Real inbound + wamid persistence/dedup | **NOT RUN** | Block C (`p6` R3, R4) |
| Fast acknowledgement / async processing | **NOT RUN** | Block C (`p6` R3b, R3) |
| Real outbound reply / template | **NOT RUN** | Block C (`p6` R2, R3) |
| Real delivery and read callbacks | **NOT RUN** | Block C (`p6` R2) |
| Real Meta failure handling | **NOT RUN** | Block C (`p6` R5) |
| Nemotron evaluation (Nano, Lightning, Super) | **NOT RUN** (no key) | set `NVIDIA_API_KEY` yourself (command in `NEMOTRON_MODEL_RECOMMENDATION.md` §5) |
| Razorpay TEST: payment.failed, refund events, real reconciliation, partial refund, orphan | **NOT RUN** | `p7_razorpay_real_safety_dev.ps1` (TEST key + browser payments) |
| Courier provider verification | **NOT RUN** (no provider) | `COURIER_PROVIDER_REQUIREMENTS.md` §2 |
| Production social-webhook containment | **PREPARED, NOT APPLIED** (review package complete) | your approval of `PRODUCTION_SOCIAL_WEBHOOK_CONTAINMENT.md` §3-6 (commit first, then deploy) |
| Migration 042 + 034-041 in production | **NOT APPLIED** (DEV only) | backup, pg_cron, Vault, then your approval per migration |
| Operators for manual refund / held-order decisions | **NOT TRAINED** | `ADMIN_MANUAL_DECISIONS_RUNBOOK.md` |
| Production backup + restore test | **FAIL: no backup exists** (pitr off, 0 backups; checked 2026-10-10) | approve PostgreSQL 17 client tools install (or a plan with backups); you run `pg_dump` with the DB password; restore into a throwaway project you choose |
| Production pg_cron + Vault `project_url` | **FAIL** (checked 2026-10-10) | enable pg_cron in the dashboard; create `project_url` (needs your approval: production write) |
| Commits of this work | **NONE MADE** | approve the dependency-ordered plan C1-C7 (social C1 separate; C7 = the 9 handover documents, force-added) |

## 1. Implemented backend features
| Area | Feature | Where |
|---|---|---|
| Payments | ledger + one atomic settle path for browser callback, webhook and reconciliation | mig 034, `settle_payment`, `verify-payment`, `razorpay-webhook` |
| Payments | late payment after cancel -> automatic full refund; amount mismatch; duplicate payment; 30-min expiry; held orders when stock short | 034, 036 |
| Refunds | requests with admin approval where required; retry/backoff; stale recovery; customer notification once; gateway refusal alert | 034, 035, 038, `process-refund`, `refund-notify` |
| Refunds | **full refunds only** (DB trigger, process-refund equality check, outside-system partial = critical alert, reconciliation flag) | 040 |
| Gateway events | `payment.failed` recorded; `refund.created/processed/failed` reconciled | 040, `razorpay-webhook` |
| Reconciliation | daily comparison with Razorpay; auto-heal through `settle_payment`; **dry-run mode**; findings stored and alerted | 040, `razorpay-reconcile` |
| Audit / monitoring | hash-chained append-only audit; daily checkpoints; `ops_events`; `financial_health()` | 037, 040 |
| Courier | provider-neutral authenticated webhook, event ledger + dedup, mapping table (empty for real providers), atomic application, alerts | 041, `courier-webhook` |
| WhatsApp | signed webhook, wamid dedup, statuses, queue, single sender, template registry + sync, consent STOP/START, campaigns, order updates via queue | 039, `whatsapp-*` |
| AI | provider abstraction, server-built context, preflight, output validation, breaker, spend cap, rate limit, escalation, per-language gate (`AI_ENABLED_LOCALES`); **disabled** | `_shared/ai/*` |
| Social inbox | deferred; 503 unless explicitly enabled, then signed-only | `social-webhook`, `social-reply` |
| Admin safety (frozen UI) | order-status guard for direct API updates (on_hold / rto / cancelled final, pending -> cancelled only, nothing -> on_hold); manual SQL-editor procedures for refund and held-order decisions (named admin, note, row lock, idempotent, audited) | 042, `ADMIN_MANUAL_DECISIONS_RUNBOOK.md` |
| Tooling | infra-check, smoke-test (`-Only` filter), export-database, dev-reset-test-state, run-dev-regression, Meta real mode + round trip, Razorpay real safety script, eval harness + matrix | `supabase/scripts`, `supabase/tests` |

## 2. Tests and results
### A. Deterministic DEV suites (clean, verified start state)
Run on 2026-10-10 (14:25:56-14:46:49 IST) with `supabase/tests/run-dev-regression.ps1`, starting from a reset and **verified clean** DEV state (13 checks). **14 suites, 0 failed.**

| Suite | Result |
|---|---|
| unit (signatures, Meta payload shapes, sender, error classification, guardrails, preflight incl. hi/kn/te, locale gate, provider adapter, courier auth/keys) | **66 / 66** |
| SQL suites (p0 security, p0 stock, p1 financial, p2 audit, p2 stock invariant, p3 safety net + courier, **p8 status guard**) | **7 / 7 files** |
| p0 API checks (HTTP, real triggers, hook secrets, PostgREST exposure) | pass |
| p0 concurrency (parallel HTTP, row locks, signed duplicate webhooks) | pass |
| p0 auth (real customer + admin logins: RLS, roles, cost isolation) | pass |
| p1 financial end to end (mock Razorpay, real triggers) | pass |
| p2 failure/recovery (held orders, refund retry, notify once, audit intact) | pass |
| **p8 admin status guard (real admin API path, concurrent manual decisions)** | **45 / 45** |
| p5 safety net (webhook events, full-refund-only, reconciliation incl. dry run, courier e2e, social disabled, cron) | **43 / 43** |
| p4 WhatsApp (signature, dedup, statuses, queue, leases, consent, AI guardrails, campaigns, cron) | **149 / 149** |
| p4b campaign AI endpoint (real logins) | **8 / 8** |
| smoke test (unauthenticated/forged probes, mocks and social inbox not exposed) | **33 / 33** |
| infrastructure check, post phase | **0 FAIL**, 3 WARN (DEV mock secret, no backup, one pending order), 62 PASS |
| AI evaluation harness self-test (fake model) | 0 hard failures (describes the fake only) |

**Unsafe status transitions:** every one tested is blocked: 31 direct DB updates (admin + service_role) and 24 real-admin API PATCHes, with status, stock, line deduction, ledger and refund requests unchanged afterwards. With the guard removed, the suite fails (mutation check).

All of the above uses DEV mocks for Razorpay, Meta and the AI model; none of it is real-provider evidence.
### B. Real-provider tests (separate)
Razorpay TEST verified earlier (payment, refund once, automatic webhook delivery, duplicate-refund refusal, gateway-failure recording). Everything else in section 0 is NOT RUN.
### C. Production verification
None. Production is untouched.
### D. Stale-test issues
None this round. Two harness defects in the NEW p8 API script were fixed before the regression: `System.Net.Http` was not loaded, and Windows PowerShell 5.1 does not fill `ErrorDetails` for `Invoke-WebRequest`, so the error body is now read from the response stream. Neither was a product defect: the HTTP 400 refusals were correct throughout. Stale-test issues fixed in earlier rounds (partial-refund test, retired `whatsapp-notify` tests, refund residue, orphan-payment residue, Management API throttling, paused cron left by a dead run) remain fixed.

## 3. Status separation
| Category | Features |
|---|---|
| **Mock-tested (DEV)** | everything in section 1 |
| **DEV-deployed** | migrations 033-**042** and all 15 functions (+ two DEV-only mocks) on `lffnmycocbtpyvntccbg` |
| **Real-provider-tested** | Razorpay TEST: settlement, refund execution/recovery, automatic webhook delivery (earlier sessions). **Nothing else** |
| **Production-verified** | **nothing** from this backend work; production still runs the pre-033 backend (confirmed read-only 2026-10-10: no 033-042 markers, no pg_cron) |

Six-class view (1 implemented, 2 mock-tested, 3 DEV-deployed and verified, 4 real provider, 5 production, 6 not run or blocked): `BACKEND_FINAL_READINESS_REPORT.md` §3.

## 4. Security checklist
- ☑ Every webhook/hook rejects forged or unauthenticated calls (smoke test 33 probes; suites).
- ☑ Constant-time comparisons; missing secrets fail closed.
- ☑ Customer isolation (RLS with real logins); cost price unreachable; AI context only the sender's own data.
- ☑ Money/ops/WhatsApp/courier tables not readable/writable by `anon`/customers beyond admin RPCs/policies.
- ☑ Append-only audit + hash chain + daily checkpoints.
- ◐ Frozen admin UI cannot make unsafe status changes (042 guard, DEV only); manual decision procedures are not executable by any API role (DEV only).
- ☑ Social inbox cannot be reached unsigned (DEV); ☐ **production v7 still unsigned** until the approved containment is applied.
- ☐ Account-wide Supabase token: adopt separate identities + temporary rollout token.
- ☐ Off-system copy of the audit head.
- ☐ Revoke stray TRUNCATE/REFERENCES/TRIGGER grants for `anon`/`authenticated` (found on the social tables in production).
- ☐ AI guardrails are rules (residual risk measured only by a real evaluation).
- ☐ Legacy marketing opt-ins need provable evidence for Meta.
- ☐ Prefer HMAC over static token for the courier if the provider supports it.

## 5. Financial checklist
- ☑ One atomic, idempotent settlement path.
- ☑ Refund exactly once (unique active refund, per-attempt idempotency key, lookup ignores gateway-failed refunds, retries, stale recovery).
- ☑ Full-refund-only enforced in DB, process-refund, webhook (partial = alert only), reconciliation (untracked partial = critical), recovery (through process-refund).
- ☑ Late-payment, mismatch, duplicate, held, expiry, RTO verified (SQL + HTTP; real Razorpay TEST for settlement/refunds).
- ◐ payment.failed, refund events, reconciliation, orphan detection: DEV mock only; ☐ real TEST run `p7`.
- ◐ Dry-run reconciliation (use first in production).
- ◐ Held / mismatch / RTO orders cannot be shipped or reopened from the admin dropdown (042, DEV); refund and held-order decisions via `ADMIN_MANUAL_DECISIONS_RUNBOOK.md`.
- ☐ Alerts reach a person (rows only today).
- ☐ Production backup before any change. After the first real payment: roll forward only.

## 6. Production configuration
| Item | Required state |
|---|---|
| Extensions | `pg_cron` (**missing on production**), `pg_net`, `supabase_vault` |
| Vault | `project_url` (**missing on production**); `hook_*` created by migrations |
| Migrations | 033 -> **042** in order, one at a time (042 mandatory while the admin UI is frozen) |
| Cron (8) | expire-pending-orders, requeue-stuck-refunds, cancel-empty-orders, retry-failed-refunds, whatsapp-worker, whatsapp-sync-templates, razorpay-reconcile, audit-verify |
| Functions (15, `--no-verify-jwt`) | refund-notify, process-refund, razorpay-webhook, razorpay-reconcile, verify-payment, create-razorpay-order, courier-webhook, order-email, whatsapp-inbound, whatsapp-worker, whatsapp-sync-templates, whatsapp-campaign, whatsapp-remind, social-webhook (disabled), social-reply (disabled); delete whatsapp-notify, whatsapp-broadcast; **no mocks** |
| Razorpay LIVE webhook | add `payment.failed`, `refund.created`, `refund.processed`, `refund.failed` to `payment.captured`, `order.paid`; secret hash-verified |
| Meta | only after the DEV round trip passes |
| Order | `PRODUCTION_INFRASTRUCTURE_READINESS.md` §3 |

## 7. Secrets checklist
☐ `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` (LIVE, exist) · ☐ `RAZORPAY_WEBHOOK_SECRET` (= dashboard) · ☐ `REFUND_HOOK_SECRET`, `REFUND_NOTIFY_HOOK_SECRET`, `ORDER_EMAIL_HOOK_SECRET`, `RECONCILE_HOOK_SECRET`, `WHATSAPP_WORKER_SECRET` (copied from Vault, digest-verified) · ☐ `RESEND_API_KEY`, `EMAIL_FROM` · ☐ `META_APP_SECRET_WHATSAPP`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_TOKEN` (permanent), `WHATSAPP_PHONE_ID`, `WHATSAPP_WABA_ID` · ☐ `STORE_URL`, `STORE_PHONES`, `STORE_EMAILS` · ☐ courier secrets after provider choice.
**Must be absent in production:** `RAZORPAY_API_BASE` (or exactly `https://api.razorpay.com`), `RESEND_API_BASE`, `WHATSAPP_API_BASE`, `WHATSAPP_CAPTURE_PAYLOADS`, `AI_*`, `SOCIAL_INBOX_ENABLED`, `META_APP_SECRET_SOCIAL`.

## 8. Monitoring checklist
Daily (14 days): ☐ refund requests in `requested` and `on_hold` orders (runbook §2) · ☐ `financial_health()` · ☐ last reconciliation + findings · ☐ open `ops_events` (critical same day) · ☐ Edge-log bursts of 400/401 on the webhooks. Weekly: ☐ audit head vs `audit_anchors` · ☐ template status, WhatsApp queue depth/failures · ☐ `infra-check -Phase post` and `smoke-test`.

## 9. Deferred features
Instagram/Facebook inbox · advanced analytics · AI replies until an approved evaluation and production terms · partial refunds · provider-specific courier automation · alert push notifications · retention/anonymisation job · WhatsApp media handling beyond human handoff · native review of hi/kn/te fixed texts · support-policy text.

## 10. Frontend contracts (implement only after the backend freeze)
**Order statuses:** add `on_hold` and `rto` wherever statuses are listed (admin badges/filters/tiles, customer order pages); exclude `on_hold`, `rto`, `cancelled` from revenue/spend sets. Customer wording: `on_hold` "payment received, checking stock"; `rto` "returned to us, any refund is being reviewed".
**Payment flow (`verify-payment`):** `success:true` (also with `alreadyProcessed:true`, optionally `code:"DUPLICATE_PAYMENT_REFUND_INITIATED"`) = paid. `success:false` with `code` `ORDER_CANCELLED_REFUND_INITIATED`, `PAYMENT_UNDER_REVIEW`, `PAYMENT_HELD_OUT_OF_STOCK` = show `error` as information; **do not offer to pay again, do not restore the cart**. `create-razorpay-order` refuses non-pending orders (show "this order has expired, please place it again").
**Admin RPCs (admin's own session):** `approve_refund(p_request_id)`, `reject_refund(p_request_id, p_note)`, `fulfil_held_order(p_order_id)`, `refund_held_order(p_order_id)`, `audit_chain_status()`, `financial_health()`, `set_courier_mapping(p_provider, p_raw, p_event, p_note)`, `wa_create_campaign(p_name, p_template, p_language, p_audience, p_image_url)`, `wa_set_campaign_variables(p_id, p_variables)`, `wa_approve_campaign(p_id)`, `wa_cancel_campaign(p_id)`, `wa_resume_queue()`.
**Admin read-only (RLS admin only):** `refund_requests`, `payments`, `financial_audit`, `ops_events` (open = `resolved_at is null`), `reconciliation_runs`, `payment_failures`, `refund_events`, `audit_anchors`, `courier_events`, `courier_status_map`, `whatsapp_message_log` (`delivery_state`), `whatsapp_campaigns`, `whatsapp_campaign_stats`, `whatsapp_templates`, `whatsapp_consent`, `whatsapp_consent_history`, `ai_usage_daily`.
**Admin screens:** refund queue (approve/reject, failed + error); held orders (fulfil/refund); alerts panel; financial-health tile (stale flags); reconciliation history (incl. a dry-run button); audit status; RTO action for shipped orders; courier mapping editor + unmapped alerts; WhatsApp log, template registry, queue-paused banner + resume, needs-a-person inbox, campaign screen (create, AI suggestions, edit wording, approve, cancel, stats). The admin Social page should show "inbox disabled" (endpoints answer 503).
**Edge functions called by the frontend:** `whatsapp-campaign` `{action:"generate_copy", campaign_id, brief, variable?}` -> `{ok, variable, suggestions[]}` or 503; `whatsapp-remind` `{user_id}` -> `{queued:true}` or `{queued:false, skipped:true, reason}`; `razorpay-reconcile` (admin JWT) `{hours?, dryRun?}` -> `{ok, dryRun, run, findings[]}`. `whatsapp-broadcast` / `whatsapp-notify` no longer exist; `social-reply` answers 503.
**Frozen period:** a status change refused by 042 returns HTTP 400 `ORDER_STATUS_BLOCKED: ...` (AdminOrders already shows it). The post-freeze UI should call the admin RPCs above instead of PATCHing status for held / RTO / mismatch orders.
**Storefront:** keep the separate marketing opt-in checkbox; mention replying STOP unsubscribes.
**Never** write `payments`, `refund_requests`, `financial_audit`, `ops_events`, WhatsApp or courier tables, or call `settle_payment` / `wa_enqueue` / `courier_apply_event` from the frontend.

## 11. Known limitations
No production backup · alerts are rows only · the frozen admin UI cannot show on_hold / rto / awaiting-approval states, so decisions go through the SQL runbook · rejecting a mismatch refund before expiry is undone by the expiry auto-refund (read from the code; untested) · WhatsApp never exercised against real Meta (error-code classification and the `biz_opaque_callback_data` echo are assumptions) · no approved AI model; Kannada/Telugu unsupported on every Nemotron card, Hindi unproven; AI answers only `AI_ENABLED_LOCALES` (default English) · no courier provider, so no automatic status changes · reconciliation window ≤ 14 days; auto-heal can trigger the designed late-payment refund (use dry run first) · payments after the 30-min expiry are refunded · preflight/validator are rules · customers can read their own WhatsApp rows · append-only tables mean suites assert deltas · Management API throttles bursts (test calls retry).

## 12. Rollback / recovery
- Before the first real payment through the new tables: restore replaced functions/triggers from the export's `definitions/*.sql`, `cron.unschedule` new jobs, redeploy the tagged previous function sources; new empty tables may be dropped.
- After the first real payment: **roll forward only**; never drop `payments`, `refund_requests`, `financial_audit`.
- Emergency stops: refunds (`status='rejected'` for requested/approved + unschedule `retry-failed-refunds`); WhatsApp (`wa_pause_queue`, `wa_cancel_campaign`); AI (unset `AI_PROVIDER`); courier (unset `COURIER_PROVIDER`); social (already disabled).
- Data: export JSONL + `pg_dump` (partial by design); Razorpay refunds and Meta messages cannot be recalled.
- Social containment rollback: `PRODUCTION_SOCIAL_WEBHOOK_CONTAINMENT.md` §6, `social-rollback-to-stub.ps1`, which deploys fixed 503 stubs. Redeploying the old unsigned v7 code is not a supported rollback.
- 042 rollback: `DROP TRIGGER trg_orders_status_guard ON public.orders;` (re-opens the frozen-UI gap). The manual functions can stay; they are unreachable from the API.

## 13. Production status: NO-GO
Blocking (re-checked read-only 2026-10-10: infra-check pre = 3 FAIL): migration 042 shipped together with 034-041 (frozen admin UI); production backup (none exists; no local pg_dump); `pg_cron` + Vault `project_url`; approved social containment; real Razorpay TEST `p7`; real Meta `p6` (for WhatsApp); secrets; frontend contract; daily alert ownership; rollout token strategy.

## Document index
**Handover package (repository root, committed in C7):** `BACKEND_FINAL_READINESS_REPORT.md` · `BACKEND_FINAL_HANDOFF_CHECKLIST.md` · `PRODUCTION_INFRASTRUCTURE_READINESS.md` · `PRODUCTION_FINANCIAL_ROLLOUT_PLAN.md` · `PRODUCTION_SOCIAL_WEBHOOK_CONTAINMENT.md` · `ADMIN_MANUAL_DECISIONS_RUNBOOK.md` · `META_REAL_INTEGRATION_RUNBOOK.md` · `NEMOTRON_MODEL_RECOMMENDATION.md` · `COURIER_PROVIDER_REQUIREMENTS.md`. Referenced but not in the package (local notes): `P1_WHATSAPP_IMPLEMENTATION.md` · `WHATSAPP_TEST_PLAN.md` · `AI_ARCHITECTURE.md`.
