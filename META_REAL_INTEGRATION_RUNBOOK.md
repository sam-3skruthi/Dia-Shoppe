# Real Meta integration on DEV: runbook and manual prerequisites

**WhatsApp is NOT production-ready until `p6_meta_real_dev_roundtrip.ps1` has passed at least once against real Meta.** Everything below is prepared; none of it has been run, because it needs a Meta account, a test number and your phone. Production Meta is not touched by any of this (every script refuses the production project).

## 0. What is already proven, and what only real Meta can prove
| Proven offline / on the DEV mock | Needs real Meta (what the round trip checks) |
|---|---|
| Signature check on exact raw bytes (valid, missing, wrong secret, 1-byte change anywhere, re-serialised JSON, multi-byte bodies) | The signature **Meta actually produces** verifies with your app secret over the bytes Meta actually sends (R4 recomputes it over captured real bodies) |
| Parser handles every documented payload shape: text, button, interactive, media, reaction, unsupported, statuses with conversation/pricing blocks, failed status with errors, webhook-level errors, other fields | The **real** payloads parse (they are captured to `whatsapp_payload_captures` during the round trip) |
| wamid dedup, monotonic statuses, out-of-order, parked statuses, lost-response linking | Meta really echoes `biz_opaque_callback_data` in status webhooks (assumption; if not, a lost response can cause one duplicate send after the lease expires) |
| Retry/backoff/lease/pause/permanent-failure logic with simulated Graph errors | Meta's **real** error codes and HTTP statuses for: recipient not allowed, wrong language, wrong variable count, expired token, outside 24 h window |
| Template registry validation and sync (mock list) | Template names, language codes, categories and variable counts **as Meta approved them** |

## 1. Manual prerequisites (all yours; none can be done by me)
1. **Meta developer app** (type Business) with the **WhatsApp** product added. Use Meta's free **test phone number / test WABA** for DEV; do **not** attach the shop's real number yet.
2. **Allowed recipient:** in the app's WhatsApp "API setup" add your own phone as a test recipient (the test number can only message numbers on this list; others fail with code 131030, which the round trip uses as its real failure test).
3. Collect (never paste them into chat): **App secret** (App settings -> Basic; 32 hex characters), **Phone number ID**, **WhatsApp Business Account ID**, **access token**. For a longer test create a **permanent system-user token** (Business settings -> System users -> generate token with `whatsapp_business_messaging` and `whatsapp_business_management`, WABA assigned); the 24-hour temporary token also works for a same-day test.
4. **Templates** (WhatsApp Manager -> Message templates). Names, language and variable counts must match the registry exactly:
   | Name | Category | Language | Body | Variables |
   |---|---|---|---|---|
   | `order_update` | Utility | English (`en`) | `Hi {{1}}, your Dia Shoppe order #{{2}} is now {{3}}. {{4}} Thank you for shopping with us!` | 4 (give example values) |
   | `cart_reminder` | Marketing | English (`en`) | e.g. `Hi {{1}}, you left {{2}} item(s) in your Dia Shoppe cart.` | 2 |
   | `promo` | Marketing | English (`en`) | e.g. `Hi {{1}}, {{2}}` with an **IMAGE header** (sample image) | 2 |
   Wait for **APPROVED**. Meta may re-categorise a template (e.g. Utility to Marketing); the sync shows the category Meta really assigned and a mismatch makes the sender refuse. If a language code differs (`en_US` instead of `en`), change the registry row, not the code.
5. **Webhook:** App -> WhatsApp -> Configuration. Run `./supabase/scripts/dev-whatsapp-real-mode.ps1 -Ref lffnmycocbtpyvntccbg -Mode check` to print the callback URL and verify token. Paste both, press **Verify and save**, then subscribe the field **messages**. (Meta calls our GET with the verify token; it must answer with the challenge.)
6. Phone with WhatsApp to send/receive during the test.

## 2. Procedure
```
./supabase/scripts/dev-whatsapp-real-mode.ps1 -Ref lffnmycocbtpyvntccbg -Mode real      # hidden prompts: app secret, token, phone-number id, WABA id
# configure the Meta webhook as printed, then:
./supabase/tests/p6_meta_real_dev_roundtrip.ps1 -Ref lffnmycocbtpyvntccbg
./supabase/scripts/dev-whatsapp-real-mode.ps1 -Ref lffnmycocbtpyvntccbg -Mode mock       # when finished
```
`-Mode real` switches DEV to the real Graph API (removes `WHATSAPP_API_BASE`), sets `AI_PROVIDER=disabled` (customer messages get the fixed handoff reply, no model call) and turns on payload capture (DEV only). It refuses malformed values before changing anything.

## 3. What the round trip does and the evidence it prints
| Step | Action | PASS means |
|---|---|---|
| R0 | mode check; our callback answers the verification handshake | DEV is on real Meta; handshake works |
| R1 | Graph `GET /{phone-id}` and `GET /{waba}/message_templates` via the sync function | token and ids valid; registry now reflects Meta; `order_update/en` approved, enabled, 4 variables |
| R2 | enqueue a real `order_update` to your phone; run the worker | real wamid returned and saved (status `accepted`); you see the message; Meta's **sent / delivered / read** callbacks arrive through the signed webhook and the timeline is monotonic |
| R3 | you send "hello from the tester" | the real inbound is stored (wamid format, E.164, type text); one reply is queued and delivered inside the 24 h window |
| R4 | recompute `X-Hub-Signature-256` over every captured real body; replay a captured real delivery; replay with one changed byte | all real signatures match the app secret; the real replay is 200 duplicate with no second reply; the modified body is 401 |
| R5 | optional: send to a number not on the allow-list | Meta's real error code/text is stored; classification shown for you to check against Meta's docs |
| R6 | you send STOP, then START | consent revoked/granted from a real phone, confirmations sent |

## 4. If something fails
| Symptom | Likely cause |
|---|---|
| "Verify and save" fails at Meta | verify token mismatch, or the function is not deployed / `WHATSAPP_VERIFY_TOKEN` not set (run `-Mode check`) |
| Real messages never arrive in `whatsapp_messages`; function logs show 401 | `META_APP_SECRET_WHATSAPP` differs from the app secret (the same class of error as the Razorpay webhook secret) |
| Nothing arrives and no 401 in logs | webhook field `messages` not subscribed, wrong app, or the app is not subscribed to the WABA |
| send -> 131030 | recipient not on the test allow-list |
| send -> 132001 / 132000 / 132012 | template name or language wrong, or variable count/format differs from Meta's approved template |
| send -> 190 | access token expired or wrong; the queue pauses by design (`wa_resume_queue()` after fixing) |
| send -> 131047 (free text) | the 24 h window is closed; use a template |
| statuses stay `accepted` | no status webhooks: same causes as "nothing arrives" |

## 5. After it passes
Record the result and keep the captured payloads (they become real fixtures: copy a few, with phone numbers masked, into `supabase/tests/whatsapp/fixtures/`). Still required before production: Meta **business verification**, the shop's real number registered and display name approved, messaging-limit tier and quality rating understood, a payment method on the WABA (conversation charges), a **permanent** system-user token, provable marketing opt-in evidence (the legacy flags were copied as consent `legacy_profile_flag`), and the production secrets listed in `PRODUCTION_INFRASTRUCTURE_READINESS.md`.

## 6. Guided session (do these in order; tell me after each numbered block, never paste a secret into chat)
**Block A: Meta side (about 20-30 minutes, one time)**
1. developers.facebook.com -> My Apps -> Create App -> use case "Connect with customers through WhatsApp" -> choose or create a business portfolio. (Meta's current getting-started page describes this flow.)
2. In the app: WhatsApp -> API Setup. Meta attaches a **test phone number** and a **test WhatsApp Business Account**. Note the **Phone number ID** and **WhatsApp Business Account ID** shown there (not secret, but keep them out of chat anyway).
3. Same page, "To": add **your own phone number** as a recipient and confirm the code WhatsApp sends you. That is the test allow-list; only these numbers can receive from the test number.
4. App settings -> Basic -> **App secret** -> Show. You will type it into a hidden prompt later; do not copy it anywhere else.
5. Access token: for a same-day test, "Generate access token" on API Setup (24 h). For anything longer: Business settings -> System users -> add -> generate token with `business_management`, `whatsapp_business_messaging`, `whatsapp_business_management`, with the test WABA assigned.
6. WhatsApp Manager -> Message templates: create `order_update` (Utility, English `en`, body in section 1 with sample values). Optional now: `cart_reminder`, `promo`. Wait for **Approved**.
-> Tell me "Block A done" (no values).

**Block B: point DEV at real Meta (5 minutes)**
7. In your own terminal: `./supabase/scripts/dev-whatsapp-real-mode.ps1 -Ref lffnmycocbtpyvntccbg -Mode real` and answer the hidden prompts (app secret, token, phone-number id, WABA id). It refuses malformed values and prints only names.
8. It prints the **Callback URL** and **Verify token**. In the app: WhatsApp -> Configuration -> Webhook -> Edit: paste both -> **Verify and save** (this is the real webhook challenge). Then "Webhook fields" -> **Subscribe** `messages`.
-> Tell me "Block B done" and whether "Verify and save" succeeded.

**Block C: the round trip (15 minutes, your phone in hand)**
9. `./supabase/tests/p6_meta_real_dev_roundtrip.ps1 -Ref lffnmycocbtpyvntccbg`; hidden prompts again; it asks you to (a) open the template message it sends, (b) send `hello from the tester`, (c) optionally give a number NOT on the allow-list to provoke a real failure, (d) send `STOP`, then `START`.
10. Tell me "Block C done"; I read the stored results (whatsapp_messages, whatsapp_events, captured payloads, Edge logs) and fill the table below. Then `-Mode mock` to restore DEV.

## 7. Results (filled from the real run only)
| Check | Result |
|---|---|
| Real webhook challenge (Meta "Verify and save") | NOT RUN |
| X-Hub-Signature-256 over real bytes with the real app secret (R4) | NOT RUN |
| Real inbound message stored (R3) | NOT RUN |
| wamid persistence and real duplicate replay (R4) | NOT RUN |
| Fast acknowledgement from Edge logs (R3b) | NOT RUN |
| Asynchronous processing (reply produced after the 200) | NOT RUN |
| Outbound template accepted with a real wamid (R2) | NOT RUN |
| Delivery and read callbacks (R2) | NOT RUN |
| Failure handling with a real Meta error code (R5) | NOT RUN |
| STOP / START from a real phone (R6) | NOT RUN |
Real Meta readiness is claimed only if every row is PASS.
