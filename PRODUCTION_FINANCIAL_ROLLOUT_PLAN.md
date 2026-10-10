# Production rollout plan: DEV financial backend (migrations 033–038)

Status: **PLAN ONLY. Nothing has been deployed to production.**
Written 2026-10-05 from the repo (branch `dev/financial-state-machine`), the DEV project `lffnmycocbtpyvntccbg`, and **read-only** queries against production `vkcwfwgxelmamuydwrow` (SELECTs and the function/backup listing endpoints only).

---

## 0. What was verified in DEV

| Area | Evidence |
|---|---|
| Real Razorpay TEST payment, automatic webhook, normal path | Final SmokeOnly run: fresh order → real payment → Razorpay's own webhook → HTTP 200 (2 calls, 0 rejected) → 1 ledger row (₹199.00, `razorpay-webhook`) → order `confirmed` → stock 19→18 once → 1× `payment_captured` + 1× `payment_recorded` → audit chain intact → no refund, no ops alert |
| Late payment after cancellation | R3: order stays cancelled, stock untouched, full automatic refund, exactly 1 Razorpay refund |
| Amount mismatch | R2: order not confirmed, refund waits for admin, approved → exactly 1 real refund, tagged with request id |
| Refund crash recovery / idempotency | R4: lost-result recovery reconciles, still exactly 1 refund; a deliberate 2nd refund is refused by Razorpay |
| Refund failure handling | R5: gateway refusal stored as `failed`, admin alert raised, customer not told |
| Audit-chain protection | `audit_chain_status()` intact (862 rows at last check); UPDATE/DELETE/TRUNCATE blocked |
| Suites | p0/p1/p2 SQL + `p3_razorpay_real_dev.ps1` (25 checks) + SmokeOnly all green |

**Not yet exercised against real Razorpay:** the `rto` workflow, the `on_hold` (stock short at payment) workflow, 30-minute expiry cron (only observed incidentally: it cancelled smoke order 273), `refund_delayed` customer email. These are covered by the DEV mock suites (p1/p2) only.

---

## 1. Inventory of what ships

### 1.1 Migrations (apply in this order; all idempotent, `CREATE OR REPLACE` / `IF NOT EXISTS`)

| # | File | What it does | Hard prerequisites in PROD |
|---|---|---|---|
| 033 | `033_project_url_from_vault.sql` | Trigger URLs read `private.project_url()` from Vault instead of a hard-coded URL | **Vault secret `project_url` must exist first** (it does not in PROD today). Without it triggers log a WARNING and silently do nothing |
| 034 | `034_financial_state_machine.sql` | `payments`, `refund_requests`, `financial_audit`; `settle_payment()`; `rto` status; late-payment auto-refund; admin `approve_refund`/`reject_refund`; 30-min expiry function + cron; **backfills `payments` from the 5 existing online orders (`source='legacy'`)** | `pg_cron` enabled (see below); 030–032 already applied (they are: `product_costs`, `private` schema exist) |
| 035 | `035_refund_recovery.sql` | `processing_since`, requeue stuck refunds (cron every 10 min) | pg_cron |
| 036 | `036_stock_invariant_and_ops_events.sql` | Stock invariant, `on_hold` status, `ops_events`, `fulfil_held_order` / `refund_held_order`, new `confirm_online_payment`, `cancel_empty_orders` cron | pg_cron |
| 037 | `037_audit_integrity.sql` | Hash chain, append-only triggers, `audit_chain_status()`, `audit_chain_head()` | none |
| 038 | `038_refund_failure_handling.sql` | Retry/backoff (10m/30m/2h/6h, max 5), ops alerts, customer notification dispatch, **generates Vault secret `hook_refund_notify`**, `retry-failed-refunds` cron every 5 min | `pg_net`, pg_cron |

Four cron jobs result: `expire-pending-orders` (*/5), `requeue-stuck-refunds` (*/10), `cancel-empty-orders` (*/10), `retry-failed-refunds` (*/5).

> **Trap:** each cron block is wrapped in `EXCEPTION WHEN OTHERS THEN RAISE WARNING`. If `pg_cron` is not enabled the migration **succeeds with only a warning and no jobs exist**. Always verify `select jobname from cron.job` after applying.

### 1.2 Edge Functions

| Function | In PROD today | Change | Needs `--no-verify-jwt` | New/changed secrets |
|---|---|---|---|---|
| `verify-payment` | v17 | Calls `settle_payment`; returns `success:false` + `code` for late / mismatch / held / orphan | yes (already) | – |
| `razorpay-webhook` | v15 | Calls `settle_payment` (same atomic path) | yes (already) | `RAZORPAY_WEBHOOK_SECRET` must equal the secret saved on the PROD Razorpay webhook |
| `process-refund` | v4 | Claims request, reconciles with Razorpay before refunding, tags refunds with `notes.refund_request_id` | yes | `REFUND_HOOK_SECRET` = Vault `hook_process_refund` |
| `courier-webhook` | v4 | Maps only `rto delivered` → `rto`; restocks once; admin approval for refund | yes | `COURIER_WEBHOOK_TOKEN` (exists) |
| `create-razorpay-order` | v14 | Refuses non-`pending` orders | yes | – |
| `refund-notify` | **not deployed** | New: exactly-once customer email (Resend) | yes | **`REFUND_NOTIFY_HOOK_SECRET` = Vault `hook_refund_notify`** (value only exists after 038) |
| `order-email` | v5 | Unchanged logic; confirm still deployed | yes | – |

Deploy exactly these seven; do **not** touch the WhatsApp / social / assistant functions.

### 1.3 PROD facts found by read-only inspection (these drive the blockers)

| Fact | Consequence |
|---|---|
| `cron` schema absent; `pg_cron` is **available but not installed** | Must enable before 034 or no expiry/recovery/retry jobs exist |
| Vault has **no** `project_url` | 033 prerequisite missing (see §1.1) |
| No `supabase_migrations.schema_migrations` table | Migrations were applied by hand; there is no migration ledger. Keep a manual log (§4) |
| `orders.status` CHECK allows only pending/paid/confirmed/shipped/delivered/cancelled | 034/036 widen it; frontend and admin do not know `rto`/`on_hold` |
| 11 orders total, 1 pending (not online), 0 pending online, 5 online orders with a `payment_id` | Tiny blast radius; backfill covers the 5; **no in-flight online order will be expired on day one** (re-check just before the rollout) |
| Backups: `backups: []`, `pitr_enabled: false` | **No usable automatic backup is listed.** A manual logical export is mandatory |
| Prod functions list lacks `refund-notify` | First deployment of that function |

---

## 2. Credential strategy (token safety)

**Problem:** the single Supabase personal access token (`SUPABASE_ACCESS_TOKEN`, User env var) can write to both DEV and PROD, and every DEV script that takes `-Ref` guards only by a code check (`-Ref vkcwfwg…` → "DEV only").

**Constraint to be honest about:** Supabase personal access tokens are **account-wide**. They cannot be scoped to one project or made read-only. Project-scoped roles exist only on higher plans. So "PROD read-only by default" has to be achieved by separating *identities*, not by scoping one token.

Recommended design (cheapest first):

1. **Day-to-day (DEV write):** keep one token, but make it belong to an identity that is **not a member of the PROD organisation**. Best: put PROD in its own Supabase organisation owned by the real owner account, and use a second account (or the same account with PROD org membership removed for the daily token's account) for DEV. If you cannot split accounts, the fallback is rule-based: no script may accept the PROD ref unless `DIA_PROD_ROLLOUT=1` is set (add that guard to the runners; the `DEV only` throws already exist in the p3/dev scripts).
2. **PROD read-only (genuinely enforced by the database):** create a Postgres role in PROD, `dia_readonly`, `LOGIN`, `GRANT USAGE` on `public`/`private`-none, `GRANT SELECT` on the relevant tables only, with `default_transaction_read_only = on`; use its connection string (pooler) for reconciliation/monitoring queries. This gives true read-only access without any Management API token. (Writing that role is itself a PROD change; do it as step R-1 of the rollout under the rollout credential.)
3. **Rollout credential (temporary PROD write):** a *new* PAT named `prod-rollout-<date>`, created from the account that owns PROD, held only in the session environment (`$env:SUPABASE_ACCESS_TOKEN`), never stored in User env vars or files, **revoked in the dashboard immediately after the post-deployment verification passes** (Account → Access Tokens → Delete). Record creation and revocation times in the rollout log.
4. **Immediately now:** since the current token can already write to PROD, rotate it after the rollout and keep the new daily token off the PROD organisation (item 1). No billing or extra account permissions are needed for any of this.
5. Razorpay: DEV uses TEST keys only (runners refuse anything but `rzp_test_*`). PROD LIVE key/secret already exist as function secrets; the rollout **does not change them**. Nobody types LIVE keys into any script.

---

## 3. Blockers

### MUST FIX BEFORE PRODUCTION

| # | Blocker | Why it blocks | Owner | Done when |
|---|---|---|---|---|
| M1 | **Backup/export** | No automatic backup exists (`backups: []`, no PITR). A bad migration or backfill cannot otherwise be undone | You + me | Verified restorable export of all public tables + Vault secret *names* + function source/versions, stored off-machine (§5) |
| M2 | **Enable `pg_cron`** in PROD | Without it expiry, refund recovery and refund retry never run, silently | You (dashboard) / rollout step | `cron.job` shows the 4 jobs |
| M3 | **Vault `project_url` in PROD** | 033 prerequisite; without it every trigger-driven call (refunds, email, WhatsApp) silently no-ops | Rollout step | `select private.project_url()` returns the PROD URL |
| M4 | **Secrets sync** `REFUND_NOTIFY_HOOK_SECRET` (and confirm `REFUND_HOOK_SECRET`, `ORDER_EMAIL_HOOK_SECRET`, `WHATSAPP_HOOK_SECRET`) equal their Vault `hook_*` values; `RAZORPAY_WEBHOOK_SECRET` equals the PROD Razorpay webhook secret (use `check-webhook-secret.ps1`-style hash comparison against PROD) | A mismatch is exactly what cost us a day in DEV (every Razorpay call → 400) | Rollout step | Hash-match verified, no secret printed |
| M5 | **Frontend: `rto` and `on_hold` must not break the admin/customer app.** Today `ORDER_STATUSES` and the revenue/status sets omit them | Orders in those states would render as unknown, may be miscounted in revenue, and be un-actionable | Friend's frontend | See §7 contract, items F1–F3 |
| M6 | **Admin refund queue UI** (approve/reject `requested` refunds; show `failed` ones) | RTO and amount-mismatch refunds **require** admin approval; the only other path is a hand-run SQL RPC with a JWT claim | Frontend | F4 |
| M7 | **Held-order resolution UI** (`fulfil_held_order` / `refund_held_order`) | A paid order stuck `on_hold` with money taken and no UI = customer waiting indefinitely | Frontend | F5 |
| M8 | **Alert visibility** (`ops_events` open `warning`/`critical`) | Orphan payments, held orders and delayed refunds are only recorded as rows; nobody sees them otherwise | Frontend (page) **or** interim daily SQL check | F6, or §6 daily check signed off |
| M9 | **Frontend handling of new `verify-payment` result codes** (`success:false` + `code`) | The current code shows `v.error` as a generic failure, but must not let a customer who *has paid* retry/re-pay or restore the cart | Frontend | F7 |
| M10 | **Reconciliation, minimum viable:** a read-only daily comparison of Razorpay captured payments (last 48 h) vs the `payments` ledger, run by hand for the first 2 weeks | If the browser callback *and* the webhook both fail, money is captured with no ledger row and the order will expire. Without a comparison nobody would know | Me (script) + you (run) | `reconcile_razorpay.ps1` (read-only; to be written) run clean on day 0 and day 1 |
| M11 | **Partial-refund decision** | Backend refunds **full amounts only**. Must be an explicit, documented product decision: "full refunds only at launch" | You | Decision recorded in this file |
| M12 | **Courier "returned to warehouse" wording confirmed** against your actual courier's payloads | Only the exact string `rto delivered` (after normalisation) maps to `rto`. If the courier says something else, RTO never triggers and stock is never restored | You | Real/sample payload checked; or RTO is declared manual-only via the admin UI (F3) |
| M13 | **Record the audit-chain anchor** (`head_seq`, `head_hash`) at go-live in a place the DB owner cannot edit (email to yourself) | 037 only detects tampering if an outside anchor exists for tail deletion | Rollout step | Anchor saved |
| M14 | **Razorpay LIVE webhook secret & events verified** on the PROD webhook (URL, `payment.captured` + `order.paid`, enabled, secret matches) | Same failure class as the DEV incident | You (dashboard) | Dashboard screenshot/log + hash match (M4) |
| M15 | **Rehearse the full sequence on a DEV clone of PROD-shaped data** (DEV currently has `pg_cron` and Vault; replicate "no pg_cron, no project_url, no `schema_migrations`" start state if feasible, or at minimum dry-run the exact commands) | The PROD start state differs from DEV's; the silent-warning traps in §1.1 are only discovered by running | Me | Rehearsal log attached |

### CAN BE POSTPONED AFTER PRODUCTION (with the stated mitigation)

| # | Item | Mitigation until done |
|---|---|---|
| P1 | Automated daily reconciliation (cron + email/alert) | Manual M10 script, daily for 2 weeks |
| P2 | `payment.failed` webhook handling | No money moves on a failed payment; webhook already acknowledges unknown events with 200. Do **not** enable the event on the PROD webhook until handled |
| P3 | Refund status webhooks (`refund.processed` / `refund.failed`) | Refund result is taken from the synchronous API response; a refund that Razorpay later fails would be caught by reconciliation (P1/M10) and the Razorpay dashboard |
| P4 | Partial-refund support | Handled manually in the Razorpay dashboard + a note; M11 records the decision |
| P5 | Automated financial-audit monitoring (scheduled `audit_chain_status()` + anchor email) | Weekly manual run; anchor saved at go-live (M13) |
| P6 | WhatsApp refund notification | Email is live via `refund-notify`; WhatsApp belongs to P1 queue |
| P7 | Push/email alerts for `critical` ops events | Daily/at-order check of the alerts view (M8) |
| P8 | Courier status vocabulary beyond `rto delivered` | Admin can mark RTO manually (F3) |
| P9 | Orphan-payment auto-matching | `orphan_payment` raises a critical ops event; resolve manually from Razorpay dashboard + order search |

---

## 4. Step-by-step production rollout

Preconditions: all MUST items M1–M15 closed. Use a quiet window (low traffic; no pending online orders). Keep a **rollout log** (timestamped) recording each command, its result, and the migration applied (PROD has no migration ledger).

### Step A — Pre-flight (read-only)
1. `git` state: branch merged/frozen; tag the commit to deploy (`prod-financial-YYYYMMDD`). Confirm the 7 functions' source matches DEV's deployed versions.
2. PROD read-only checks: `select count(*) from orders where status='pending' and payment_method='online'` (**must be 0**, otherwise wait: the expiry cron would cancel them 30 minutes after rollout, and a customer mid-payment would hit the late-payment-refund path); list of functions/versions; `pg_available_extensions` shows `pg_cron`; no open transactions of note.
3. Confirm DEV is back in **mock mode** (`dev-razorpay-mode.ps1 -Mode mock`) so DEV test traffic cannot hit LIVE or confuse results.
4. Confirm Razorpay LIVE webhook settings (M14) and the courier (M12).
5. Create the rollout PAT (§2.3) in the session only.

### Step B — Backup / export (M1)
1. Logical export of every `public` table (`pg_dump --data-only` via the pooler string, or CSV exports of at least `orders`, `order_items`, `products`, `user_profiles`, `payments`-none, `site_settings`, `product_costs`, `social_*`, `whatsapp_messages`, `sale_*`, `feedback`, `cart_items`, `categories`).
2. Schema-only dump (`pg_dump --schema-only`) and a text copy of all trigger/function definitions that 033–038 will replace (`pg_get_functiondef` for `notify_whatsapp_status`, `notify_order_email`, `trigger_order_refund`, `confirm_online_payment`, `restock_cancelled_order`, plus the orders `status` CHECK definition).
3. Export Edge Function source for the 7 functions at their *current* PROD versions (`supabase functions download` or Management API) and note version numbers (create-razorpay-order v14, verify-payment v17, razorpay-webhook v15, process-refund v4, courier-webhook v4, order-email v5).
4. Store off-machine; verify one file by restoring a table into a scratch DEV schema.

### Step C — PROD prerequisites (small, individually reversible)
1. Enable `pg_cron` (dashboard → Database → Extensions).
2. `select vault.create_secret('https://vkcwfwgxelmamuydwrow.supabase.co', 'project_url');`
3. Verify: `select private.project_url();` (after 033) / `select extname from pg_extension where extname='pg_cron'`.
4. Create the `dia_readonly` role (§2.2). Optional but recommended.

### Step D — Migrations (in order, one at a time, each in its own transaction; stop on first error)
`033 → 034 → 035 → 036 → 037 → 038`

After **each** one record success and run its verification:

| After | Verify |
|---|---|
| 033 | `select private.project_url()` returns the PROD URL; the three trigger functions now reference it |
| 034 | tables exist; `payments` has 5 `legacy` rows matching the 5 orders with `payment_id`; `orders` CHECK includes `rto`; cron job `expire-pending-orders` present |
| 035 | `refund_requests.processing_since` exists; cron `requeue-stuck-refunds` |
| 036 | `ops_events` exists; CHECK includes `on_hold`; cron `cancel-empty-orders` |
| 037 | `select public.audit_chain_status()` as admin → `intact:true`; `UPDATE financial_audit …` is refused |
| 038 | cron `retry-failed-refunds`; Vault `hook_refund_notify` exists |

Final: `select jobname from cron.job` must list **exactly the 4 jobs**. If any is missing, the migration swallowed a warning: stop and investigate (do not continue to functions).

### Step E — Secrets (before deploying the functions that read them)
1. Read Vault hook values **inside the DB** and copy to function secrets without printing (same pattern as `dev-bootstrap.ps1` lines 79–86): `REFUND_HOOK_SECRET`←`hook_process_refund`, `REFUND_NOTIFY_HOOK_SECRET`←`hook_refund_notify`, `ORDER_EMAIL_HOOK_SECRET`←`hook_order_email`, `WHATSAPP_HOOK_SECRET`←`hook_whatsapp_notify`.
2. Confirm unchanged and present: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` (LIVE), `RAZORPAY_WEBHOOK_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `COURIER_WEBHOOK_TOKEN`, `POSTHOG_*`.
3. **`RAZORPAY_API_BASE` must be unset or `https://api.razorpay.com` in PROD** (DEV points it at a mock; a leaked DEV value would make PROD refunds hit a mock).
4. Verify with SHA-256 digest comparison only (Management API `/secrets` returns digests).

### Step F — Functions (order matters: new schema is live, old functions still work; deploy consumers last)
1. `refund-notify` (new, nothing calls it until a refund completes)
2. `process-refund`
3. `razorpay-webhook`
4. `verify-payment`
5. `create-razorpay-order`
6. `courier-webhook`
7. `order-email` (only if source differs)

Always `--no-verify-jwt`. After each deploy confirm `verify_jwt=false` via the functions listing (a flipped flag silently breaks webhook/trigger calls — see project memory).

> Note on the interval between D and F: after migrations, the **old** `verify-payment`/`razorpay-webhook` still call `confirm_online_payment`, which 036 re-creates compatibly, so a payment in that window is still handled (but without the new result codes). Keep the window short.

### Step G — Razorpay configuration (LIVE dashboard, by you)
1. Webhook URL = `https://vkcwfwgxelmamuydwrow.supabase.co/functions/v1/razorpay-webhook`, events `payment.captured` + `order.paid` only, Active, secret = M4-verified value (letters/digits/`_`/`-` only). **Do not add `payment.failed` or refund events yet** (P2/P3).
2. Leave PROD and DEV webhooks as separate entries/accounts; DEV stays on TEST mode only.
3. Capture-mode must be automatic (a merely *authorized* payment never fires `payment.captured`).

### Step H — Post-deployment verification
1. Read-only: functions listing (versions bumped, `verify_jwt=false`), `cron.job` (4), `audit_chain_status()` intact, `payments` legacy rows = 5, `ops_events` empty/expected.
2. Smoke: **one real low-value LIVE order** placed by you through the storefront (a ₹1–₹10 product, or a COD-free online order): expect Razorpay webhook call logged with 200, `payments` row, order `confirmed`, stock −1 once, exactly 2 audit rows, `audit_chain_status()` intact, no refund, no ops event. Then refund it from the Razorpay dashboard **or** cancel via admin to exercise the one real PROD refund (exactly 1 refund, notification email received).
3. Record the audit-chain anchor (M13).
4. Check Edge logs for any 4xx/5xx on the 7 functions.
5. Only now revoke the rollout PAT; log the time.

### Step I — Hypercare (first 14 days)
Daily: reconciliation script (M10), open `ops_events`, `refund_requests` not `processed`, `audit_chain_status()`; weekly: anchor comparison.

---

## 5. Rollback procedure

Principle: migrations are additive. **Do not drop the new tables or the audit table** once any real payment has been recorded; a rollback that discards ledger rows destroys financial history.

| When it fails | Action |
|---|---|
| Step C/D before any real payment is recorded | Restore replaced functions/triggers from the Step B.2 definitions; `select cron.unschedule(jobname)` for the 4 jobs; revert the `orders` CHECK from the saved definition; new empty tables may be dropped. Redeploy the old function versions from Step B.3 |
| After Step F, before any customer payment | Redeploy the old function sources (B.3) **and** re-apply the saved old SQL functions. `payments` backfill rows can stay (harmless) |
| After real payments exist | **Roll forward only.** Disable behaviour instead of dropping data: `cron.unschedule` the recovery jobs if they misbehave; keep functions on the new versions; fix forward. If the webhook is wrong, point Razorpay's webhook at nothing and rely on `verify-payment` + reconciliation while fixing |
| Emergency stop for refunds | `update refund_requests set status='rejected' where status in ('approved','requested')` (with a note) — never delete; and `select cron.unschedule('retry-failed-refunds')` |

Restore from the Step B export is the last resort and requires deciding explicitly what to do with orders placed since the export.

---

## 6. Data reconciliation procedure

**Daily (hypercare), read-only:**
1. From Razorpay (LIVE, read-only API call or dashboard export): list `captured` payments in the last 48 h (id, order_id, amount, refund status).
2. From the DB: `select razorpay_payment_id, status, amount from payments where created_at > now()-interval '48 hours'`.
3. Compare. Expected classes:
   - In both, order `confirmed`/later → fine.
   - In Razorpay, **not** in ledger → webhook and verify both missed it. Action: find the DB order by `razorpay_order_id`. If still `pending`/not expired, **resend the webhook from the Razorpay delivery log** (Razorpay-originated, signed correctly). If the order is already `cancelled`, resend is still correct: it takes the late-payment path and refunds automatically.
   - In ledger, not in Razorpay → investigate immediately (should be impossible except `legacy`).
   - `refunded` in ledger but no refund at Razorpay, or the reverse → compare `refund_requests.razorpay_refund_id` with Razorpay.
4. Integrity: `select public.audit_chain_status()` → `intact:true`; compare `head_seq/head_hash` against the saved anchor (head must be ≥ anchor and contain it).
5. Stock: for `confirmed`-and-after orders, deducted units = sum of item quantities (036 invariant function can be queried per order).

**One-off at go-live:** reconcile the 5 `legacy` payments against Razorpay LIVE history.

---

## 7. Failure recovery procedures

| Symptom | Check | Recovery |
|---|---|---|
| Razorpay webhook calls show **400** | Edge logs: `Razorpay-Webhook/v1` + status 400 | Secret mismatch. Hash-compare typed secret vs `RAZORPAY_WEBHOOK_SECRET` digest (script exists); fix whichever side is wrong; **use the dashboard's Resend** on the failed deliveries |
| Webhook calls show **500** | Edge logs / function error | DB function error: read the error, fix forward; Razorpay retries up to 24 h; reconciliation covers the rest |
| Payment captured, order was cancelled by the 30-min expiry | `payments.status`, `refund_requests` reason `late_payment_after_cancel` | Automatic full refund already queued; verify `processed`. If it is `failed`, the retry job re-submits (10m/30m/2h/6h ×5) and raises a critical ops event on exhaustion |
| Refund stuck `processing` | `processing_since` > 15 min | `requeue-stuck-refunds` returns it to `approved`; `process-refund` first asks Razorpay whether the refund already exists (no double refund) |
| Refund `failed` repeatedly | `ops_events` code `refund_failed` | Read the stored Razorpay error (e.g. "already fully refunded" → mark resolved); otherwise refund in the Razorpay dashboard and reconcile the request row |
| Order `on_hold` | `ops_events` `insufficient_stock` | Admin: restock then `fulfil_held_order(id)`, or `refund_held_order(id)` |
| Order `rto` | `refund_requests` `requested` | Admin approves or rejects (`approve_refund` / `reject_refund`); stock was restored once automatically |
| Orphan payment | `ops_events` critical `orphan_payment` | Match by `razorpay_order_id` in the Razorpay dashboard; fix the order link; resend the webhook |
| Audit chain **not intact** | `first_bad_seq` | Treat as an incident: freeze admin writes, export `financial_audit`, compare to the anchor, identify the modified row; do **not** repair rows (table is append-only by design) |
| `refund-notify` emails missing | `customer_notifications` rows | Check `REFUND_NOTIFY_HOOK_SECRET` vs Vault `hook_refund_notify` and `RESEND_API_KEY`; the unique key makes re-calling safe |
| Cron jobs absent | `select * from cron.job` | Re-run the `DO $$ … cron.schedule …` blocks from 034/035/036/038 |

---

## 8. Frontend contract / handoff (do **not** push to the friend's branch)

All of this is derived from what the backend now does; nothing here has been implemented.

**Statuses (orders.status):** add `on_hold` and `rto` everywhere statuses are enumerated (`src/lib/orders.js:147 ORDER_STATUSES`, `AdminOrders.jsx` badges, Dashboard status tiles). Revenue/spend sets (`adminAnalytics.js`, `adminCustomers.js`, `adminStats.js`: `paid, confirmed, shipped, delivered`) must **exclude** `on_hold`, `rto`, `cancelled`. Customer order page: `on_hold` = "payment received, we are checking stock"; `rto` = "returned to us; any refund is being reviewed".

| ID | Requirement | Backend source |
|---|---|---|
| F1 | Admin Orders list/filters/badges for `on_hold`, `rto`; customer Orders/OrderConfirmation labels | `orders.status`, `hold_reason` (`insufficient_stock`) |
| F2 | Revenue/analytics exclusions per above | – |
| F3 | Admin action "Mark as returned to origin (RTO)" for orders `shipped`; hidden/disabled for terminal states | `orders.status='rto'` (restocks once, opens a refund request needing approval) |
| F4 | **Refund queue** (admin): list `refund_requests` with `status` `requested`/`approved`/`processing`/`failed`/`processed`/`rejected`, amount, reason (`amount_mismatch`, `rto`, `admin_cancel`, `late_payment_after_cancel`, `insufficient_stock`, `duplicate_payment`), error text; buttons **Approve** → `rpc('approve_refund', {p_request_id})`, **Reject** → `rpc('reject_refund', {p_request_id, p_note})` | admin-only RPCs (RLS via `is_admin()`); table is SELECT-only for `authenticated` |
| F5 | **Held orders** (admin): for `on_hold` show shortages; buttons **Fulfil** → `rpc('fulfil_held_order', {p_order_id})` (fails with a clear message if stock is still short), **Refund** → `rpc('refund_held_order', {p_order_id})` | – |
| F6 | **Alerts panel**: read `ops_events` where `resolved_at is null`, sorted by `severity` (critical first); show `code`, `message`, `entity`/`entity_id`; link to the order/refund. Codes: `orphan_payment`, `insufficient_stock` (critical); `amount_mismatch`, `refund_needs_approval`, `refund_failed`, `refund_stalled` (warning); `refund_retries_exhausted` (critical) | admin-only SELECT |
| F7 | **Payment result handling** in `src/lib/razorpay.js` handler: `verify-payment` returns `success:false` with `code`: `ORDER_CANCELLED_REFUND_INITIATED`, `PAYMENT_UNDER_REVIEW`, `PAYMENT_HELD_OUT_OF_STOCK`; `success:true` with `alreadyProcessed` and optionally `code: DUPLICATE_PAYMENT_REFUND_INITIATED`. Required behaviour: show the returned `error` text as an **informational** state (not "payment failed"), **do not** offer "pay again", do **not** restore the cart, clear the pending checkout, and link to Orders. Treat `alreadyProcessed:true` as success | `supabase/functions/verify-payment/index.ts` lines 185–215 |
| F8 | Customer cancel: unchanged contract, but note `create-razorpay-order` now rejects non-`pending` orders (cancelled/expired) – show "this order has expired, please place it again" | `create-razorpay-order` |
| F9 | Admin "Audit" view (read-only): call `rpc('audit_chain_status')` and display `intact`, `rows`, `head_seq`, `head_hash` | `audit_chain_status()` (admin only) |

Hard rule for the frontend: **never write** to `payments`, `refund_requests`, `financial_audit`, `ops_events` or call `settle_payment` directly; these are service-role/RPC only.

---

## 9. Readiness table

| Component | DEV status | Production migration required | Frontend dependency | External configuration | Risk |
|---|---|---|---|---|---|
| `payments` ledger + `settle_payment` (034) | Verified end to end with real Razorpay TEST | Yes (034, backfills 5 legacy rows) | F7 | – | Low once pg_cron/URL prerequisites done |
| Refund requests / `process-refund` (034/035) | Verified real (R2–R5) | Yes | F4 | `REFUND_HOOK_SECRET` sync | Medium (money moves) |
| Late payment after cancel | Verified real (R3) | Yes | F7, F8 | – | Low |
| 30-min expiry cron | Observed working | Yes + **enable pg_cron** | F8 | pg_cron extension | **High if pg_cron silently missing; also needs 0 pending online orders at rollout** |
| RTO workflow (`rto`, courier map) | Mock suites only | Yes (034 + function) | F1, F3, F4 | Confirm courier wording (M12) | Medium |
| `on_hold` inventory workflow | Mock suites only | Yes (036) | F1, F5 | – | Medium (no UI = stuck orders) |
| Amount mismatch handling | Verified real (R2) | Yes | F4, F7 | – | Low |
| Refund retry/recovery (035/038) | Verified (R4/R5) | Yes | F6 | pg_cron | Medium |
| Customer refund notification (`refund-notify`) | Mock email suites | Yes (038) + new function | – | `REFUND_NOTIFY_HOOK_SECRET`, Resend | Low–Medium (first PROD deploy) |
| Audit chain protection (037) | Verified, intact | Yes | F9 (optional) | Save anchor | Low |
| Razorpay webhook integration | Verified automatic delivery on the normal path | None (function redeploy) | – | **Secret match + events (M14)** | Medium (config class of failure) |
| Cron jobs (4) | Present | Created by 034/035/036/038 | – | pg_cron | High until verified in PROD |
| Vault `project_url` (033) | Present | Create secret **then** 033 | – | – | **High: silent no-op if missing** |
| Secrets/configuration | Synced | n/a | – | See Step E | Medium |
| Backups | n/a | n/a | – | **None exist in PROD** | **High: blocker M1** |
| Reconciliation | Manual only | n/a | – | Script to write (M10) | Medium |
| Frontend (`rto`, `on_hold`, admin queues, codes) | **Not implemented** | n/a | F1–F9 | – | **High: blockers M5–M9** |

---

## 10. Go / no-go

**NO-GO today.** Open blockers: M1 (backup), M2/M3 (PROD prerequisites, trivial but mandatory), M5–M9 (frontend), M10 (reconciliation script), M11/M12 (two decisions from you), M13–M15 (go-live steps and rehearsal). Backend logic itself is verified and is not the blocker.

Sequence to get to GO: (1) you decide M11/M12; (2) I write the reconciliation script and rehearse Steps C–F on DEV (M10, M15); (3) friend ships F1–F9 (or you accept the interim SQL runbook for F4–F6 and sign that off explicitly); (4) take the export (M1); (5) execute §4 in a quiet window with the temporary credential; (6) revoke it.

---

## Update 2026-10-05 (after the backend completion round; details in `BACKEND_FINAL_READINESS_REPORT.md`)
- Migration list is now **033-041** and the function list is **15** (see `PRODUCTION_INFRASTRUCTURE_READINESS.md`, which replaces §4 steps D-F of this plan).
- **M10 reconciliation:** built (`razorpay-reconcile`, daily cron 03:00 UTC, stored runs, auto-heal through `settle_payment`, orphan/missing/untracked-refund findings); verified against the DEV mock only, not yet against the real Razorpay API.
- **M11 partial refunds:** DECIDED: full refunds only at launch, enforced in the database (trigger), in `process-refund`, and any partial refund made in the Razorpay dashboard raises a critical alert instead of being recorded.
- **M12 courier:** abstraction built with no guessed wording; blocked on choosing a provider and reading its documentation.
- **M13 audit anchor:** a daily `audit-verify` job stores checkpoints and detects removal of recent rows; an off-system copy of the head is still a manual step.
- P2/P3 (payment.failed, refund status events) are now handled by `razorpay-webhook`; enable those events on the LIVE webhook (§3 step 8 of the infrastructure document).
- New hard blocker found: the production `social-webhook` (v7) accepts unsigned POSTs (see the infrastructure document §2).

## Update 2026-10-10 (frontend frozen for the first month)
- Migration list is now **033-042**. **042 (admin status guard) is mandatory** while the admin UI is frozen: without it the existing Orders dropdown can ship held, amount-mismatch or RTO orders without taking stock. Refund and held-order decisions are made with `ADMIN_MANUAL_DECISIONS_RUNBOOK.md` until the UI is updated.
- Production re-checked read-only: no 033-042, no pg_cron, no Vault `project_url`, **no backup** (PITR off, 0 backups). Still NO-GO. Details: `BACKEND_FINAL_READINESS_REPORT.md` §8.
- Social-webhook containment is prepared with a fixed-503 rollback that never restores the unsigned endpoint (`PRODUCTION_SOCIAL_WEBHOOK_CONTAINMENT.md`).
