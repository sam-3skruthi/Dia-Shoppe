# Manual refund and held-order decisions during the frontend freeze

Applies once migrations 034-042 are live. **Status today: DEV only** (042 applied and tested on DEV `lffnmycocbtpyvntccbg`, 2026-10-10). Production has none of 033-042.

The frozen admin Orders screen cannot approve or reject refunds and cannot resolve held orders. Migration 042 stops it from making unsafe status changes. Those decisions are made by an operator in the **Supabase SQL editor** of the project, using the two procedures below.

## 1. What the admin screen will refuse (042 guard)
Direct status changes through the API (the admin dropdown, any `PATCH orders`, the service key) are refused with HTTP 400 and a message starting `ORDER_STATUS_BLOCKED:`. The admin screen shows that message and reloads the list.

| Order is | Refused | Allowed | How it is resolved instead |
|---|---|---|---|
| `on_hold` (paid, stock ran out) | every change | nothing | §3 held-order procedure (fulfil after restock, or refund) |
| `pending` (no settled payment; includes every **amount-mismatch** order) | paid / confirmed / shipped / delivered / rto | **cancelled** | a correct payment confirms it automatically; a mismatch refund is decided in §2 |
| `rto` (returned to sender) | every change | nothing (final) | §2 refund decision |
| `cancelled` | every change (no reopening) | nothing (final) | n/a |
| anything | -> `on_hold` | | only payment settlement holds an order |

Unchanged: confirmed -> shipped -> delivered, admin cancel of paid orders (auto-approved full refund, stock returned once), customer cancel, COD orders, payment settlement, courier events, the 30-minute expiry job.

## 2. Find what needs a decision (read only)
```sql
-- refunds waiting for an admin
select rr.id as refund_request_id, rr.order_id, o.status as order_status, rr.reason, rr.amount, rr.created_at
  from public.refund_requests rr left join public.orders o on o.id = rr.order_id
 where rr.status = 'requested' order by rr.created_at;
-- held orders and their shortage
select id as order_id, hold_reason, total_amount, created_at from public.orders where status = 'on_hold' order by created_at;
-- open alerts
select severity, code, entity, entity_id, message, at from public.ops_events where resolved_at is null order by at;
```

## 3. Make the decision
```sql
-- refund requests: rto, amount_mismatch, courier_cancel
select private.manual_refund_decision(<refund_request_id>, 'approve', '<your admin email>', '<why>');
select private.manual_refund_decision(<refund_request_id>, 'reject',  '<your admin email>', '<why>');

-- held orders (paid, stock short)
select private.manual_held_order_decision(<order_id>, 'fulfil', '<your admin email>', '<why>');  -- refuses while still short: restock first
select private.manual_held_order_decision(<order_id>, 'refund', '<your admin email>', '<why>');  -- cancels the order and refunds in full
```
Run **one statement at a time** and read the result before the next.

| Result | Meaning |
|---|---|
| `approved` / `rejected` / `fulfilled` / `refunded` | done in this call |
| `already_approved` / `already_rejected` / `already_fulfilled` / `already_refunded` | the same decision had already taken effect; nothing changed (safe to repeat) |
| error `MANUAL_DECISION: ... is not an active admin` | the email is not an active admin profile |
| error `MANUAL_DECISION: ... is <status>; cannot ...` | a different decision already exists (for example approved, then reject). Nothing changed |
| error `... use private.manual_held_order_decision` | the refund belongs to a held order; use the held-order call |
| error `... still short of stock` | restock the product, then call `fulfil` again |

An approved refund is sent to Razorpay automatically (same path as today), always as a **full** refund. Watch it reach `processed` with the first query in §2 or the admin screen's refund badge (cancelled orders only).

## 4. Safety properties (tested on DEV: `p8_admin_status_guard.sql`, `p8_admin_status_guard_dev.ps1`)
- **Privileged:** the procedures live in the `private` schema, which the API does not expose (HTTP 404 for customer and admin), and EXECUTE is revoked from `PUBLIC`, `anon`, `authenticated` and `service_role`. Only the database owner can run them, which means the SQL editor. Customers calling `approve_refund` / `reject_refund` get 403.
- **Auditable:** the decision runs through the same `approve_refund` / `reject_refund` / `fulfil_held_order` / `refund_held_order` functions as a future admin UI, acting as the named admin. So `approved_by` and the audit chain's actor are that admin. An extra `financial_audit` row (`action = 'manual_decision'`) records the decision, the note, the admin email and the database session user. A note is required.
- **Idempotent:** repeating a decision returns `already_*` and writes nothing new.
- **Transaction-safe:** each call locks the refund request or order row. Two operators deciding the same request at the same moment produce one decision and one audit entry; the other gets `already_*` (tested with two parallel calls).
- Limits: the email is what the operator types. The SQL editor is already owner-level access, so the audit records the session user as well. Rejecting an amount-mismatch refund while the order is still `pending` is undone by the 30-minute expiry: expiry cancels the order and opens an auto-approved full refund. I read this from the code; it is **not tested**. Decide mismatch refunds after the order has expired, or approve them.

## 5. Not covered
- No push alerts: someone must run the §2 queries daily.
- Failed refunds are retried automatically (038). A manual retry is `public.retry_refund` and needs an admin login; there is no SQL-editor wrapper.
- The admin screen still cannot display `on_hold`, `rto` or `awaiting_approval` / `rejected` refund states correctly. That is a frontend change for after the freeze.
