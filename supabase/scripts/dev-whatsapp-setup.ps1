# DEV ONLY: prepares the DEV project for the P1 WhatsApp tests. Idempotent; prints secret NAMES only, never values.
#   ./supabase/scripts/dev-whatsapp-setup.ps1 -Ref lffnmycocbtpyvntccbg
# 1. Vault test secret for the Meta app secret (so the test runner can sign requests; generated once, never printed)
# 2. DEV function secrets: Graph API + AI endpoint point at the DEV mock (supabase/dev-only/whatsapp-mock), never at Meta
# 3. DEV-only mock call log table (zz_wa_mock_calls) - tests only, not a migration
# 5. DEV test secrets for the financial safety net and the courier backend (reconcile hook, courier provider "canonical" + token)
# 4. deploys the WhatsApp functions + the mock (the mock folder is copied in only for the deploy) and removes retired functions
param([Parameter(Mandatory = $true)][string]$Ref, [switch]$SkipDeploy)
$ErrorActionPreference = "Stop"
if ($Ref -eq "vkcwfwgxelmamuydwrow") { throw "DEV only: refusing to touch PRODUCTION." }
$pat = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", "User"); if (-not $pat) { throw "SUPABASE_ACCESS_TOKEN is not set (user environment variable)." }
$env:SUPABASE_ACCESS_TOKEN = $pat
$h = @{ Authorization = "Bearer $pat"; "User-Agent" = "Mozilla/5.0"; "Content-Type" = "application/json" }
function Q([string]$sql) { try { Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" -Headers $h -Body ([Text.Encoding]::UTF8.GetBytes((@{ query = $sql } | ConvertTo-Json -Depth 3))) } catch { throw ("SQL error: " + (($_.ErrorDetails.Message -replace '(sbp_|eyJ)[A-Za-z0-9._-]+', '<redacted>') -replace '\s+', ' ')) } }
function Rand([int]$n) { -join ((48..57) + (97..122) | Get-Random -Count $n | ForEach-Object { [char]$_ }) }
$base = "https://$Ref.supabase.co"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$sb = Join-Path $root "supabase"

# 1. vault test secret (the value is only ever read back by the test runner, from the DEV database)
Q "do `$`$ begin if not exists (select 1 from vault.secrets where name='dev_test_meta_app_secret') then perform vault.create_secret('$(Rand 40)', 'dev_test_meta_app_secret', 'DEV only: Meta app secret used by the WhatsApp tests'); end if; end `$`$" | Out-Null
$metaSecret = (Q "select decrypted_secret s from vault.decrypted_secrets where name='dev_test_meta_app_secret'")[0].s
Q "do `$`$ begin if not exists (select 1 from vault.secrets where name='dev_test_whatsapp_verify_token') then perform vault.create_secret('dev-verify-$(Rand 16)', 'dev_test_whatsapp_verify_token', 'DEV only: Meta webhook verify token used by the WhatsApp tests'); end if; end `$`$" | Out-Null
$verifyToken = (Q "select decrypted_secret s from vault.decrypted_secrets where name='dev_test_whatsapp_verify_token'")[0].s
$worker = (Q "select decrypted_secret s from vault.decrypted_secrets where name='hook_whatsapp_worker'")[0].s
Q "do `$`$ begin if not exists (select 1 from vault.secrets where name='dev_test_courier_token') then perform vault.create_secret('cour-$(Rand 30)', 'dev_test_courier_token', 'DEV only: courier webhook test token'); end if; end `$`$" | Out-Null
$courierTok = (Q "select decrypted_secret s from vault.decrypted_secrets where name='dev_test_courier_token'")[0].s
$reconHook = (Q "select decrypted_secret s from vault.decrypted_secrets where name='hook_reconcile'")[0].s
$existing = @{}; foreach ($s in (Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$Ref/secrets" -Headers $h)) { $existing[$s.name] = $true }
if (-not $existing["ENVIRONMENT"]) { throw "ENVIRONMENT=dev is not set on this project: the mocks would refuse to answer. Run dev-bootstrap first." }

# 2. function secrets (DEV values only)
$kv = [ordered]@{
  META_APP_SECRET_WHATSAPP = $metaSecret
  WHATSAPP_VERIFY_TOKEN    = $verifyToken
  WHATSAPP_TOKEN           = "dev-mock-token"
  WHATSAPP_PHONE_ID        = "100000000000001"
  WHATSAPP_WABA_ID         = "200000000000002"
  WHATSAPP_API_BASE        = "$base/functions/v1/whatsapp-mock/v21.0"
  WHATSAPP_WORKER_SECRET   = $worker
  AI_PROVIDER              = "mock"
  AI_MODEL                 = "mock-model"
  AI_BASE_URL              = "$base/functions/v1/whatsapp-mock/ai/v1"
  AI_API_KEY               = "dev-mock-key"
  AI_TIMEOUT_MS            = "3000"
  AI_DAILY_CAP_USD         = "5"
  AI_MAX_PER_CUSTOMER_HOUR = "30"
  AI_PRICE_IN_PER_MTOK     = "1"
  AI_PRICE_OUT_PER_MTOK    = "2"
  STORE_URL                = "https://diashoppe.example"
  STORE_PHONES             = "9876500000"
  STORE_EMAILS             = "care@diashoppe.example"
  RECONCILE_HOOK_SECRET    = $reconHook
  COURIER_PROVIDER         = "canonical"
  COURIER_AUTH_MODE        = "token"
  COURIER_WEBHOOK_TOKEN    = $courierTok
}
$body = @($kv.Keys | ForEach-Object { @{ name = $_; value = [string]$kv[$_] } }) | ConvertTo-Json -Depth 3
if ($kv.Count -eq 1) { $body = "[$body]" }
Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$Ref/secrets" -Headers $h -Body ([Text.Encoding]::UTF8.GetBytes($body)) | Out-Null
"secrets set (names): $($kv.Keys -join ', ')"

# 3. mock call log (DEV tests only)
Q "create table if not exists public.zz_wa_mock_calls (id bigserial primary key, at timestamptz not null default now(), kind text not null, to_phone text, body jsonb, outcome text); alter table public.zz_wa_mock_calls enable row level security; revoke all on public.zz_wa_mock_calls from anon, authenticated; grant all on public.zz_wa_mock_calls to service_role; grant usage on sequence public.zz_wa_mock_calls_id_seq to service_role;" | Out-Null
"mock call log ready"

if ($SkipDeploy) { "deploy skipped"; return }

# 4. deploy
$mockDir = Join-Path $sb "functions\whatsapp-mock"
New-Item -ItemType Directory -Force $mockDir | Out-Null
Copy-Item (Join-Path $sb "dev-only\whatsapp-mock\index.ts") (Join-Path $mockDir "index.ts") -Force
$rzpMockDir = Join-Path $sb "functions\razorpay-mock"
New-Item -ItemType Directory -Force $rzpMockDir | Out-Null
Copy-Item (Join-Path $sb "dev-only\razorpay-mock\index.ts") (Join-Path $rzpMockDir "index.ts") -Force
try {
  $names = @("whatsapp-inbound", "whatsapp-worker", "whatsapp-sync-templates", "whatsapp-campaign", "whatsapp-remind", "whatsapp-mock", "razorpay-mock", "razorpay-reconcile", "razorpay-webhook", "process-refund", "courier-webhook", "social-webhook", "social-reply")
  Push-Location $root
  $prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  $o = & npx --yes supabase functions deploy @names --project-ref $Ref --use-api --no-verify-jwt 2>&1 | Out-String
  $code = $LASTEXITCODE; $ErrorActionPreference = $prev; Pop-Location
  if ($code -ne 0) { throw ("functions deploy FAILED: " + (($o -replace '(sbp_|eyJ)[A-Za-z0-9._-]+', '<redacted>') -replace '\s+', ' ')) }
  "deployed: $($names -join ', ')"
} finally { Remove-Item $mockDir -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item $rzpMockDir -Recurse -Force -ErrorAction SilentlyContinue }

foreach ($slug in @("whatsapp-notify", "whatsapp-broadcast")) {       # retired by P1 (replaced by the queue and the campaign backend)
  try { Invoke-RestMethod -Method Delete -Uri "https://api.supabase.com/v1/projects/$Ref/functions/$slug" -Headers $h | Out-Null; "removed retired function: $slug" } catch { "retired function not present: $slug" }
}
