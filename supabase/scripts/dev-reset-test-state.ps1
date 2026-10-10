# DEV ONLY: puts the DEV project back to a known clean state for the regression, so stale rows or flags from earlier runs cannot contaminate a result.
#   ./supabase/scripts/dev-reset-test-state.ps1 -Ref lffnmycocbtpyvntccbg
# Removes ONLY test-generated data (fixture orders/payments/refunds/messages/consent for the test phone prefix and *@example.test fixture emails, mock call logs,
# alerts, reconciliation/courier/failure/refund-event logs), resets flags (queue not paused, AI circuit closed, today's AI spend zero, templates approved) and
# then VERIFIES the state is clean (non-zero exit if not). Append-only audit tables (financial_audit, audit_anchors, consent history) are never touched by design:
# the suites assert on deltas for those. Real fixtures that must exist (dev-customer/dev-admin users, throwaway login accounts, categories) are kept.
param([Parameter(Mandatory = $true)][string]$Ref)
$ErrorActionPreference = "Stop"
# The Supabase Management API throttles bursts ("ThrottlerException: Too Many Requests"); a long suite polls a lot, so every database call retries with backoff
function Invoke-MgmtRetry { param([string]$Method, [string]$Uri, $Headers, $Body)
  for ($try = 1; $try -le 8; $try++) {
    try { return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $Headers -Body $Body }
    catch { if ("$($_.ErrorDetails.Message)" -match 'Throttler|Too Many Requests' -and $try -lt 8) { Start-Sleep -Seconds (4 * $try); continue }; throw }
  }
}
if ($Ref -eq "vkcwfwgxelmamuydwrow") { throw "DEV only: refusing to touch PRODUCTION." }
$pat = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", "User"); if (-not $pat) { throw "SUPABASE_ACCESS_TOKEN is not set." }
$h = @{ Authorization = "Bearer $pat"; "User-Agent" = "Mozilla/5.0"; "Content-Type" = "application/json" }
function Q([string]$sql) { try { Invoke-MgmtRetry -Method Post -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" -Headers $h -Body ([Text.Encoding]::UTF8.GetBytes((@{ query = $sql } | ConvertTo-Json -Depth 3))) } catch { throw ("SQL error: " + (($_.ErrorDetails.Message -replace '(sbp_|eyJ)[A-Za-z0-9._-]+', '<redacted>') -replace '\s+', ' ')) } }
$proj = Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$Ref" -Headers $h
if ($proj.name -notmatch "DEV|dev") { throw "Project name '$($proj.name)' does not look like DEV; refusing." }
$testOrders = "select id from public.orders where shipping_email ~ '^(wa|sn|real|zzf|zzc|zzp)[a-z0-9_-]*@example\.test$' or shipping_email like 'real%@example.test' or razorpay_order_id like 'order\_zz%' or razorpay_order_id like 'order\_sn\_%' or razorpay_order_id like 'order\_f%' or razorpay_order_id like 'order\_s%'"
Q @"
-- 1. money-side test rows (children first)
delete from public.refund_events where payment_id in (select id from public.payments where order_id in ($testOrders) or razorpay_payment_id like 'pay\_sn\_%');
delete from public.refund_requests where payment_id in (select id from public.payments where razorpay_payment_id like 'pay\_sn\_%');
delete from public.payments where razorpay_payment_id like 'pay\_sn\_%';      -- includes orphan payments (order_id null) created by the reconciliation test
delete from public.refund_requests where order_id in ($testOrders);
delete from public.payments where order_id in ($testOrders);
delete from public.payment_failures where order_id in ($testOrders) or razorpay_payment_id like 'pay\_sn\_%' or razorpay_payment_id like 'pay\_failed%';
delete from public.order_items where order_id in ($testOrders);
delete from public.orders where id in ($testOrders);
delete from public.products where sku like 'ZZ-%' and not exists (select 1 from public.order_items oi where oi.product_id = products.id);
-- 2. WhatsApp / campaign / consent test rows (test phone prefix 91988000)
delete from public.whatsapp_campaigns where name like 'ZZ WA%';
delete from public.whatsapp_messages where phone_e164 like '91988000%' or phone_number like '91988000%' or idempotency_key like 'test:%' or idempotency_key like 'real:%';
delete from public.whatsapp_events where wamid like 'wamid.T%' or wamid like 'wamid.LOST%' or wamid like 'wamid.UNKNOWN%' or wamid like 'wamid.MOCK%';
update public.user_profiles set whatsapp_marketing_opt_in = false where email like 'wa-%@example.test';   -- (its trigger records consent: so this runs BEFORE the consent delete)
delete from public.whatsapp_consent where phone_e164 like '91988000%';
-- 3. logs of the new subsystems, alerts, mock ledgers
delete from public.reconciliation_runs; delete from public.courier_events;
delete from public.courier_status_map where provider not in ('canonical');
delete from public.ops_events;
delete from public.ai_usage_daily;
do `$`$ begin
  if to_regclass('public.zz_wa_mock_calls') is not null then execute 'truncate public.zz_wa_mock_calls'; end if;
  if to_regclass('public.zz_mock_payments') is not null then execute 'truncate public.zz_mock_payments'; end if;
  if to_regclass('public.zz_mock_refunds') is not null then execute 'truncate public.zz_mock_refunds'; end if;
  if to_regclass('public.zz_mock_attempts') is not null then execute 'truncate public.zz_mock_attempts'; end if;
  if to_regclass('public.zz_mock_emails') is not null then execute 'truncate public.zz_mock_emails'; end if;
end `$`$;
-- 4. flags
select cron.alter_job(jobid, active := true) from cron.job where not active;      -- a suite that died mid-run may have left the paused worker job inactive
update public.ai_circuit set state = 'closed', consecutive_failures = 0, opened_until = null, last_error = null where id = 1;
update public.site_settings set value = '{"paused": false}'::jsonb where key = 'whatsapp_queue';
update public.whatsapp_templates set status = 'approved', enabled = true where name in ('order_update', 'cart_reminder', 'promo');
"@ | Out-Null

# verify clean
$checks = [ordered]@{
  "test orders"                 = "select count(*) c from public.orders where shipping_email like 'wa-%@example.test' or shipping_email like 'sn-%@example.test' or shipping_email like 'real%@example.test'"
  "test payments (pay_sn/pay_f*)" = "select count(*) c from public.payments where razorpay_payment_id like 'pay\_sn\_%' or razorpay_payment_id like 'pay\_f%'"
  "test WhatsApp messages"      = "select count(*) c from public.whatsapp_messages where phone_e164 like '91988000%'"
  "test consent rows"           = "select count(*) c from public.whatsapp_consent where phone_e164 like '91988000%'"
  "ZZ products"                 = "select count(*) c from public.products where sku like 'ZZ-%'"
  "ops_events (any)"            = "select count(*) c from public.ops_events"
  "open critical alerts"        = "select count(*) c from public.ops_events where resolved_at is null and severity='critical'"
  "reconciliation runs"         = "select count(*) c from public.reconciliation_runs"
  "AI spend rows"               = "select count(*) c from public.ai_usage_daily"
  "queue paused"                = "select count(*) c from public.site_settings where key='whatsapp_queue' and (value->>'paused')::boolean"
  "AI circuit open"             = "select count(*) c from public.ai_circuit where state <> 'closed'"
  "unapproved core templates"   = "select count(*) c from public.whatsapp_templates where name in ('order_update','cart_reminder','promo') and (status <> 'approved' or not enabled)"
  "cron jobs inactive"          = "select count(*) c from cron.job where not active"
}
$dirty = 0
foreach ($k in $checks.Keys) { $c = [int](Q $checks[$k])[0].c; if ($c -ne 0) { $dirty++; Write-Host ("DIRTY {0}: {1}" -f $k, $c) -ForegroundColor Red } }
if ($dirty) { throw "DEV is not clean after the reset ($dirty check(s) failed)." }
$audit = (Q "select count(*) c from public.financial_audit")[0].c; $hist = (Q "select count(*) c from public.whatsapp_consent_history")[0].c
Write-Host "DEV test state is clean (13 checks). Append-only baselines kept: financial_audit=$audit rows, consent history=$hist rows (suites use deltas)." -ForegroundColor Green
