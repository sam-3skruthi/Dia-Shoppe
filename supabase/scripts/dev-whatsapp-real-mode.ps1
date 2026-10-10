# Switch the DEV project between the WhatsApp/AI MOCK and a REAL Meta test setup. DEV ONLY. YOU run this; nothing secret is printed or stored.
#   ./supabase/scripts/dev-whatsapp-real-mode.ps1 -Ref lffnmycocbtpyvntccbg -Mode check   names present/absent + the callback URL and verify token to paste into Meta
#   ./supabase/scripts/dev-whatsapp-real-mode.ps1 -Ref lffnmycocbtpyvntccbg -Mode real    asks (hidden input) for the Meta app secret, access token, phone-number id, WABA id
#   ./supabase/scripts/dev-whatsapp-real-mode.ps1 -Ref lffnmycocbtpyvntccbg -Mode mock    back to the DEV mock (all mock-based tests work again)
# In real mode: WHATSAPP_API_BASE is REMOVED (the sender talks to graph.facebook.com), AI_PROVIDER=disabled (customer messages get the safe human-handoff
# reply, no model is called), and WHATSAPP_CAPTURE_PAYLOADS=1 so verified real webhook bodies + their signature headers are kept in a DEV-only table.
# Use a Meta TEST WhatsApp Business account / test phone number, never a production number. The token is sent only to Supabase as a function secret.
param([Parameter(Mandatory = $true)][string]$Ref, [Parameter(Mandatory = $true)][ValidateSet("check", "real", "mock")][string]$Mode)
$ErrorActionPreference = "Stop"
if ($Ref -eq "vkcwfwgxelmamuydwrow") { throw "DEV only: refusing to touch PRODUCTION." }
$pat = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", "User"); if (-not $pat) { throw "SUPABASE_ACCESS_TOKEN is not set (user environment variable)." }
$h = @{ Authorization = "Bearer $pat"; "User-Agent" = "Mozilla/5.0"; "Content-Type" = "application/json" }
function Get-PlainText([System.Security.SecureString]$s) { (New-Object System.Management.Automation.PSCredential('x', $s)).GetNetworkCredential().Password }
function Q([string]$sql) { try { Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" -Headers $h -Body ([Text.Encoding]::UTF8.GetBytes((@{ query = $sql } | ConvertTo-Json -Depth 3))) } catch { throw ("SQL error: " + (($_.ErrorDetails.Message -replace '(sbp_|eyJ)[A-Za-z0-9._-]+', '<redacted>') -replace '\s+', ' ')) } }
function Secrets { $m = @{}; foreach ($s in (Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$Ref/secrets" -Headers $h)) { $m[$s.name] = $s.value }; $m }
function Sha([string]$s) { [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($s))).Replace("-", "").ToLower() }
$cb = "https://$Ref.supabase.co/functions/v1/whatsapp-inbound"
$verifyTok = (Q "select decrypted_secret s from vault.decrypted_secrets where name='dev_test_whatsapp_verify_token'")[0].s

if ($Mode -eq "check") {
  $s = Secrets
  foreach ($n in "META_APP_SECRET_WHATSAPP", "WHATSAPP_TOKEN", "WHATSAPP_PHONE_ID", "WHATSAPP_WABA_ID", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_WORKER_SECRET", "WHATSAPP_API_BASE", "WHATSAPP_CAPTURE_PAYLOADS", "AI_PROVIDER") { "{0,-28} {1}" -f $n, $(if ($s.ContainsKey($n)) { "set" } else { "not set" }) }
  "mode: " + $(if ($s.ContainsKey("WHATSAPP_API_BASE")) { "MOCK (WHATSAPP_API_BASE is set)" } else { "REAL Meta (no API base override)" })
  "Callback URL (Meta -> Configuration -> Webhook): $cb"
  "Verify token to paste into Meta (DEV only value): $verifyTok"
  return
}

if ($Mode -eq "mock") {
  $root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
  & (Join-Path $PSScriptRoot "dev-whatsapp-setup.ps1") -Ref $Ref -SkipDeploy | Out-Null
  Invoke-RestMethod -Method Delete -Uri "https://api.supabase.com/v1/projects/$Ref/secrets" -Headers $h -Body '["WHATSAPP_CAPTURE_PAYLOADS"]' | Out-Null
  "DEV is back on the mock (Graph API + AI). Capture disabled."; return
}

# ---- real
$secret = (Get-PlainText (Read-Host "Meta APP SECRET (App settings -> Basic -> App secret)" -AsSecureString)).Trim()
$token = (Get-PlainText (Read-Host "WhatsApp ACCESS TOKEN (a permanent system-user token; a 24 h temporary token also works for a short test)" -AsSecureString)).Trim()
$phoneId = (Read-Host "WhatsApp PHONE NUMBER ID (digits)").Trim(); $waba = (Read-Host "WhatsApp BUSINESS ACCOUNT ID (digits)").Trim()
if ($secret -notmatch '^[0-9a-f]{32}$') { throw "The Meta app secret is normally 32 hex characters; this does not look like one. Nothing was changed." }
if ($token.Length -lt 60 -or $token -match '\s') { throw "The access token looks too short or contains whitespace (a stray paste character breaks every send). Nothing was changed." }
if ($phoneId -notmatch '^\d{10,20}$' -or $waba -notmatch '^\d{10,20}$') { throw "Phone number id and WABA id are numeric (10-20 digits). Nothing was changed." }
Q "create table if not exists public.whatsapp_payload_captures (id bigserial primary key, at timestamptz not null default now(), signature text, body text not null); alter table public.whatsapp_payload_captures enable row level security; revoke all on public.whatsapp_payload_captures from anon, authenticated; grant all on public.whatsapp_payload_captures to service_role; grant usage on sequence public.whatsapp_payload_captures_id_seq to service_role;" | Out-Null
$body = @(@{ name = "META_APP_SECRET_WHATSAPP"; value = $secret }, @{ name = "WHATSAPP_TOKEN"; value = $token }, @{ name = "WHATSAPP_PHONE_ID"; value = $phoneId }, @{ name = "WHATSAPP_WABA_ID"; value = $waba },
  @{ name = "WHATSAPP_VERIFY_TOKEN"; value = $verifyTok }, @{ name = "AI_PROVIDER"; value = "disabled" }, @{ name = "WHATSAPP_CAPTURE_PAYLOADS"; value = "1" }) | ConvertTo-Json -Depth 3
Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$Ref/secrets" -Headers $h -Body ([Text.Encoding]::UTF8.GetBytes($body)) | Out-Null
$secret = $null; $token = $null; $body = $null
try { Invoke-RestMethod -Method Delete -Uri "https://api.supabase.com/v1/projects/$Ref/secrets" -Headers $h -Body '["WHATSAPP_API_BASE"]' | Out-Null } catch { }
Q "update ai_circuit set state='closed', consecutive_failures=0, opened_until=null where id=1" | Out-Null
$s = Secrets
if ($s.ContainsKey("WHATSAPP_API_BASE")) { throw "WHATSAPP_API_BASE is still set: the sender would still talk to the mock. Remove it in the Supabase dashboard (Edge Functions -> Secrets)." }
"DEV is now in REAL-META mode (names only): META_APP_SECRET_WHATSAPP, WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_WABA_ID, WHATSAPP_VERIFY_TOKEN set; WHATSAPP_API_BASE removed; AI_PROVIDER=disabled; payload capture on."
""
"In Meta (App dashboard -> WhatsApp -> Configuration -> Webhook) set:"
"  Callback URL : $cb"
"  Verify token : $verifyTok"
"  then 'Verify and save', and subscribe the field: messages"
"Then run: ./supabase/tests/p6_meta_real_dev_roundtrip.ps1 -Ref $Ref"
"When finished: ./supabase/scripts/dev-whatsapp-real-mode.ps1 -Ref $Ref -Mode mock"
