# Courier provider: what we need before any automation is switched on

Status: **no provider chosen.** The backend is provider-neutral and **nothing is automated for a real provider**: with `COURIER_PROVIDER` unset (production) or set to a provider with no mapping, every courier status is **recorded only** (`courier_events`, `orders.courier_status`), raises one "unmapped status" alert per wording, and changes **no order status, no stock and no refund**. Verified by `p3_safety_net.sql` (S4a-S4f) and `p5_backend_safety_dev.ps1`. No provider event name or status meaning has been guessed anywhere.

## 1. What is already built (provider-independent)
| Piece | Behaviour |
|---|---|
| `courier-webhook` | authenticates every call (shared token in `x-api-key`/`x-webhook-token`/`Authorization: Bearer`, or HMAC-SHA256 over the raw body with configurable header/encoding/prefix); fails closed; 401 on bad auth; 500 on a storage error so the provider retries; 200 otherwise |
| `courier_events` | one row per distinct event (dedup key = provider + AWB + order ref + status + provider timestamp), with what was done |
| `courier_status_map` | (provider, provider wording normalised) -> one of our canonical events. **Empty for every real provider.** Filled only by an admin (`set_courier_mapping`) after reading the provider's documentation |
| `courier_apply_event` (one transaction) | shipped / in transit / out for delivery: confirmed or paid -> shipped. delivered -> delivered. **rto_initiated / rto_in_transit: recorded only.** **rto_delivered (back with the seller): -> `rto`; stock restored exactly once; ONE refund request that needs admin approval.** shipment cancelled: alert only (a cancelled shipment is not a cancelled order). Conflicts (e.g. delivered after RTO) and AWB mismatches: alert, no change |

## 2. Documentation and access we need from the provider (exact list)
1. **Webhook authentication:** how they prove a call is theirs: static token (which header, can we choose the value?), or a signature (algorithm, which header, what bytes are signed: raw body? body + timestamp?, hex or base64, any prefix), source IP list, and whether a timestamp is included (replay protection).
2. **Payload schema** for status webhooks: field names and types for: our order reference (do they echo our order id, and in which field?), AWB/tracking number, courier name, current status (code and/or text), status timestamp (format, timezone), event/scan id if any. One example payload per status, ideally captured from their sandbox.
3. **The complete status list** (codes and exact text) with the provider's **definition** of each, in particular:
   - which status means **"RTO initiated"** (return started, parcel still travelling),
   - which means **"RTO in transit"**,
   - which status is the **definitive "returned to seller / delivered to origin warehouse"** state (the ONLY one that may restore stock and open a refund request),
   - lost / damaged / destroyed states, cancelled-shipment states, "undelivered / NDR" states, and whether any status can be reversed later.
4. **Delivery semantics:** retry policy if we answer non-2xx (how often, for how long), ordering guarantees, whether duplicates are possible, max payload size, timeout they allow us.
5. **Sandbox / test mode:** a way to send test events (dashboard button or API) and test AWBs.
6. **Credentials:** where the webhook token/secret is set, plus API credentials only if we later pull tracking (not needed for webhooks).

## 3. What I do once that documentation exists (DEV first)
1. Write a small adapter in `_shared/courier.ts` only if their payload field names differ from the generic ones.
2. Set `COURIER_PROVIDER=<name>`, the auth mode/secret in DEV; fill `courier_status_map` from **their** status list (each row with a note citing the document section).
3. Verify in DEV with their sandbox events: authentication (valid, missing, wrong, tampered), each mapped status, **RTO initiated and RTO in transit change nothing**, the definitive return status -> `rto` with stock restored **exactly once** and **one** refund request awaiting approval, duplicate and re-keyed deliveries, retries after a forced 500, admin approval -> one refund, unmapped wording -> alert only.
4. Report results; only then the same configuration for production.

## 4. Until then (launch without courier automation)
Admins set shipped/delivered/RTO by hand (needs the admin screens). Automatic stock restoration happens **only** when an order becomes `rto` (by admin or by a mapped definitive return event) and never for unmapped or intermediate states.
