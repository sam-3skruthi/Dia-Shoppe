# Non-destructive HTTP smoke test of a deployed project: proves every public endpoint REJECTS unauthenticated or forged calls and that
# DEV-only mocks and the deferred social inbox are not exposed. Every probe uses a missing/wrong credential, so none of them can change
# data. Safe for production after a rollout (it creates nothing, sends nothing, spends nothing). The one thing it cannot prove is that the
# ACCEPT path works: that is the manual low-value live order and the signed provider tests in the rollout procedure.
#   ./supabase/scripts/smoke-test.ps1 -Ref <project-ref>
param([Parameter(Mandatory = $true)][string]$Ref, [string]$Only = "")   # -Only <regex>: run only probes whose name matches (e.g. -Only social)
$ErrorActionPreference = "Stop"
$pat = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", "User"); if (-not $pat) { $pat = $env:SUPABASE_ACCESS_TOKEN }
$h = @{ Authorization = "Bearer $pat"; "User-Agent" = "Mozilla/5.0" }
$anon = ((Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$Ref/api-keys" -Headers $h) | Where-Object { $_.name -eq "anon" -or $_.type -eq "publishable" } | Select-Object -First 1).api_key
$fn = "https://$Ref.supabase.co/functions/v1"; $rest = "https://$Ref.supabase.co/rest/v1"
$out = @(); function T([string]$name, [int[]]$expect, [string]$method, [string]$url, $headers = @{}, [string]$body = "") {
  if ($Only -and $name -notmatch $Only) { return }
  $code = 0
  try { $a = @{ Method = $method; Uri = $url; Headers = $headers; UseBasicParsing = $true; TimeoutSec = 40 }; if ($body) { $a.Body = [Text.Encoding]::UTF8.GetBytes($body); $a.ContentType = "application/json" }; $code = [int](Invoke-WebRequest @a).StatusCode }
  catch { if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode } }
  $ok = $expect -contains $code; $script:out += [pscustomobject]@{ Ok = $ok; Probe = $name; Got = $code; Expected = ($expect -join "/") }
  Write-Host ("{0,-4} {1}  (HTTP {2}, expected {3})" -f $(if ($ok) { "PASS" } else { "FAIL" }), $name, $code, ($expect -join "/")) -ForegroundColor $(if ($ok) { "Green" } else { "Red" })
}
$j = '{"x":1}'
# payment + refund + email hooks
T "razorpay-webhook: forged signature rejected" @(400) POST "$fn/razorpay-webhook" @{ "x-razorpay-signature" = "deadbeef" } '{"event":"payment.captured","payload":{}}'
T "razorpay-webhook: no signature rejected" @(400) POST "$fn/razorpay-webhook" @{} '{"event":"payment.captured","payload":{}}'
T "process-refund: no hook secret rejected" @(401) POST "$fn/process-refund" @{} '{"refund_request_id":1}'
T "refund-notify: no hook secret rejected" @(401) POST "$fn/refund-notify" @{} '{"refund_request_id":1,"kind":"refund_processed"}'
T "order-email: no hook secret rejected" @(401) POST "$fn/order-email" @{} '{"order_id":1}'
T "razorpay-reconcile: no secret / no admin rejected" @(401, 403) POST "$fn/razorpay-reconcile" @{} '{}'
T "verify-payment: no login rejected" @(401) POST "$fn/verify-payment" @{} $j
T "create-razorpay-order: no login rejected" @(401) POST "$fn/create-razorpay-order" @{} $j
# courier
T "courier-webhook: no token rejected" @(401) POST "$fn/courier-webhook" @{} '{"awb":"x","status":"delivered"}'
T "courier-webhook: wrong token rejected" @(401) POST "$fn/courier-webhook" @{ "x-api-key" = "definitely-wrong" } '{"awb":"x","status":"delivered"}'
# whatsapp
T "whatsapp-inbound: GET with a wrong verify token rejected" @(403) GET "$fn/whatsapp-inbound?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x"
T "whatsapp-inbound: unsigned POST rejected" @(401, 500) POST "$fn/whatsapp-inbound" @{} '{"object":"whatsapp_business_account","entry":[]}'
T "whatsapp-inbound: forged signature rejected" @(401, 500) POST "$fn/whatsapp-inbound" @{ "x-hub-signature-256" = ("sha256=" + ("0" * 64)) } '{"object":"whatsapp_business_account","entry":[]}'
T "whatsapp-worker: no hook secret rejected" @(401) POST "$fn/whatsapp-worker" @{} '{}'
T "whatsapp-sync-templates: no secret / no admin rejected" @(401, 403) POST "$fn/whatsapp-sync-templates" @{} '{}'
T "whatsapp-campaign: no admin rejected" @(401, 403) POST "$fn/whatsapp-campaign" @{} '{"action":"generate_copy"}'
T "whatsapp-remind: no admin rejected" @(401, 403) POST "$fn/whatsapp-remind" @{} '{"user_id":"x"}'
# deferred social inbox must not be exposed
T "social-webhook: GET answers disabled (503)" @(503) GET "$fn/social-webhook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=c"
T "social-webhook: UNSIGNED POST answers disabled (503), stores nothing" @(503, 401) POST "$fn/social-webhook" @{} '{"object":"instagram","entry":[{"id":"1","changes":[{"field":"comments","value":{"id":"smoke","text":"x"}}]}]}'
T "social-reply: disabled (503)" @(503, 401, 403) POST "$fn/social-reply" @{} '{"message_id":1,"text":"x"}'
# retired / DEV-only functions must not answer
foreach ($f in "whatsapp-notify", "whatsapp-broadcast") { T "$f is retired (not deployed)" @(404) POST "$fn/$f" @{} '{}' }
foreach ($f in "whatsapp-mock", "razorpay-mock") { T "$f (DEV mock) is not deployed or refuses" @(404) GET "$fn/$f/ping" }
# data API: anonymous users see nothing of the financial/ops/WhatsApp tables
if (-not $Only -or "anon cannot read" -match $Only) { foreach ($t in "payments", "refund_requests", "financial_audit", "ops_events", "reconciliation_runs", "whatsapp_messages", "whatsapp_consent", "courier_events", "product_costs") {
  $r = $null; $code = 0; try { $resp = Invoke-WebRequest -UseBasicParsing -Uri "$rest/${t}?select=*&limit=1" -Headers @{ apikey = $anon; Authorization = "Bearer $anon" }; $code = [int]$resp.StatusCode; $r = $resp.Content } catch { if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode } }
  $ok = ($code -in 401, 403, 404) -or ($code -eq 200 -and $r.Trim() -eq "[]"); $out += [pscustomobject]@{ Ok = $ok; Probe = "anon cannot read $t"; Got = $code; Expected = "401/403/404 or empty" }
  Write-Host ("{0,-4} anon cannot read {1}  (HTTP {2}{3})" -f $(if ($ok) { "PASS" } else { "FAIL" }), $t, $code, $(if ($code -eq 200) { ", body=" + $r.Substring(0, [Math]::Min(30, $r.Length)) } else { "" })) -ForegroundColor $(if ($ok) { "Green" } else { "Red" })
}}

$bad = @($out | Where-Object { -not $_.Ok }).Count
Write-Host ""; Write-Host "$($out.Count) probes, $bad failed." -ForegroundColor $(if ($bad) { "Red" } else { "Green" })
if ($bad) { exit 1 }
