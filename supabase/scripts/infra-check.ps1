# READ-ONLY infrastructure check for a Supabase project (DEV rehearsal or PRODUCTION pre/post-deploy). Only SELECTs and GET listings: it
# changes nothing, so it is safe with a read-only-style credential. It never prints a secret (function-secret NAMES only).
#   ./supabase/scripts/infra-check.ps1 -Ref <project-ref> -Phase pre     before the rollout: what is missing / blocking
#   ./supabase/scripts/infra-check.ps1 -Ref <project-ref> -Phase post    after the rollout: is everything in place
# Exit code 1 if any FAIL. WARN/INFO need a human decision but do not fail the run.
param([Parameter(Mandatory = $true)][string]$Ref, [ValidateSet("pre", "post")][string]$Phase = "pre")
$ErrorActionPreference = "Stop"
# The Supabase Management API throttles bursts ("ThrottlerException: Too Many Requests"); a long suite polls a lot, so every database call retries with backoff
function Invoke-MgmtRetry { param([string]$Method, [string]$Uri, $Headers, $Body)
  for ($try = 1; $try -le 8; $try++) {
    try { return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $Headers -Body $Body }
    catch { if ("$($_.ErrorDetails.Message)" -match 'Throttler|Too Many Requests' -and $try -lt 8) { Start-Sleep -Seconds (4 * $try); continue }; throw }
  }
}
$pat = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", "User"); if (-not $pat) { $pat = $env:SUPABASE_ACCESS_TOKEN }
if (-not $pat) { throw "SUPABASE_ACCESS_TOKEN is not set." }
$h = @{ Authorization = "Bearer $pat"; "User-Agent" = "Mozilla/5.0"; "Content-Type" = "application/json" }
function Q([string]$sql) { try { Invoke-MgmtRetry -Method Post -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" -Headers $h -Body ([Text.Encoding]::UTF8.GetBytes((@{ query = $sql } | ConvertTo-Json -Depth 3))) } catch { $null } }
function Val([string]$sql, [string]$col) { $r = Q $sql; if ($null -eq $r) { return $null }; $a = @($r | Where-Object { $null -ne $_ }); if ($a.Count -eq 0) { return $null }; $a[0].$col }
$out = @(); function Rpt([string]$level, [string]$what, [string]$detail = "") { $script:out += [pscustomobject]@{ Level = $level; Check = $what; Detail = $detail }; $c = @{ PASS = "Green"; FAIL = "Red"; WARN = "Yellow"; INFO = "Cyan" }[$level]; Write-Host ("{0,-4} {1}  {2}" -f $level, $what, $detail) -ForegroundColor $c }
$proj = Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$Ref" -Headers $h
Write-Host "Project $Ref ($($proj.name)), status $($proj.status), region $($proj.region), phase: $Phase" -ForegroundColor White

# ---- extensions and Vault
$ext = @((Q "select extname from pg_extension") | ForEach-Object { $_.extname })
$avail = @((Q "select name from pg_available_extensions where name in ('pg_cron','pg_net','supabase_vault')") | ForEach-Object { $_.name })
foreach ($e in "pg_cron", "pg_net", "supabase_vault") { if ($ext -contains $e) { Rpt PASS "extension $e installed" } elseif ($avail -contains $e) { Rpt FAIL "extension $e is available but NOT installed" "enable it (Dashboard -> Database -> Extensions) BEFORE the migrations; without pg_cron the migrations succeed with only a warning and no jobs exist" } else { Rpt FAIL "extension $e is not available on this project" } }
$pu = Val "select count(*) c from vault.secrets where name='project_url'" "c"
if ($pu -ge 1) { Rpt PASS "Vault secret project_url exists" } else { Rpt FAIL "Vault secret project_url is missing" "select vault.create_secret('https://$Ref.supabase.co','project_url'); without it every trigger-driven call silently does nothing" }
foreach ($v in "hook_process_refund", "hook_order_email", "hook_refund_notify", "hook_whatsapp_worker", "hook_reconcile") { $n = Val "select count(*) c from vault.secrets where name='$v'" "c"; if ($n -ge 1) { Rpt PASS "Vault hook secret $v exists" } else { Rpt $(if ($Phase -eq "pre") { "INFO" } else { "FAIL" }) "Vault hook secret $v missing" "created by the migrations that introduce it" } }

# ---- schema markers per migration (033-042)
$markers = [ordered]@{ "033 private.project_url()" = "select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and proname='project_url'";
  "034 payments / refund_requests / settle_payment" = "select 1 from information_schema.tables where table_schema='public' and table_name='refund_requests'";
  "035 refund recovery (processing_since)" = "select 1 from information_schema.columns where table_name='refund_requests' and column_name='processing_since'";
  "036 ops_events" = "select 1 from information_schema.tables where table_schema='public' and table_name='ops_events'";
  "037 audit chain (audit_chain_status)" = "select 1 from pg_proc where proname='audit_chain_status'";
  "038 customer_notifications" = "select 1 from information_schema.tables where table_name='customer_notifications'";
  "039 whatsapp queue (wa_enqueue)" = "select 1 from pg_proc where proname='wa_enqueue'";
  "040 safety net (settle_refund_event)" = "select 1 from pg_proc where proname='settle_refund_event'";
  "041 courier backend (courier_apply_event)" = "select 1 from pg_proc where proname='courier_apply_event'";
  "042 admin status guard (trg_orders_status_guard)" = "select 1 from pg_trigger where tgname='trg_orders_status_guard'" }
foreach ($k in $markers.Keys) { if (Q $markers[$k]) { Rpt $(if ($Phase -eq "post") { "PASS" } else { "INFO" }) "migration present: $k" } else { Rpt $(if ($Phase -eq "post") { "FAIL" } else { "INFO" }) "migration NOT applied: $k" } }

# ---- scheduled jobs (8 expected after the full rollout)
$jobs = @(); try { $jobs = @((Q "select jobname, active from cron.job") | Where-Object { $_.active } | ForEach-Object { $_.jobname }) } catch { }
$need = "expire-pending-orders", "requeue-stuck-refunds", "cancel-empty-orders", "retry-failed-refunds", "whatsapp-worker", "whatsapp-sync-templates", "razorpay-reconcile", "audit-verify"
foreach ($j in $need) { if ($jobs -contains $j) { Rpt PASS "cron job active: $j" } else { Rpt $(if ($Phase -eq "post") { "FAIL" } else { "INFO" }) "cron job missing: $j" } }

# ---- function inventory (verify_jwt must be false for webhooks/hooks) and secret NAMES
$fnList = @((Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$Ref/functions" -Headers $h) | ForEach-Object { $_ })
$expectFn = "create-razorpay-order", "verify-payment", "razorpay-webhook", "razorpay-reconcile", "process-refund", "refund-notify", "order-email", "courier-webhook", "whatsapp-inbound", "whatsapp-worker", "whatsapp-sync-templates", "whatsapp-campaign", "whatsapp-remind", "social-webhook", "social-reply"
foreach ($f in $expectFn) { $x = $fnList | Where-Object slug -eq $f; if (-not $x) { Rpt $(if ($Phase -eq "post") { "FAIL" } else { "INFO" }) "function not deployed: $f" } elseif ($x.verify_jwt -and $f -notin "whatsapp-campaign", "whatsapp-remind", "social-reply", "create-razorpay-order") { Rpt FAIL "function $f has verify_jwt=true" "webhooks/hooks need --no-verify-jwt" } else { Rpt PASS "function deployed: $f" "v$($x.version) verify_jwt=$($x.verify_jwt)" } }
foreach ($f in "whatsapp-mock", "razorpay-mock") { if ($fnList | Where-Object slug -eq $f) { Rpt $(if ($proj.name -match "dev|test" -or $Ref -eq "lffnmycocbtpyvntccbg") { "INFO" } else { "FAIL" }) "mock function $f is deployed" "must NOT exist in production" } }
foreach ($old in "whatsapp-notify", "whatsapp-broadcast") { if ($fnList | Where-Object slug -eq $old) { Rpt $(if ($Phase -eq "post") { "FAIL" } else { "WARN" }) "retired function still deployed: $old" "remove after cutover" } }
$sec = @(Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$Ref/secrets" -Headers $h) | ForEach-Object { $_.name }
$must = "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "REFUND_HOOK_SECRET", "REFUND_NOTIFY_HOOK_SECRET", "ORDER_EMAIL_HOOK_SECRET", "RESEND_API_KEY", "RECONCILE_HOOK_SECRET",
  "META_APP_SECRET_WHATSAPP", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_TOKEN", "WHATSAPP_PHONE_ID", "WHATSAPP_WABA_ID", "WHATSAPP_WORKER_SECRET", "STORE_URL", "STORE_PHONES"
foreach ($n in $must) { if ($sec -contains $n) { Rpt PASS "secret set: $n" } else { Rpt $(if ($Phase -eq "post") { "FAIL" } else { "INFO" }) "secret missing: $n" } }
foreach ($n in "WHATSAPP_API_BASE", "WHATSAPP_CAPTURE_PAYLOADS") { if ($sec -contains $n) { Rpt $(if ($Ref -eq "lffnmycocbtpyvntccbg") { "INFO" } else { "FAIL" }) "secret $n is set" "must NOT be set in production (points the sender at a mock / stores payloads)" } }
if ($sec -contains "RAZORPAY_API_BASE") { Rpt WARN "secret RAZORPAY_API_BASE is set" "must be unset or https://api.razorpay.com in production" }
foreach ($n in "SOCIAL_INBOX_ENABLED") { if ($sec -contains $n) { Rpt WARN "secret $n is set" "the social inbox is a deferred feature; leave it unset until it is implemented and signed" } else { Rpt PASS "social inbox stays disabled (SOCIAL_INBOX_ENABLED not set)" } }
if ($sec -contains "AI_PROVIDER") { Rpt INFO "AI_PROVIDER is set" "default is disabled; no model is approved yet" } else { Rpt PASS "AI disabled (AI_PROVIDER not set)" }
if ($sec -contains "COURIER_PROVIDER") { Rpt INFO "COURIER_PROVIDER is set" } else { Rpt INFO "COURIER_PROVIDER not set" "courier statuses are recorded but change no order until a provider mapping exists" }

# ---- data safety
$bk = $null; try { $bk = Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$Ref/database/backups" -Headers $h } catch { }
if ($bk -and @($bk.backups).Count -gt 0) { Rpt PASS "automatic backups listed" "latest: $(@($bk.backups)[0].inserted_at)" } else { Rpt $(if ($Phase -eq "pre") { "FAIL" } else { "WARN" }) "NO automatic backup is listed (pitr_enabled=$($bk.pitr_enabled))" "take and verify a manual export before touching the database" }
$pend = Val "select count(*) c from orders where status='pending' and payment_method='online'" "c"
if ($pend -eq 0) { Rpt PASS "no pending online orders (the 30-minute expiry cannot cancel a customer mid-payment)" } else { Rpt $(if ($Phase -eq "pre") { "FAIL" } else { "WARN" }) "$pend pending online order(s)" "wait until none, or accept the risk explicitly" }
if ($Phase -eq "post") {
  $crit = Val "select count(*) c from ops_events where resolved_at is null and severity='critical'" "c"
  if ($null -ne $crit) { if ($crit -eq 0) { Rpt PASS "no open critical alerts" } else { Rpt FAIL "$crit open critical alert(s)" "read ops_events" } }
  $rr = Val "select count(*) c from reconciliation_runs" "c"; if ($null -ne $rr) { Rpt $(if ($rr -ge 1) { "PASS" } else { "WARN" }) "reconciliation has run $rr time(s)" "trigger one by hand right after deployment" }
  $an = Val "select count(*) c from audit_anchors" "c"; if ($null -ne $an) { Rpt $(if ($an -ge 1) { "PASS" } else { "WARN" }) "audit checkpoints stored: $an" "run private.audit_verify_job() once and save head_seq/head_hash off-system" }
}
$fails = @($out | Where-Object Level -eq "FAIL").Count
Write-Host ""; Write-Host ("{0} FAIL, {1} WARN, {2} PASS, {3} INFO" -f $fails, @($out | Where-Object Level -eq "WARN").Count, @($out | Where-Object Level -eq "PASS").Count, @($out | Where-Object Level -eq "INFO").Count) -ForegroundColor $(if ($fails) { "Red" } else { "Green" })
if ($fails) { exit 1 }
