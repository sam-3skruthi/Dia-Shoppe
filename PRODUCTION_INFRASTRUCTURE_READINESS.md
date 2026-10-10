# Production infrastructure readiness (prepared, NOT executed; rollout status: NO-GO)

Nothing here has been run against production. Production facts below come from read-only queries made on 2026-10-05 and must be re-read immediately before any rollout (`infra-check.ps1 -Phase pre`). Builds on `PRODUCTION_FINANCIAL_ROLLOUT_PLAN.md`; this file replaces its migration list (now **033-042**; 042 added 2026-10-10) and function list (now 15). Production facts re-read on 2026-10-10: see `BACKEND_FINAL_READINESS_REPORT.md` §2 and §8.

## 0. Tools that now exist (all read-only against the database)
| Tool | Purpose |
|---|---|
| `supabase/scripts/infra-check.ps1 -Ref <ref> -Phase pre|post` | extensions, Vault entries, which migrations are present, cron jobs, functions (deployed, `verify_jwt`), secret **names**, backups, pending online orders, open alerts. FAIL/WARN/PASS/INFO, exit 1 on FAIL. Rehearsed on DEV (post phase: all in place; the only failure was test-generated alerts, which the regression closes) |
| `supabase/scripts/export-database.ps1 -Ref <ref> -OutDir <new folder>` | logical export of every public table (JSONL) plus function/trigger/constraint/policy definitions, with SHA-256 manifest. Validated on DEV (32 tables, 1,493 rows). **Not** a one-command restore (no auth users, storage, secret values, function source); the real restore point is a `pg_dump` with the DB password (command in the script header) |
| `supabase/scripts/smoke-test.ps1 -Ref <ref>` | **non-destructive** HTTP probes of every public endpoint with missing/forged credentials (33 probes): webhooks reject forged calls, hooks reject callers without the secret, the social inbox answers 503, retired functions and DEV mocks do not answer, anonymous users read nothing of the money/ops/WhatsApp tables. Safe to run on production after a rollout; it cannot prove the *accept* path (that is the manual live order). Against today's production it would fail on the unsigned social webhook, which is the point |
| `supabase/scripts/dev-reset-test-state.ps1 -Ref <dev-ref>` | DEV only: restores a verified clean test state before the regression (refuses a non-DEV project) |
| `supabase/tests/run-dev-regression.ps1` | complete DEV regression: starts with the reset above, runs every deterministic suite and the smoke test, lists real-provider tests and production verification separately |

## 1. Known production state (read-only, 2026-10-05)
| Fact | Consequence |
|---|---|
| `pg_cron` available, **not installed**; no `cron` schema | install it first, else every cron block in the migrations only WARNS and no job exists |
| Vault has **no `project_url`** | create it before 033, else every trigger-driven call silently does nothing |
| No `schema_migrations` table (migrations were applied by hand) | keep a manual rollout log of what was applied when |
| Backups: none listed, PITR off | manual export + `pg_dump` mandatory before touching anything |
| 11 orders, 0 pending online | no in-flight payment at the moment; re-check at rollout time |
| ~~`social-webhook` v7 is deployed with no POST signature check~~ | **resolved 2026-10-10**: v8 / `social-reply` v9 answer 503 (see §2) |
| Functions deployed: create-razorpay-order, verify-payment, razorpay-webhook, process-refund, courier-webhook, order-email, whatsapp-notify/inbound/remind/broadcast, assistant, social-reply, social-webhook (13); **not** deployed: refund-notify, whatsapp-worker, whatsapp-sync-templates, whatsapp-campaign, razorpay-reconcile | first deployment of five functions |

## 2. Immediate item: the unsigned production social webhook (RESOLVED 2026-10-10: containment deployed and verified, see `PRODUCTION_SOCIAL_WEBHOOK_CONTAINMENT.md` §7)
**Status 2026-10-10: resolved.** The containment was deployed from commit `ed98662` and verified (`PRODUCTION_SOCIAL_WEBHOOK_CONTAINMENT.md` §7). The text below is kept as the decision record.

**Update 2026-10-09:** read-only inspection confirmed v7 has no signature check; 0 stored messages; no Meta traffic in 7 days; nothing live depends on it. The exact change, DEV validation and verification are in `PRODUCTION_SOCIAL_WEBHOOK_CONTAINMENT.md`, awaiting your approval.
The repo is now safe: `social-webhook` and `social-reply` answer 503 unless `SOCIAL_INBOX_ENABLED=1` **and** a Meta app secret is set, and then require a valid `X-Hub-Signature-256`. **Production still runs the old version (v7, unsigned POST)** because you asked me not to modify production. Pick one, using a temporary production-write credential (see the credential section of the earlier plan), whenever you choose, independent of the rest of the rollout:
- **Disable now (smallest change):** `supabase functions delete social-webhook --project-ref vkcwfwgxelmamuydwrow` (and `social-reply`). Nothing in production reads `social_messages` yet; Meta's webhook for it was never confirmed as configured.
- **or deploy the hardened version** with the flag unset: `supabase functions deploy social-webhook social-reply --project-ref vkcwfwgxelmamuydwrow --no-verify-jwt`; they then answer 503.
Instagram/Facebook inbox is **deferred (P2)**: before enabling it, it needs a signed-payload test against real Meta traffic, the `social_accounts` handling, and the reply function must stop marking messages "replied" when the Graph post failed.

## 3. Order of operations (each step verified before the next; stop on the first failure)
| # | Step | Verify |
|---|---|---|
| 1 | Create the temporary rollout token; run `infra-check.ps1 -Phase pre` | FAIL lines are exactly the known gaps (pg_cron, project_url, backup) |
| 2 | **Backup:** `export-database.ps1`; `pg_dump`; save function sources; store off-machine; re-read one table | manifest row counts match; dump lists |
| 3 | Enable `pg_cron`; `select vault.create_secret('https://vkcwfwgxelmamuydwrow.supabase.co','project_url')` | `infra-check` shows both PASS |
| 4 | Migrations in order **033, 034, 035, 036, 037, 038, 039, 040, 041, 042**, each alone, stop on error. **042 (admin status guard) is mandatory while the admin frontend is frozen**: without it the existing Orders dropdown can ship held / amount-mismatch / RTO orders without taking stock (DEV finding 2026-10-10). Operators use `ADMIN_MANUAL_DECISIONS_RUNBOOK.md` for refund and held-order decisions | per migration: marker line in `infra-check` and the check listed in the financial plan |
| 5 | After 038/039/040 read the Vault hook secrets and copy them to function secrets **without printing** (same pattern as `dev-bootstrap.ps1`): `REFUND_HOOK_SECRET`, `REFUND_NOTIFY_HOOK_SECRET`, `ORDER_EMAIL_HOOK_SECRET`, `RECONCILE_HOOK_SECRET`, `WHATSAPP_WORKER_SECRET` (= Vault `hook_whatsapp_worker`) | digests equal (the Supabase secrets API returns SHA-256 digests) |
| 6 | Set the remaining secrets (§4); confirm the forbidden ones are absent | `infra-check`: secret lines PASS, no mock/base-override secrets |
| 7 | Deploy functions, all with `--no-verify-jwt`: `refund-notify`, `process-refund`, `razorpay-webhook`, `razorpay-reconcile`, `verify-payment`, `create-razorpay-order`, `courier-webhook`, `order-email`, `whatsapp-inbound`, `whatsapp-worker`, `whatsapp-sync-templates`, `whatsapp-campaign`, `whatsapp-remind`, `social-webhook`, `social-reply` (the last two ship disabled). Then delete `whatsapp-notify`, `whatsapp-broadcast` (their callers are gone) | `infra-check -Phase post`: every function PASS, no mocks |
| 8 | Razorpay LIVE dashboard: webhook to `.../razorpay-webhook` with events `payment.captured`, `order.paid`, **and now `payment.failed`, `refund.created`, `refund.processed`, `refund.failed`**; the secret equals `RAZORPAY_WEBHOOK_SECRET` (hash-compare script) | send a test from the dashboard; Edge logs show 200 |
| 9 | Meta (live) only after the DEV round trip has passed: callback URL, verify token, `messages` field, templates approved, `whatsapp-sync-templates` run | registry shows approved; real round trip on the live number with your own phone |
| 10 | Courier: choose the provider, read its documentation, fill `courier_status_map` for its exact wording (admin RPC `set_courier_mapping`), set `COURIER_PROVIDER`, the auth secret(s), register the webhook, send the provider's own test event | `courier_events` shows the event mapped, not "unmapped" |
| 11 | Run reconciliation first as a **dry run** (`razorpay-reconcile` with the hook secret, `{"hours":336,"dryRun":true}`: reports, heals nothing), review every finding, then once for real with `{"hours":168}`, save the audit head (`select private.audit_verify_job()`; store `head_seq`/`head_hash` off-system) | run row `ok=true`, no critical findings, anchor stored |
| 12 | One real low-value LIVE order, then refund it | ledger row, order confirmed, stock once, 2 audit rows, refund processed once, notification email, `financial_health()` clean |
| 12b | `smoke-test.ps1 -Ref vkcwfwgxelmamuydwrow` and `infra-check.ps1 -Phase post` | 0 failed probes; 0 FAIL |
| 13 | Revoke the rollout token; start hypercare (§6) | token gone from the dashboard |

## 4. Production function secrets
| Secret | Used by | Source / rule |
|---|---|---|
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | create-razorpay-order, verify-payment, process-refund, razorpay-reconcile | LIVE keys, already set; not changed by the rollout |
| `RAZORPAY_WEBHOOK_SECRET` | razorpay-webhook | equals the LIVE dashboard webhook secret; letters/digits/`_`/`-` only |
| `RAZORPAY_API_BASE` | process-refund, reconcile | **unset** (or exactly `https://api.razorpay.com`) |
| `REFUND_HOOK_SECRET`, `REFUND_NOTIFY_HOOK_SECRET`, `ORDER_EMAIL_HOOK_SECRET`, `RECONCILE_HOOK_SECRET`, `WHATSAPP_WORKER_SECRET` | the functions the DB/cron calls | copied from the Vault `hook_*` values |
| `RESEND_API_KEY`, `EMAIL_FROM` | order-email, refund-notify | exist; `RESEND_API_BASE` unset |
| `META_APP_SECRET_WHATSAPP`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_TOKEN` (permanent), `WHATSAPP_PHONE_ID`, `WHATSAPP_WABA_ID` | WhatsApp functions | from Meta (real); `WHATSAPP_API_BASE` and `WHATSAPP_CAPTURE_PAYLOADS` **must not exist** |
| `STORE_URL`, `STORE_PHONES`, `STORE_EMAILS` | AI guardrail allow-lists | the real storefront values |
| `COURIER_PROVIDER`, `COURIER_AUTH_MODE`, `COURIER_WEBHOOK_TOKEN` or `COURIER_WEBHOOK_SECRET` (+ `COURIER_SIGNATURE_*`) | courier-webhook | provider-specific, after §3 step 10 |
| `AI_*` | worker | **unset** (AI disabled) until a model is approved |
| `SOCIAL_INBOX_ENABLED` | social functions | **unset** |
| `COURIER_*`, `META_*` values | never | never in Vault, git or logs |

## 5. Scheduled jobs expected after the rollout (8)
`expire-pending-orders` (*/5), `requeue-stuck-refunds` (*/10), `cancel-empty-orders` (*/10), `retry-failed-refunds` (*/5), `whatsapp-worker` (every minute), `whatsapp-sync-templates` (02:00 UTC), `razorpay-reconcile` (03:00 UTC), `audit-verify` (03:30 UTC). `infra-check -Phase post` verifies all eight are active.

## 6. Monitoring (hypercare 14 days, then lighter)
| Cadence | Check | Where |
|---|---|---|
| every day | `financial_health()` (admin RPC): open critical/warning events by code, refunds awaiting approval/failed/stuck, pending online orders over 30 min, held orders, payment failures, last reconciliation (flags stale after 36 h), last audit check (flags stale) | SQL or the future admin screen |
| every day | the reconciliation run result and its findings (`reconciliation_runs`) | SQL |
| every day | `ops_events` open items; critical ones need action the same day | SQL/admin screen |
| weekly | compare the saved audit head with `audit_anchors` / `audit_chain_status()`; Meta template statuses; WhatsApp queue depth and failed rate | SQL |
| always | Edge Function logs for 4xx/5xx on the webhooks (a burst of 400 on razorpay-webhook or whatsapp-inbound = secret mismatch) | Supabase logs |
Alert codes you will see: `orphan_payment`, `amount_mismatch`, `insufficient_stock`, `refund_needs_approval`, `refund_failed`, `refund_retries_exhausted`, `refund_stalled`, `refund_failed_at_gateway`, `refund_outside_system`, `partial_refund_outside_system`, `reconcile_discrepancy`, `reconcile_run_failed`, `audit_chain_broken`, `courier_status_unmapped`, `courier_conflict`, `courier_shipment_cancelled`, `courier_reference_mismatch`, `whatsapp_send_failed`, `whatsapp_delivery_failed`, `whatsapp_queue_paused`, `whatsapp_job_failed`, `whatsapp_needs_human`, `whatsapp_template_mismatch`. **Nothing pushes these to a person yet** (no email/WhatsApp alert); until that exists a person must look daily.

## 7. Rollback limitations (be clear before starting)
- Migrations are additive but **cannot be undone once real payments flow through them**: dropping the ledger/audit tables would destroy financial history. After the first real payment the only path is **roll forward** (disable behaviour, fix, redeploy).
- Before the first real payment: restore replaced functions/triggers from `definitions/*.sql` of the export, `cron.unschedule` the new jobs, redeploy old function sources (the git tag), and the new empty tables may be dropped.
- Database restore from the export is partial by design (no auth users); a true restore needs the `pg_dump`. Orders placed after the dump would be lost unless re-entered: decide in advance.
- Razorpay money moved cannot be rolled back by us; refunds are one-way. The full-refund-only rule, the idempotency keys and the reconciliation exist because of this.
- Meta messages sent cannot be recalled; the pause switch (`wa_pause_queue`) and campaign cancel stop only what is still queued.

## 8. Things that are **not** ready for production (see the final report for the full list)
No admin UI for approvals/alerts (frontend), real-Meta round trip not yet run, no courier provider chosen, no AI model approved, no alert push, no backup in place yet, social inbox deferred, DB-owner-level audit tamper protection still needs an off-system anchor.
