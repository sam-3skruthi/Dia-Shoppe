# Production social-webhook containment: findings and change for approval

**Nothing has been changed in production.** Everything below was found with read-only checks (function metadata and deployed bundle download, SELECT queries, Edge-log queries) on 2026-10-09 and re-checked on 2026-10-10. The change in section 4 waits for your explicit approval.

## 1. What is deployed (read-only findings)
| Item | Finding |
|---|---|
| `social-webhook` | version **7**, ACTIVE, `verify_jwt=false`, deployed 2026-07-22. The deployed bundle contains the `SOCIAL_VERIFY_TOKEN` GET handshake and `req.json()` + `upsert` into `social_messages`, and **no `x-hub-signature` check and no app secret**. So any anonymous POST shaped like a Meta event is accepted and its comments/DMs are written to `social_messages`. **Confirmed open.** |
| `social-reply` | version 8, ACTIVE, `verify_jwt=false`; checks the caller's login and admin role itself (identical to the committed source); posts to the Graph API with `META_PAGE_TOKEN` and marks the message replied even if the post failed |
| Secrets | `SOCIAL_VERIFY_TOKEN` set; **no** Meta app secret for social, **no** `SOCIAL_INBOX_ENABLED`, and `META_PAGE_TOKEN` is not listed among the social secret names |
| Data | `social_messages`: **0 rows** (nothing has ever been stored). `social_accounts`: 2 rows (connection flags only; no tokens stored in the table) |
| Traffic (Edge logs, last 7 days) | 2 calls to `social-webhook`, both on 2026-10-02 from `curl` in India (a GET 403 and a 2-byte POST 200): an earlier manual probe, **no Meta traffic and no abuse seen**. No calls to `social-reply` |
| Who depends on it | Only the admin "Social" page in the frontend (`adminSocial.js` reads `social_accounts`/`social_messages` and calls `social-reply`). With 0 messages there is nothing to reply to. **No live workflow depends on either function.** |
| Side finding (low) | `anon` holds `SELECT, TRUNCATE, REFERENCES, TRIGGER` and `authenticated` holds full DML + `TRUNCATE` on `social_messages` and `social_accounts` (RLS restricts rows to admins; TRUNCATE is not reachable through the REST API). Worth revoking in the rollout's grant clean-up; **not** part of this change |

## 2. Decision: disable, do not replace with an authenticated version yet
Disabling breaks nothing that is live (section 1), and the inbox is deferred. The repository version of both functions already does exactly this: **503 "social inbox is disabled"** for every request unless `SOCIAL_INBOX_ENABLED=1` **and** `META_APP_SECRET_SOCIAL` are set; when enabled, every POST must carry a valid `X-Hub-Signature-256` over the exact raw body.

### Validated in DEV (2026-10-09)
| Probe (DEV) | Result |
|---|---|
| disabled: GET handshake, unsigned POST, forged signature, valid signature | **503** for all; nothing stored |
| `social-reply` while disabled | **503** |
| enabled (temporary DEV secrets): unsigned POST | **401** |
| enabled: forged signature | **401** |
| enabled: valid signature over a modified body | **401** |
| enabled: valid signature | **200**, one row stored (then removed) |
| disabled again: even a valid signed call | **503** |
| `smoke-test.ps1 -Only social` (DEV) | 3 / 3 PASS |

## 3. Review package (re-verified read-only on 2026-10-10)
| Item | Value / evidence |
|---|---|
| Target project | **`vkcwfwgxelmamuydwrow`** = "Dia Shoppe", ap-southeast-2 (production; the frontend `.env` points here). DEV is `lffnmycocbtpyvntccbg` "Dia Shoppe DEV", ap-south-1 (`GET /v1/projects`) |
| Deployed now | `social-webhook` **v7** (updated 2026-07-22 07:19 UTC), `social-reply` **v8** (2026-08-19 17:55 UTC); both ACTIVE, `verify_jwt=false` (`GET /v1/projects/vkcwfwgxelmamuydwrow/functions`) |
| Deployed code = git `29669e4` | The deployed bundles (downloaded read-only 2026-10-09; versions unchanged since) were compared with `git show 29669e4:supabase/functions/<fn>/index.ts`, ignoring formatting and TypeScript types: **identical for both functions**. `29669e4` is also what `HEAD` (`b12aaa7`) contains for these two files |
| Proposed code | Working-tree versions, **not committed yet**: `social-webhook/index.ts` (SHA-256 `7E0FD2B79D3F7A79...`), `social-reply/index.ts` (`D55E69204F835835...`), plus the new shared `_shared/meta-signature.ts` (`1ADA745FCECAE7AC...`, untracked) that `social-webhook` imports |
| Production secrets (names only) | `SOCIAL_VERIFY_TOKEN` present; **`SOCIAL_INBOX_ENABLED` absent, `META_APP_SECRET_SOCIAL` absent, `META_PAGE_TOKEN` absent**. So after deployment both functions answer **503 to every request** |

### Code diff (`git diff 29669e4 -- supabase/functions/social-webhook/index.ts supabase/functions/social-reply/index.ts`)
- `social-reply`: **+2 lines** right after the OPTIONS pre-flight: `if (Deno.env.get("SOCIAL_INBOX_ENABLED") !== "1") return 503 {"error":"social inbox is disabled"}`. Nothing else changes.
- `social-webhook`: rewritten (72 -> 59 lines):
  - first statement: `if (!ENABLED || !APP_SECRET) return 503 "social inbox is disabled"` (`ENABLED` = `SOCIAL_INBOX_ENABLED === "1"`, `APP_SECRET` = `META_APP_SECRET_SOCIAL`);
  - GET handshake unchanged in meaning (`hub.mode=subscribe` and matching `SOCIAL_VERIFY_TOKEN` -> challenge, else 403); other methods -> 405;
  - POST: reads the **raw bytes**, `verifyMetaSignature(raw, X-Hub-Signature-256, APP_SECRET)` (HMAC-SHA256, constant-time compare, from `_shared/meta-signature.ts`) **before** parsing; invalid -> 401;
  - parsing and the idempotent `upsert` into `social_messages` are the same fields as before; an error now returns **500** "temporary failure" (no internal message) instead of 200 with the error text.
- The full diff is printed by the command above; it was shown in the 2026-10-10 session.

## 4. The production change (needs your explicit approval; not run)
Prerequisites, in order:
1. **Commit C1** (the three files above plus the rollback stubs and script, section 6), so production matches a commit (needs your separate approval).
2. A temporary production-write access token, revoked afterwards.
```powershell
# from the repository root, at the approved commit; deploys ONLY these two functions (no --prune)
npx supabase functions deploy social-webhook social-reply --project-ref vkcwfwgxelmamuydwrow --use-api --no-verify-jwt
```
- Do **not** set `SOCIAL_INBOX_ENABLED` or `META_APP_SECRET_SOCIAL` in production.
- Touches nothing else: no migration, no secret, no other function, no Meta setting. (Migrations 034-042 stay undeployed; they are unrelated to this change.)
- Alternative with the same effect (404 instead of 503): `npx supabase functions delete social-webhook --project-ref vkcwfwgxelmamuydwrow` (and `social-reply`). I recommend the 503 version.

## 5. Verification after the change (non-destructive)
```powershell
# 1. versions: expect social-webhook 8, social-reply 9, ACTIVE, verify_jwt False; every other function unchanged
$h=@{Authorization="Bearer $([Environment]::GetEnvironmentVariable('SUPABASE_ACCESS_TOKEN','User'))";"User-Agent"="Mozilla/5.0"}
(Invoke-RestMethod -Uri https://api.supabase.com/v1/projects/vkcwfwgxelmamuydwrow/functions -Headers $h) | % { $_ } | Sort-Object slug | Format-Table slug,version,status,verify_jwt
# 2. probes: expect 3 / 3 PASS (GET 503, unsigned POST 503, social-reply 503). Before the change this FAILS on the unsigned POST (200)
./supabase/scripts/smoke-test.ps1 -Ref vkcwfwgxelmamuydwrow -Only social
```
3. `select count(*) from social_messages` stays 0 (read-only query).
4. Edge logs for `social-webhook` show only 503s.
5. The admin Social page still loads (it only reads tables). Its reply button returns an error, which is expected for a deferred feature.

## 6. Rollback (never restores the unsigned endpoint)
**Not supported:** redeploying git `29669e4` (today's v7/v8). That code accepts unsigned POSTs and writes them to `social_messages`.

**Rollback = fixed 503 stubs.** Use it only if the containment release itself misbehaves, for example a boot error, unexpected 5xx, or a broken shared import.

| File | Purpose | SHA-256 |
|---|---|---|
| `supabase/rollback/social-disabled/social-webhook/index.ts` | `Deno.serve(() => 503 "social inbox is disabled")`. No imports, no secrets, no database | `367be14d9368e704…20708` |
| `supabase/rollback/social-disabled/social-reply/index.ts` | same, JSON body. No Graph API call | `eb76090a37bfd34f…abd7` |
| `supabase/scripts/social-rollback-to-stub.ps1` | asks you to type the ref, builds a throwaway folder in `%TEMP%` (config.toml + the two stubs), deploys **only** those two functions with `--workdir`, then deletes the folder. The working tree is not modified | `abbba5c79900279d…3c4d1` |

Local check on 2026-10-10 (Node with a `Deno.serve` shim; nothing deployed): both stubs answer 503 to GET, POST and OPTIONS.

```powershell
./supabase/scripts/social-rollback-to-stub.ps1 -Ref vkcwfwgxelmamuydwrow      # production: only with your explicit approval
```
**Verification after a rollback** (the same expectations as the containment, because the endpoint stays closed):
1. Function list: `social-webhook` and `social-reply` versions incremented by one, ACTIVE, `verify_jwt=false`; no other function changed.
2. `./supabase/scripts/smoke-test.ps1 -Ref vkcwfwgxelmamuydwrow -Only social` -> **3 / 3 PASS** (GET 503, unsigned POST 503, social-reply 503).
3. `select count(*) from social_messages` stays 0; Edge logs show only 503s.

**Last resort** (if even the stub cannot be deployed): `npx supabase functions delete social-webhook --project-ref vkcwfwgxelmamuydwrow` and the same for `social-reply`. Both URLs then answer 404, so check 2 reports FAIL on the 503 expectation; confirm the 404s by hand instead.

**Rehearsal:** the stub rollback can be rehearsed on DEV (`-Ref lffnmycocbtpyvntccbg`, then redeploy the repository version with `dev-whatsapp-setup.ps1`). Not done: it is a function deployment and needs your approval.
