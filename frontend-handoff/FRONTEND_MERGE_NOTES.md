# Frontend merge notes — cost_price change (for the frontend developer)

**Not pushed. Not deployed.** The backend side is already live (migration 032).

## Why
`products.cost_price` was readable by anyone with the public API key. Costs now live in an admin-only table `product_costs(product_id, cost_price)`. The column `products.cost_price` still exists but is **always NULL**, so storefront `select('*')` keeps working untouched.

## What to merge
Branch `frontend/cost-price-product-costs` (commit `b315ea3`, 2 files, +12/−3), or apply `frontend-handoff/cost-price-product-costs.patch`:

| File | Change |
|---|---|
| `src/lib/adminCatalog.js` `fetchAdminProducts()` | after loading products, also `select product_id, cost_price from product_costs` and merge it back as `p.cost_price` |
| `src/lib/adminAnalytics.js` | embed `products(id, name, brand, categories(name))` (no `cost_price`), fetch `product_costs`, look the cost up by product id for profit/margin |

Writes need **no change**: `AdminProducts.jsx` still sends `cost_price` on create/update; a DB trigger moves it into `product_costs` and blanks the public column.

## Until it is merged
Admin product list/analytics show costs/margins as blank (customers are unaffected; only one product currently has a cost).

## Known behaviour to be aware of
- Sending `cost_price: null` means "no change" (a cost cannot be cleared from the UI). Say if you want an explicit "clear cost" action and I will add a backend RPC.
- Do not read `cost_price` from `products` anywhere (it will always be null). Do not query `product_costs` from non-admin pages (it returns nothing / permission denied by design).

## Other backend contract changes the frontend should know about
- `verify-payment` response: unchanged shape (`{success:true}` or `{success:true, alreadyProcessed:true}`). **Pending change (financial edge case, see FINANCIAL_EDGE_CASE_PAID_BUT_CANCELLED.md):** it will later return `success:false` with a code when the order was cancelled before payment — the checkout UI will need a message for that.

---
## Update (financial work, DEV only — not in production yet)

New **order statuses**: `rto` (returned to origin, set only on the definitive "RTO delivered" courier status) and `on_hold` (paid but out of stock — waiting for an admin).
New **refund_status** values on orders: `awaiting_approval`, `rejected` (plus existing pending/processed/failed).

**`verify-payment` response codes** (`success:false` always means "do NOT show a paid screen"):
| code | meaning | suggested message |
|---|---|---|
| `ORDER_CANCELLED_REFUND_INITIATED` | order cancelled/expired before payment arrived; full refund started | use the returned `error` text |
| `PAYMENT_UNDER_REVIEW` | amount mismatch / unmatched payment | use `error` |
| `PAYMENT_HELD_OUT_OF_STOCK` | paid, but an item just sold out; order on hold | use `error` |
| `success:true` + `code:DUPLICATE_PAYMENT_REFUND_INITIATED` | order IS paid; an extra payment is being refunded | normal success page |

**Checkout / order creation** can now fail with a database error whose message starts `INSUFFICIENT_STOCK:` — show "Only N left" and refresh the cart.

**Admin screens needed** (all data is RLS-protected, admin only): refund approvals (`refund_requests` with status `requested`; actions `approve_refund(id)`, `reject_refund(id, note)`, `retry_refund(id)`), held orders (`orders.status = 'on_hold'`; actions `fulfil_held_order(id)`, `refund_held_order(id)`), operational alerts (`ops_events` where `resolved_at is null`; `resolve_ops_event(id)`), audit trail (`financial_audit`, `audit_chain_status()`), customer notifications outbox (`customer_notifications`).
Recommended later: a single `place_order` RPC (order + items in one transaction) — ask the backend developer.
