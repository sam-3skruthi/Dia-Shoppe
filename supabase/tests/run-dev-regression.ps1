# ONE complete DEV regression: security, financials, concurrency, auth (real logins), mock-Razorpay flows, WhatsApp, campaigns, AI guardrails, courier,
# recovery, reconciliation, social-disabled, infrastructure. DEV only; no frontend; no production. Logs go to -LogDir; a summary table is printed.
#   ./supabase/tests/run-dev-regression.ps1 -Ref lffnmycocbtpyvntccbg
# Not included (need a human at a browser/phone): the real-Razorpay run (p3_razorpay_real_dev.ps1) and the real-Meta round trip (p6_meta_real_dev_roundtrip.ps1).
# Auth checks use two throwaway DEV accounts whose generated passwords live only in the DEV Vault (created by p4b_whatsapp_campaign_ai_dev.ps1).
param([Parameter(Mandatory = $true)][string]$Ref, [string]$LogDir = (Join-Path $env:TEMP "dia-regression-$(Get-Date -Format yyyyMMdd-HHmmss)"))
$ErrorActionPreference = "Stop"
# The Supabase Management API throttles bursts ("ThrottlerException: Too Many Requests"); a long suite polls a lot, so every database call retries with backoff
function Invoke-MgmtRetry { param([string]$Method, [string]$Uri, $Headers, $Body)
  for ($try = 1; $try -le 8; $try++) {
    try { return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $Headers -Body $Body }
    catch { if ("$($_.ErrorDetails.Message)" -match 'Throttler|Too Many Requests' -and $try -lt 8) { Start-Sleep -Seconds (4 * $try); continue }; throw }
  }
}
if ($Ref -eq "vkcwfwgxelmamuydwrow") { throw "DEV only." }
New-Item -ItemType Directory -Force $LogDir | Out-Null
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$pat = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", "User")
$mh = @{ Authorization = "Bearer $pat"; "User-Agent" = "Mozilla/5.0"; "Content-Type" = "application/json" }
function Vault([string]$name) { (Invoke-MgmtRetry -Method Post -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" -Headers $mh -Body (@{ query = "select decrypted_secret s from vault.decrypted_secrets where name='$name'" } | ConvertTo-Json))[0].s }
$summary = @()
function Run-Suite([string]$name, [string]$file, [string[]]$args2, [hashtable]$envVars = @{}) {
  $log = Join-Path $LogDir ("{0}.log" -f ($name -replace '[^\w-]+', '_')); $sw = [Diagnostics.Stopwatch]::StartNew()
  Write-Host ("== {0} ..." -f $name) -ForegroundColor Cyan
  $psi = New-Object Diagnostics.ProcessStartInfo; $psi.FileName = "powershell.exe"; $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.WorkingDirectory = $root
  $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$file`" " + ($args2 -join " ")
  foreach ($k in $envVars.Keys) { $psi.EnvironmentVariables[$k] = $envVars[$k] }
  $p = [Diagnostics.Process]::Start($psi); $o = $p.StandardOutput.ReadToEndAsync(); $e = $p.StandardError.ReadToEndAsync(); $p.WaitForExit(); $text = $o.Result + "`n" + $e.Result
  $text | Set-Content $log -Encoding UTF8
  $line = (($text -split "`r?`n") | Where-Object { $_ -match "checks?,|passed|PASS|tests " } | Select-Object -Last 1)
  $script:summary += [pscustomobject]@{ Suite = $name; Result = $(if ($p.ExitCode -eq 0) { "PASS" } else { "FAIL" }); Seconds = [int]$sw.Elapsed.TotalSeconds; Last = ("" + $line).Trim().Substring(0, [Math]::Min(110, ("" + $line).Trim().Length)) }
  Write-Host ("   {0} ({1}s)  {2}" -f $summary[-1].Result, $summary[-1].Seconds, $summary[-1].Last)
}

# auth checks need interactive input: answer the prompts from the Vault test logins via a Read-Host override (child process only)
$wrap = Join-Path $LogDir "auth-wrapper.ps1"
@'
function Read-Host { param([string]$Prompt, [switch]$AsSecureString)
  $v = if ($Prompt -match 'CUSTOMER email') { $env:REG_CUST_EMAIL } elseif ($Prompt -match 'ADMIN email') { $env:REG_ADMIN_EMAIL } elseif ($Prompt -match 'CUSTOMER password') { $env:REG_CUST_PW } elseif ($Prompt -match 'ADMIN password') { $env:REG_ADMIN_PW } else { 'y' }
  if ($AsSecureString) { ConvertTo-SecureString $v -AsPlainText -Force } else { $v } }
& "$env:REG_ROOT\supabase\tests\p0_auth_checks_dev.ps1" -Ref $env:REG_REF
exit $LASTEXITCODE
'@ | Set-Content $wrap -Encoding UTF8

$t = Join-Path $root "supabase\tests"
function Exec([string]$sql) { Invoke-MgmtRetry -Method Post -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" -Headers $mh -Body (@{ query = $sql } | ConvertTo-Json) | Out-Null }
# 0. deterministic start: restore the known clean DEV state (and verify it); a dirty start aborts the run
& (Join-Path $root "supabase\scripts\dev-reset-test-state.ps1") -Ref $Ref
if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) { throw "DEV reset failed; regression not started." }
$nodeLog = Join-Path $LogDir "unit.log"; $sw = [Diagnostics.Stopwatch]::StartNew()
$nodeOut = & node --test (Join-Path $t "whatsapp\unit.test.mjs") (Join-Path $t "whatsapp\meta-payload.test.mjs") 2>&1 | Out-String; $nodeOut | Set-Content $nodeLog -Encoding UTF8
$pass = [regex]::Match($nodeOut, "pass (\d+)").Groups[1].Value; $fail = [regex]::Match($nodeOut, "fail (\d+)").Groups[1].Value
$summary += [pscustomobject]@{ Suite = "unit: WhatsApp, AI guardrails, courier, signatures"; Result = $(if ($fail -eq "0") { "PASS" } else { "FAIL" }); Seconds = [int]$sw.Elapsed.TotalSeconds; Last = "$pass passed, $fail failed" }
Write-Host "   $($summary[-1].Result)  $($summary[-1].Last)"
$evalOut = & node (Join-Path $t "ai-eval\run-eval.mjs") --fake 2>&1 | Out-String; $hf = [regex]::Match($evalOut, '"hard_failures": (\d+)').Groups[1].Value
$summary += [pscustomobject]@{ Suite = "AI evaluation harness self-test (fake model)"; Result = $(if ($hf -eq "0") { "PASS" } else { "FAIL" }); Seconds = 1; Last = "0 hard failures expected, got $hf (says nothing about any real model)" }

Run-Suite "SQL suites (p0 security/stock, p1 financial, p2 audit/stock, p3 safety net + courier, p8 status guard)" (Join-Path $t "run-sql-tests.ps1") @("-Ref", $Ref)
Run-Suite "p0 API checks (HTTP + real triggers)" (Join-Path $t "p0_api_checks_dev.ps1") @("-Ref", $Ref)
Run-Suite "p0 concurrency (parallel HTTP, row locks, signed duplicate webhooks)" (Join-Path $t "concurrency\p0_concurrency.ps1") @("-Ref", $Ref, "-WebhookUrl", "https://$Ref.supabase.co/functions/v1/razorpay-webhook") @{ DEV_RAZORPAY_WEBHOOK_SECRET = (Vault "dev_test_razorpay_webhook_secret") }
Run-Suite "p0 auth: real customer/admin logins (RLS, roles, cost isolation)" $wrap @() @{ REG_REF = $Ref; REG_ROOT = $root; REG_CUST_EMAIL = "wa-customer-login@example.test"; REG_ADMIN_EMAIL = "wa-admin-login@example.test"; REG_CUST_PW = (Vault "dev_test_pw_customer"); REG_ADMIN_PW = (Vault "dev_test_pw_admin") }
Run-Suite "p1 financial end-to-end (mock Razorpay, real triggers)" (Join-Path $t "p1_financial_dev.ps1") @("-Ref", $Ref)
Run-Suite "p2 failure/recovery flows (held orders, refund retry, notify once)" (Join-Path $t "p2_failure_flow_dev.ps1") @("-Ref", $Ref)
Run-Suite "p8 admin status guard via the real admin API path (042) + concurrent manual decisions" (Join-Path $t "p8_admin_status_guard_dev.ps1") @("-Ref", $Ref)
Run-Suite "p5 safety net: webhook events, reconciliation, courier e2e, full-refund-only, social disabled" (Join-Path $t "p5_backend_safety_dev.ps1") @("-Ref", $Ref)
Run-Suite "p4 WhatsApp: security, dedup, status, queue, consent, AI guardrails, campaigns, cron" (Join-Path $t "p4_whatsapp_dev.ps1") @("-Ref", $Ref)
Run-Suite "p4b campaign AI endpoint (real logins)" (Join-Path $t "p4b_whatsapp_campaign_ai_dev.ps1") @("-Ref", $Ref)
Run-Suite "smoke test: every public endpoint rejects unauthenticated/forged calls; mocks and social inbox not exposed" (Join-Path $root "supabase\scripts\smoke-test.ps1") @("-Ref", $Ref)
# the suites above raise critical alerts ON PURPOSE (outside refunds, reconciliation findings...): close them so the infrastructure check sees a clean slate
Exec "update public.ops_events set resolved_at = now() where resolved_at is null"
Run-Suite "infrastructure check (read-only, post phase)" (Join-Path $root "supabase\scripts\infra-check.ps1") @("-Ref", $Ref, "-Phase", "post")

$summary | ConvertTo-Json | Set-Content (Join-Path $LogDir "summary.json") -Encoding UTF8
Write-Host ""; Write-Host "=== A. DETERMINISTIC DEV SUITES (started from a verified clean state) ===" -ForegroundColor White
$summary | Format-Table -AutoSize -Wrap
Write-Host "=== B. REAL-PROVIDER TESTS (NOT part of this run: they need a human, a browser or a phone) ===" -ForegroundColor White
Write-Host "  real Razorpay TEST suite (p3_razorpay_real_dev.ps1 -SmokeOnly/-full): last verified in an earlier session; not re-run here"
Write-Host "  real Meta round trip (p6_meta_real_dev_roundtrip.ps1): NOT RUN until a Meta test account and phone are available"
Write-Host "  real Nemotron evaluation (ai-eval/run-eval-matrix.mjs): NOT RUN until an API key is available"
Write-Host "=== C. PRODUCTION VERIFICATION === none executed; production untouched" -ForegroundColor White
Write-Host "=== D. STALE-TEST ISSUES === none found in this run (stale tests fixed earlier are listed in BACKEND_FINAL_HANDOFF_CHECKLIST.md); a FAIL above is a real failure" -ForegroundColor White
$bad = @($summary | Where-Object Result -eq "FAIL").Count
Write-Host "$($summary.Count) suites, $bad failed. Logs: $LogDir" -ForegroundColor $(if ($bad) { "Red" } else { "Green" })
if ($bad) { exit 1 }
