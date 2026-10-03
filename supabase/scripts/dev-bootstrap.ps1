# Builds / refreshes the DEV Supabase project. Idempotent. Refuses the production ref.
#   ./dev-bootstrap.ps1 -Ref <dev-project-ref>
# Needs SUPABASE_ACCESS_TOKEN (user env var) with access to the DEV project.
# Never prints a secret. Test-only secrets are generated here and kept in the DEV
# project's own Vault (dev_test_*), never on disk, never copied from production.
param([Parameter(Mandatory = $true)][string]$Ref, [switch]$SkipDb)   # -SkipDb: for a token without database WRITE permission
$ErrorActionPreference = "Stop"
$PROD = "vkcwfwgxelmamuydwrow"
if ($Ref -eq $PROD) { throw "Refusing to bootstrap PRODUCTION." }
$sb = Split-Path $PSScriptRoot -Parent                 # .../supabase
$token = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", "User"); $env:SUPABASE_ACCESS_TOKEN = $token
$cli = "$env:APPDATA\npm\supabase.cmd"
$h = @{ Authorization = "Bearer $token"; "User-Agent" = "Mozilla/5.0"; "Content-Type" = "application/json" }
function Q([string]$sql) {
  $sql = [regex]::Replace($sql, '[^\x00-\x7F]', '-')
  $b = [Text.Encoding]::UTF8.GetBytes((@{ query = $sql } | ConvertTo-Json -Depth 3))
  Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" -Headers $h -Body $b
}
# Failure summary that can never contain a value: only a known permission/status phrase.
function Safe([string]$o) {
  if ($o -match 'Missing required permission\(s\):\s*([a-z_,\s"\[\]]+)') { return "missing permission: " + ($Matches[1] -replace '[^a-z_,]', '') }
  if ($o -match 'status (\d{3})') { return "HTTP status $($Matches[1])" }
  "see CLI exit code (output suppressed to protect secrets)"
}
function Rand([int]$bytes = 24) { $b = New-Object byte[] $bytes; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | % { $_.ToString("x2") }) -join "" }

# 1. access
$p = Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$Ref" -Headers $h
"1. project '$($p.name)' status=$($p.status) region=$($p.region)"
if ($p.status -ne "ACTIVE_HEALTHY") { throw "DEV project not healthy yet" }

if (-not $SkipDb) {
# 2. environment identity for the DB triggers
Q "select vault.create_secret('https://$Ref.supabase.co', 'project_url') where not exists (select 1 from vault.secrets where name = 'project_url')" | Out-Null
"2. project_url stored in Vault"

# 3. migrations, in order, each recorded once
Q "create table if not exists public.zz_dev_migrations(name text primary key, applied_at timestamptz default now())" | Out-Null
$done = @((Q "select name from public.zz_dev_migrations") | % { $_.name })
foreach ($f in Get-ChildItem "$sb\migrations\*.sql" | Sort-Object Name) {
  if ($done -contains $f.Name) { continue }
  try { Q (Get-Content $f.FullName -Raw) | Out-Null }
  catch { throw "MIGRATION FAILED: $($f.Name): $($_.ErrorDetails.Message)" }
  Q "insert into public.zz_dev_migrations(name) values ('$($f.Name)')" | Out-Null
  "3. applied $($f.Name)"
}

# 4. mock-Razorpay ledger (DEV only)
Q "create table if not exists public.zz_mock_refunds(payment_id text primary key, amount bigint, refund_id text, rr_id text, at timestamptz default now()); alter table public.zz_mock_refunds add column if not exists rr_id text; alter table public.zz_mock_refunds enable row level security; grant all on public.zz_mock_refunds to service_role; create table if not exists public.zz_mock_emails(id bigserial primary key, to_address text, subject text, at timestamptz default now()); alter table public.zz_mock_emails enable row level security; grant all on public.zz_mock_emails to service_role; create table if not exists public.zz_mock_attempts(payment_id text primary key, n int); alter table public.zz_mock_attempts enable row level security; grant all on public.zz_mock_attempts to service_role; grant usage on all sequences in schema public to service_role" | Out-Null

# 5. inert fixture rows (no passwords: these users cannot sign in)
foreach ($u in @(@("dev-customer@example.test", "Dev", "Customer", "9000000001"), @("dev-admin@example.test", "Dev", "Admin", "9000000002"))) {
  Q "insert into auth.users(id,email,raw_user_meta_data,aud,role,created_at,updated_at) select gen_random_uuid(),'$($u[0])','{""first_name"":""$($u[1])"",""last_name"":""$($u[2])"",""phone"":""$($u[3])""}'::jsonb,'authenticated','authenticated',now(),now() where not exists (select 1 from auth.users where email='$($u[0])')" | Out-Null
}
Q "update public.user_profiles set role='admin' where email='dev-admin@example.test'" | Out-Null
"5. fixture users: customer + admin (inert)"

} else { "2-5. database steps skipped (-SkipDb); relying on what is already in DEV" }

# 6. secrets (names only are ever printed)
$have = @(& $cli secrets list --project-ref $Ref -o json | ConvertFrom-Json | % { $_.name })
function EnsureVaultTest([string]$name) {
  if (-not $SkipDb) { Q "select vault.create_secret('$(Rand)', '$name') where not exists (select 1 from vault.secrets where name='$name')" | Out-Null }
  $v = Q "select decrypted_secret s from vault.decrypted_secrets where name='$name'"
  if (-not $v) { throw "Vault secret $name is missing (run without -SkipDb with a write-capable token)" }
  $v[0].s
}
$kv = @{}
$kv["RAZORPAY_KEY_SECRET"]     = EnsureVaultTest "dev_test_razorpay_key_secret"
$kv["RAZORPAY_WEBHOOK_SECRET"] = EnsureVaultTest "dev_test_razorpay_webhook_secret"
$kv["COURIER_WEBHOOK_TOKEN"]   = EnsureVaultTest "dev_test_courier_token"
$kv["WHATSAPP_VERIFY_TOKEN"]   = EnsureVaultTest "dev_test_whatsapp_verify"
$kv["SOCIAL_VERIFY_TOKEN"]     = EnsureVaultTest "dev_test_social_verify"
$kv["RAZORPAY_KEY_ID"]         = "rzp_test_devmock"
$kv["RAZORPAY_API_BASE"]       = "https://$Ref.supabase.co/functions/v1/razorpay-mock"
$kv["ENVIRONMENT"]             = "dev"
$kv["RESEND_API_BASE"]         = "https://$Ref.supabase.co/functions/v1/razorpay-mock"   # DEV mail never leaves the project
$kv["RESEND_API_KEY"]          = "re_dev_mock_not_a_real_key"
$hooks = Q "select name, decrypted_secret s from vault.decrypted_secrets where name in ('hook_whatsapp_notify','hook_order_email','hook_process_refund','hook_refund_notify')"
foreach ($r in $hooks) {
  switch ($r.name) { "hook_whatsapp_notify" { $kv["WHATSAPP_HOOK_SECRET"] = $r.s } "hook_order_email" { $kv["ORDER_EMAIL_HOOK_SECRET"] = $r.s } "hook_process_refund" { $kv["REFUND_HOOK_SECRET"] = $r.s } "hook_refund_notify" { $kv["REFUND_NOTIFY_HOOK_SECRET"] = $r.s } }
}
$setArgs = @(); foreach ($k in $kv.Keys) { $setArgs += "$k=$($kv[$k])" }
$ErrorActionPreference = "Continue"; $o = & $cli secrets set @setArgs --project-ref $Ref 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { throw "secrets set FAILED: $(Safe $o)" }
"6. secrets set (names): $($kv.Keys -join ', ')"
"   NOT set on purpose: WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, ANTHROPIC_API_KEY (RESEND_API_KEY is a dummy pointing at the DEV mock), META_PAGE_TOKEN, POSTHOG_*"

# 7. functions (+ the DEV-only mock, copied in only for the deploy)
$mock = "$sb\functions\razorpay-mock"
New-Item -ItemType Directory -Force $mock | Out-Null
Copy-Item "$sb\dev-only\razorpay-mock\index.ts" "$mock\index.ts" -Force
try {
  $names = (Get-ChildItem "$sb\functions" -Directory | % { $_.Name })
  Push-Location (Split-Path $sb -Parent)
  $ErrorActionPreference = "Continue"; $o = & $cli functions deploy @names --project-ref $Ref --use-api --no-verify-jwt 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw "functions deploy FAILED: $(Safe $o)" }
  Pop-Location
} finally { Remove-Item $mock -Recurse -Force }
"7. deployed: $($names -join ', ')"

# 8. summary
"8. cron jobs: " + (((Q "select jobname from cron.job") | % { $_.jobname }) -join ", ")
"   done."
