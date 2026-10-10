# Backend final readiness report

Date: 2026-10-10. Backend only. **Frontend untouched (frozen for the first month).** Production: **one approved change only**, the social-webhook containment (C1, `ed98662`) deployed and verified on 2026-10-10 (section 5). Everything else in production was read-only.
**Production rollout: NO-GO** until the prerequisites in section 6 are met. Apart from the social-webhook containment (section 5), nothing in this report is production evidence.

## 1. Release gate found and fixed this round (DEV only)
**Finding (DEV probe, as a real admin role):** with migrations 034-041, the frozen admin Orders dropdown (a direct `PATCH orders.status`) could move:
- an **on_hold** order (paid, stock short) to confirmed / shipped / delivered **without taking stock**;
- an **amount-mismatch** (pending) order to confirmed / shipped **without taking stock or settling the payment**;
- an **rto** order to delivered / cancelled, leaving its refund request open.

In every case the refund request stayed `requested`, and the frozen UI has no way to approve or reject it. That was a release-gate failure for deploying 034-041 with the frozen frontend.

**Fix: migration `042_admin_status_guard.sql`, applied to DEV only (approved for DEV).**
- **Guard:** a BEFORE UPDATE trigger that applies to direct updates by `anon`, `authenticated` and `service_role`:
  - `on_hold`, `rto` and `cancelled` are final;
  - `pending` can only become `cancelled`;
  - nothing can become `on_hold`.
  - The approved SECURITY DEFINER workflows (settlement, held-order fulfil/refund, courier, expiry jobs) run as the owner and are not affected.
- **Manual procedures:** `private.manual_refund_decision` and `private.manual_held_order_decision`, run only from the SQL editor. They require a named active admin and a note, lock the row, act through the same admin functions (so `approved_by` and the audit actor are that admin), write an extra `manual_decision` audit row, and are idempotent (`already_*`). They are not executable by `PUBLIC`, `anon`, `authenticated` or `service_role`, and not reachable over the API (HTTP 404).
- **Operator guide:** `ADMIN_MANUAL_DECISIONS_RUNBOOK.md`.

**Result: every unsafe transition tested is blocked**:
- **31** direct database updates (admin role and service_role) in `p8_admin_status_guard.sql`;
- **24** real-admin-login API PATCHes in `p8_admin_status_guard_dev.ps1`.

Afterwards the order status, stock, per-line deduction, payment ledger and refund requests were unchanged.

**Proof the test detects the gap:** with the guard dropped inside a rolled-back transaction, the SQL suite fails at `FAIL G1: admin moved a HELD order to pending`.

**Legitimate workflows still work (tested):**
- payment settlement confirming a pending order, as service_role;
- admin ship / deliver of paid orders and COD orders;
- admin cancel: refund auto-approved and **processed** via the mock, stock returned once;
- admin cancel of unpaid and mismatch orders;
- customer cancel;
- courier RTO;
- the 30-minute expiry job;
- `fulfil_held_order` / `refund_held_order` from an admin login;
- manual fulfil / refund / approve / reject with idempotent repeats;
- two concurrent manual decisions: one `rejected`, one `already_rejected`, exactly one audit entry.

**Still not covered:**
- The admin screen still cannot *display* `on_hold`, `rto` or `awaiting_approval` / `rejected` refund states. Decisions are made through the SQL runbook until the post-freeze UI work.
- Rejecting an amount-mismatch refund before the order expires is undone by the expiry job's automatic refund. I read this from the code; it is not tested. The runbook says to decide after expiry.

## 2. Confirmed project refs and inventory (read-only, 2026-10-10 ~14:26 IST, before the C1 deploy; since 19:34 IST production runs `social-webhook` v8 and `social-reply` v9, everything else as listed)
| | PRODUCTION | DEV |
|---|---|---|
| Ref / name / region | `vkcwfwgxelmamuydwrow` "Dia Shoppe", ap-southeast-2, ACTIVE_HEALTHY (frontend `.env` points here) | `lffnmycocbtpyvntccbg` "Dia Shoppe DEV", ap-south-1, ACTIVE_HEALTHY |
| Migrations 033-042 (schema markers; `supabase_migrations.schema_migrations` not present on either) | **none present** (orders status set has no `rto`/`on_hold`) | **all present (033-042)** |
| Extensions | pg_net 0.20.3, pgcrypto, supabase_vault; **no pg_cron** | pg_cron 1.6.4, pg_net 0.20.4, pgcrypto, supabase_vault |
| Cron jobs | none (pg_cron not installed) | 8 active: audit-verify, cancel-empty-orders, expire-pending-orders, razorpay-reconcile, requeue-stuck-refunds, retry-failed-refunds, whatsapp-sync-templates, whatsapp-worker |
| Functions (all ACTIVE, `verify_jwt=false`) | assistant v8, courier-webhook v4, create-razorpay-order v14, order-email v5, process-refund v4, razorpay-webhook v15, social-reply v8, social-webhook v7, verify-payment v17, whatsapp-broadcast v8, whatsapp-inbound v10, whatsapp-notify v12, whatsapp-remind v8 | assistant v23, courier-webhook v26, create-razorpay-order v23, order-email v23, process-refund v27, razorpay-mock v28 (DEV only), razorpay-reconcile v9, razorpay-webhook v26, refund-notify v17, social-reply v26, social-webhook v26, verify-payment v23, whatsapp-campaign v16, whatsapp-inbound v29, whatsapp-mock v16 (DEV only), whatsapp-remind v29, whatsapp-sync-templates v16, whatsapp-worker v16 |

Production secret names (values never read) include `SOCIAL_VERIFY_TOKEN`. `SOCIAL_INBOX_ENABLED`, `META_APP_SECRET_SOCIAL` and `META_PAGE_TOKEN` are absent. Evidence: `GET /v1/projects`, `GET /v1/projects/{ref}/functions`, `GET .../secrets` (names only), SELECT-only catalog queries.

## 3. Status of every result (six classes)
Classes: **1** Implemented · **2** Tested with mocks · **3** Deployed and verified in DEV · **4** Verified with a real provider · **5** Verified in production · **6** Not run or blocked.

| Feature | Highest class reached | Notes |
|---|---|---|
| Payments ledger, `settle_payment`, browser + webhook settlement | **4** (Razorpay TEST, earlier sessions) | 5: no |
| Late payment / amount mismatch / duplicate payment | **4** (Razorpay TEST R2/R3) | 5: no |
| Refund execution, retry, stale recovery | **4** (TEST R2-R5); notification email 3 (mock) | 5: no |
| **Admin status guard + manual decisions (042)** | **3** | no real provider involved; 5: no |
| Full-refund-only | 3 | 6 for real provider (`p7` V4/V6 not run) |
| `payment.failed`, `refund.*` events | 3 | 6 for real provider (`p7` V2/V3) |
| Reconciliation (incl. dry run), orphan detection | 3 | 6 for real provider (`p7` V1/V5) |
| Expiry, held orders, stock invariant, RTO approval | 3 | internal; 5: no |
| Audit chain, checkpoints, `financial_health()` | 3 | 5: no |
| Courier webhook (provider-neutral) | 3 | 6: no provider chosen |
| WhatsApp P1 | 3 | 6: real Meta round trip `p6` not run |
| AI replies (disabled) | 2 (mock model) | 6: no NVIDIA key; nothing enabled |
| Social containment | **5** (deployed and verified in production 2026-10-10) | `social-webhook` v8 / `social-reply` v9 answer 503; smoke 3/3; 0 rows written |
| E2E against the existing frontend | 6 | not run; the frozen UI's exact PATCH payloads (`updateOrderStatus`, `cancelMyOrder`) are exercised by the API suites |

## 4. Clean DEV regression (this round)
Run on 2026-10-10, 14:25:56-14:46:49 IST, with `supabase/tests/run-dev-regression.ps1 -Ref lffnmycocbtpyvntccbg`, after a reset and a **verified clean** DEV state (13 checks). **14 suites, 0 failed** (exit code 0).

| Suite | Result |
|---|---|
| unit (signatures, Meta payloads, sender, guardrails, preflight, locale gate, provider adapter, courier) | **66 / 66** |
| AI evaluation harness self-test (fake model) | 0 hard failures (says nothing about a real model) |
| SQL suites: p0 security, p0 stock, p1 financial, p2 audit, p2 stock invariant, p3 safety net, **p8 status guard** | **7 / 7 files** (p8: 31 unsafe updates blocked + legitimate flows) |
| p0 API checks (HTTP, real triggers) | PASS |
| p0 concurrency (parallel HTTP, row locks, signed duplicate webhooks) | PASS |
| p0 auth (real customer + admin logins) | PASS |
| p1 financial end to end (mock Razorpay) | PASS |
| p2 failure/recovery | PASS |
| **p8 admin status guard, real admin API path + concurrent manual decisions** | **45 / 45** |
| p5 safety net | **43 / 43** |
| p4 WhatsApp | **149 / 149** |
| p4b campaign AI endpoint | **8 / 8** |
| smoke test | **33 / 33** |
| infrastructure check, post phase | **0 FAIL**, 3 WARN (DEV mock `RAZORPAY_API_BASE`, no automatic backup, 1 pending order), 62 PASS (incl. the new 042 marker) |

**Failures:** none. All of the above uses DEV mocks for Razorpay, Meta and the AI model; none of it is real-provider evidence.

## 5. Production social-webhook containment: DEPLOYED and verified (2026-10-10)
- Deployed from commit `ed98662` after a read-only pre-deploy check matched the reviewed plan exactly.
- Production now runs `social-webhook` **v8** and `social-reply` **v9**; the other 11 functions are unchanged.
- `smoke-test.ps1 -Only social`: **3 / 3 PASS** (all 503). `social_messages` still 0 rows. Edge logs since the deploy show only the 3 probe calls, all 503.
- Fixed-503 rollback (`social-rollback-to-stub.ps1`) is ready and was not needed.

Review package as approved:
`PRODUCTION_SOCIAL_WEBHOOK_CONTAINMENT.md` §3-6 now contains:
- target `vkcwfwgxelmamuydwrow`;
- the versions deployed before the change (v7/v8);
- proof that the deployed code equals git `29669e4`;
- the code diff and SHA-256 of the files (committed as C1, `ed98662`);
- the deploy command, verification commands and a **rollback to fixed 503 stubs** (`social-rollback-to-stub.ps1`). Rollback never redeploys the unsigned v7 code.

With the production secrets as they are (neither enabling secret set), the deployed result answers 503 to everything, as verified.

## 6. Production prerequisites (NO-GO until all are met)
1. ~~Social-webhook containment~~ **done** (2026-10-10, section 5).
2. Backup: export + `pg_dump`, verified, off-machine (production has none; no PITR).
3. `pg_cron`, Vault `project_url`, secrets per the matrix; forbidden DEV secrets absent.
4. Migrations **033-042** in order. **042 is mandatory while the admin UI is frozen.** Operators trained on `ADMIN_MANUAL_DECISIONS_RUNBOOK.md`.
5. Real Razorpay TEST `p7` passes; real Meta `p6` passes before WhatsApp ships.
6. Someone checks alerts, refund requests and held orders daily (no push alerts).
7. Temporary production-write token for the rollout, revoked afterwards.
8. Commits of this work (none made; each needs your approval).

Order: `PRODUCTION_INFRASTRUCTURE_READINESS.md` §3.

## 7. Frontend contracts
Unchanged (`BACKEND_FINAL_HANDOFF_CHECKLIST.md` §10), plus one addition for the frozen period: a direct status change that 042 refuses returns **HTTP 400** with a message starting `ORDER_STATUS_BLOCKED:`. The existing AdminOrders page already shows such errors and reloads.

## 8. Production prerequisites checked read-only (2026-10-10, after the regression)
`infra-check.ps1 -Ref vkcwfwgxelmamuydwrow -Phase pre` (SELECT and GET only): **3 FAIL, 2 WARN, 26 PASS, 34 INFO**. The raw output is not kept in the repository (it lists secret names); re-run the same command to reproduce it.

| Gate | Evidence | Status |
|---|---|---|
| Backup / recovery | `GET /v1/projects/vkcwfwgxelmamuydwrow/database/backups`: `pitr_enabled=False`, **0 backups listed**. Postgres 17.6.1.141 | **FAIL: no restore point exists.** Nothing to verify yet |
| Backup tooling on this machine | `pg_dump`, `pg_restore`, `psql`: **not installed**. `supabase db dump` uses a Docker container (Supabase CLI docs), and Docker is not used here | **BLOCKED**: needs PostgreSQL 17 client tools (global install, your approval) or a Supabase plan with backups |
| pg_cron | available but **not installed** | FAIL (dashboard -> Database -> Extensions, before the migrations) |
| Vault `project_url` | **missing** (`hook_process_refund`, `hook_order_email` exist) | FAIL |
| Migrations 033-042 | none applied | expected (held back) |
| Pending online orders | none | PASS (no customer would be expired mid-payment) |
| Retired functions | `whatsapp-notify`, `whatsapp-broadcast` still deployed | WARN (remove at cutover) |
| Secrets missing for the new code | `REFUND_NOTIFY_HOOK_SECRET`, `RECONCILE_HOOK_SECRET`, `META_APP_SECRET_WHATSAPP`, `WHATSAPP_WABA_ID`, `WHATSAPP_WORKER_SECRET`, `STORE_URL`, `STORE_PHONES` | INFO (set during rollout, per the matrix) |
| Social inbox / AI | `SOCIAL_INBOX_ENABLED` and `AI_PROVIDER` not set | PASS |

**Recovery cannot be called verified until** a dump exists **and** has been restored somewhere other than production. The restore target needs your choice; the DEV project must not be overwritten.

## 9. Real-provider checks (outstanding; nothing re-run)
| Check | State today | Why it cannot proceed without you | Earlier evidence reused |
|---|---|---|---|
| Razorpay `p7` | DEV is in **mock** mode (`RAZORPAY_API_BASE` set) | you switch DEV to TEST mode with hidden prompts, tick 4 TEST-webhook events, make 3 browser payments + 1 deliberate UPI failure | settlement, refund once, webhook delivery, duplicate-refund refusal (earlier sessions). Those ran **before** the 040 changes to `razorpay-webhook` / `process-refund`, so the new paths are covered only by `p7` |
| Meta `p6` | DEV WhatsApp in mock mode | needs your Meta test app, test WABA and a recipient phone | none |
| Nemotron | `NVIDIA_API_KEY` **not set** (user and process env) | you set the key yourself; AI stays disabled whatever the result | harness self-test only |

## 10. Commits and handover package (none created yet; each needs approval)
Dependency order on `dev/financial-state-machine` (base `b12aaa7`). Each commit depends only on earlier ones. The staging of every commit was dry-run in a throwaway git index: no frontend, `design-handoff*` or other unrelated paths are staged.

| # | Content |
|---|---|
| C1 | social containment + fixed-503 rollback stubs and script (separate from the backend commits) |
| C2 | 039 WhatsApp P1 + AI layer (disabled), retires `whatsapp-notify` / `whatsapp-broadcast` in the repository |
| C3 | 040 financial safety net, Razorpay TEST tooling |
| C4 | 041 courier backend, `p3_safety_net.sql`, unit tests |
| C5 | 042 admin status guard, p8 SQL + API tests |
| C6 | DEV suites, regression runner (incl. p8), ops tooling |
| C7 | documentation handover (9 files, force-added because `.gitignore` has `*.md`) |

Not committed: generated `supabase/tests/ai-eval/results/*.json`, all frontend changes, `design-handoff*`, other root `.md` files.
