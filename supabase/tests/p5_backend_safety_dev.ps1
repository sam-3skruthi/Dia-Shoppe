# DEV function-level tests for: Razorpay webhook events (payment.failed, refund.*), daily reconciliation, courier webhook end to end,
# full-refund-only enforcement in process-refund, social endpoints disabled, scheduled jobs. Razorpay is the DEV MOCK (no real money).
#   ./supabase/tests/p5_backend_safety_dev.ps1 -Ref lffnmycocbtpyvntccbg
# Needs migrations 040/041 and ./supabase/scripts/dev-whatsapp-setup.ps1 (deploys the functions and sets the DEV test secrets). DEV only.
param([Parameter(Mandatory = $true)][string]$Ref)
$ErrorActionPreference = "Stop"
# The Supabase Management API throttles bursts ("ThrottlerException: Too Many Requests"); a long suite polls a lot, so every database call retries with backoff
function Invoke-MgmtRetry { param([string]$Method, [string]$Uri, $Headers, $Body)
  for ($try = 1; $try -le 8; $try++) {
    try { return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $Headers -Body $Body }
    catch { if ("$($_.ErrorDetails.Message)" -match 'Throttler|Too Many Requests' -and $try -lt 8) { Start-Sleep -Seconds (4 * $try); continue }; throw }
  }
}
if ($Ref -eq "vkcwfwgxelmamuydwrow") { throw "DEV only." }
$pat = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", "User")
$mh = @{ Authorization = "Bearer $pat"; "User-Agent" = "Mozilla/5.0"; "Content-Type" = "application/json" }
function Q([string]$sql) { try { Invoke-MgmtRetry -Method Post -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" -Headers $mh -Body ([Text.Encoding]::UTF8.GetBytes((@{ query = $sql } | ConvertTo-Json -Depth 3))) } catch { throw ("SQL error: " + (($_.ErrorDetails.Message -replace '(sbp_|eyJ)[A-Za-z0-9._-]+', '<redacted>') -replace '\s+', ' ')) } }
function Row([string]$sql) { $r = Q $sql; if ($null -eq $r) { return $null }; $a = @($r | Where-Object { $null -ne $_ }); if ($a.Count -eq 0) { return $null }; $a[0] }
function Val([string]$sql, [string]$col) { $r = Row $sql; if ($null -eq $r) { return $null }; $r.$col }
$fn = "https://$Ref.supabase.co/functions/v1"
$results = @(); function Check([string]$n, [bool]$ok, $d = "") { $script:results += [pscustomobject]@{ Test = $n; Result = $(if ($ok) { "PASS" } else { "FAIL" }); Detail = [string]$d }; Write-Host ("{0,-4} {1}" -f $(if ($ok) { "ok" } else { "FAIL" }), $n) -ForegroundColor $(if ($ok) { "DarkGreen" } else { "Red" }) }
function Wait-For([scriptblock]$cond, [int]$secs = 60) { for ($i = 0; $i -lt $secs; $i++) { if (& $cond) { return $true }; Start-Sleep 1 }; $false }
function HmacHex([string]$text, [string]$secret) { $h = New-Object System.Security.Cryptography.HMACSHA256 (, [Text.Encoding]::UTF8.GetBytes($secret)); ($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($text)) | ForEach-Object { $_.ToString("x2") }) -join "" }
function Call([string]$method, [string]$url, $headers = @{}, [string]$body = $null) {
  try { $a = @{ Method = $method; Uri = $url; Headers = $headers; UseBasicParsing = $true; TimeoutSec = 90 }; if ($body) { $a.Body = [Text.Encoding]::UTF8.GetBytes($body); $a.ContentType = "application/json" }; $r = Invoke-WebRequest @a; [pscustomobject]@{ Code = [int]$r.StatusCode; Body = $r.Content } }
  catch { $c = 0; $b = ""; if ($_.Exception.Response) { $c = [int]$_.Exception.Response.StatusCode; try { $b = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch { } }; [pscustomobject]@{ Code = $c; Body = $b } }
}
function AsAdmin([string]$stmt) { $adm = Val "select id i from user_profiles where email='dev-admin@example.test'" "i"; Q "select set_config('request.jwt.claims', json_build_object('sub','$adm','role','authenticated')::text, true) c, $stmt" }

$whSecret = Val "select decrypted_secret s from vault.decrypted_secrets where name='dev_test_razorpay_webhook_secret'" "s"
$reconHook = Val "select decrypted_secret s from vault.decrypted_secrets where name='hook_reconcile'" "s"
$courierTok = Val "select decrypted_secret s from vault.decrypted_secrets where name='dev_test_courier_token'" "s"
if (-not $whSecret -or -not $reconHook -or -not $courierTok) { throw "DEV Vault test secrets missing: run dev-whatsapp-setup.ps1 (and dev-bootstrap) first." }
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
function Rzp-Hook($event, $payload) { $b = (@{ event = $event; payload = $payload } | ConvertTo-Json -Depth 8 -Compress); Call "POST" "$fn/razorpay-webhook" @{ "x-razorpay-signature" = (HmacHex $b $whSecret) } $b }

try {
  Write-Host "== setup" -ForegroundColor Cyan
  Q "create table if not exists public.zz_mock_payments(id text primary key, order_id text, amount bigint, status text, amount_refunded bigint default 0, captured boolean default true, created_at bigint); alter table public.zz_mock_payments enable row level security; grant all on public.zz_mock_payments to service_role;
     create table if not exists public.zz_mock_refunds(payment_id text primary key, amount bigint, refund_id text, rr_id text, at timestamptz default now()); alter table public.zz_mock_refunds add column if not exists rr_id text; alter table public.zz_mock_refunds add column if not exists status text default 'processed'; alter table public.zz_mock_refunds enable row level security; grant all on public.zz_mock_refunds to service_role;
     delete from public.zz_mock_payments;" | Out-Null
  $uid = Val "select id i from user_profiles where email='dev-customer@example.test'" "i"; $cat = Val "select id i from categories limit 1" "i"
  Q "delete from order_items where order_id in (select id from orders where shipping_email like 'sn-%@example.test'); delete from refund_events where payment_id in (select p.id from payments p join orders o on o.id=p.order_id where o.shipping_email like 'sn-%@example.test'); delete from refund_requests where order_id in (select id from orders where shipping_email like 'sn-%@example.test'); delete from payments where order_id in (select id from orders where shipping_email like 'sn-%@example.test'); delete from orders where shipping_email like 'sn-%@example.test';" | Out-Null
  $prod = Val "select id i from products where sku='ZZ-SN-1'" "i"
  if (-not $prod) { $prod = Val "insert into products(name,price,sku,category_id,stock_qty,is_active) values ('ZZ safety net',100,'ZZ-SN-1',$cat,500,false) returning id" "id" }
  Q "update products set stock_qty=500 where id=$prod" | Out-Null
  function New-PaidOrder([string]$tag, [string]$paymentId) {
    $rz = "order_sn_${tag}_$stamp"
    $o = Val "insert into orders(user_id,total_amount,status,payment_method,shipping_address,shipping_phone,shipping_email,shipping_name,razorpay_order_id) values ('$uid',1,'pending','online','x','9000000001','sn-$tag@example.test','SN $tag','$rz') returning id" "id"
    Q "insert into order_items(order_id,product_id,quantity,price_at_purchase) values ($o,$prod,1,1)" | Out-Null
    if ($paymentId) { $r = Rzp-Hook "payment.captured" @{ payment = @{ entity = @{ id = $paymentId; order_id = $rz; amount = 19900; currency = "INR"; status = "captured"; method = "card" } } }; if ($r.Code -ne 200) { throw "capture webhook failed for $tag HTTP $($r.Code)" } }
    [pscustomobject]@{ Id = $o; Rzp = $rz }
  }

  # ============ A. razorpay-webhook: payment.failed + refund events
  Write-Host "== razorpay webhook events" -ForegroundColor Cyan
  $A = New-PaidOrder "a" "pay_sn_a_$stamp"
  Check "baseline: captured payment recorded, order confirmed" ((Val "select status s from orders where id=$($A.Id)" "s") -eq "confirmed")
  $bad = Call "POST" "$fn/razorpay-webhook" @{ "x-razorpay-signature" = "deadbeef" } '{"event":"payment.failed","payload":{"payment":{"entity":{"id":"pay_forged"}}}}'
  Check "forged payment.failed (bad signature): 400, nothing recorded" ($bad.Code -eq 400 -and -not (Row "select 1 x from payment_failures where razorpay_payment_id='pay_forged'"))
  $pf = Rzp-Hook "payment.failed" @{ payment = @{ entity = @{ id = "pay_sn_fail_$stamp"; order_id = $A.Rzp; amount = 19900; method = "card"; status = "failed"; error_code = "BAD_REQUEST_ERROR"; error_description = "Payment failed" } } }
  Check "payment.failed: 200, recorded once for support, order untouched, no ledger row" ($pf.Code -eq 200 -and [int](Val "select count(*) c from payment_failures where razorpay_payment_id='pay_sn_fail_$stamp'" "c") -eq 1 -and -not (Row "select 1 x from payments where razorpay_payment_id='pay_sn_fail_$stamp'") -and (Val "select status s from orders where id=$($A.Id)" "s") -eq "confirmed")
  $pf2 = Rzp-Hook "payment.failed" @{ payment = @{ entity = @{ id = "pay_sn_fail_$stamp"; order_id = $A.Rzp; amount = 19900 } } }
  Check "payment.failed delivered twice: still one row" ([int](Val "select count(*) c from payment_failures where razorpay_payment_id='pay_sn_fail_$stamp'" "c") -eq 1 -and $pf2.Body -match "duplicate")
  $payA = Val "select id i from payments where razorpay_payment_id='pay_sn_a_$stamp'" "i"
  $rf = Rzp-Hook "refund.processed" @{ refund = @{ entity = @{ id = "rfnd_sn_out_$stamp"; payment_id = "pay_sn_a_$stamp"; amount = 19900; status = "processed"; notes = @{} } } }
  Check "refund.processed for a refund we did not request (dashboard): recorded + CRITICAL alert, payment refunded" ($rf.Code -eq 200 -and $rf.Body -match "recorded_outside_system" -and (Val "select status s from payments where id=$payA" "s") -eq "refunded" -and [int](Val "select count(*) c from ops_events where code='refund_outside_system' and entity_id=$payA and severity='critical'" "c") -eq 1)
  $rf2 = Rzp-Hook "refund.processed" @{ refund = @{ entity = @{ id = "rfnd_sn_out_$stamp"; payment_id = "pay_sn_a_$stamp"; amount = 19900; status = "processed"; notes = @{} } } }
  Check "the same refund event twice: duplicate, nothing doubled" ($rf2.Body -match "duplicate" -and [int](Val "select count(*) c from refund_requests where payment_id=$payA" "c") -eq 1)
  $rf3 = Rzp-Hook "refund.failed" @{ refund = @{ entity = @{ id = "rfnd_sn_out_$stamp"; payment_id = "pay_sn_a_$stamp"; amount = 19900; status = "failed"; notes = @{} } } }
  Check "refund.failed after we recorded it processed: request reopened as failed, payment back to captured, CRITICAL alert" ($rf3.Body -match "reopened_after_gateway_failure" -and (Val "select status s from payments where id=$payA" "s") -eq "captured" -and (Val "select status s from refund_requests where payment_id=$payA" "s") -eq "failed" -and [int](Val "select count(*) c from ops_events where code='refund_failed_at_gateway' and resolved_at is null" "c") -ge 1)
  $B = New-PaidOrder "b" "pay_sn_b_$stamp"
  $rp = Rzp-Hook "refund.created" @{ refund = @{ entity = @{ id = "rfnd_sn_part_$stamp"; payment_id = "pay_sn_b_$stamp"; amount = 5000; status = "created"; notes = @{} } } }
  $rp2 = Rzp-Hook "refund.processed" @{ refund = @{ entity = @{ id = "rfnd_sn_part_$stamp"; payment_id = "pay_sn_b_$stamp"; amount = 5000; status = "processed"; notes = @{} } } }
  $payB = Val "select id i from payments where razorpay_payment_id='pay_sn_b_$stamp'" "i"
  Check "PARTIAL refund made outside the system: CRITICAL alert, NOT recorded as a request (full-refund-only)" ($rp2.Body -match "partial_outside_system" -and -not (Row "select 1 x from refund_requests where payment_id=$payB") -and [int](Val "select count(*) c from ops_events where code='partial_refund_outside_system' and entity_id=$payB" "c") -eq 1)
  $un = Rzp-Hook "refund.processed" @{ refund = @{ entity = @{ id = "rfnd_unknown"; payment_id = "pay_not_ours"; amount = 100; status = "processed" } } }
  Check "refund for an unknown payment: 200 + warning, no crash" ($un.Code -eq 200 -and $un.Body -match "unknown_payment")
  Check "unrelated events are acknowledged (200) and ignored" ((Rzp-Hook "payment.authorized" @{ payment = @{ entity = @{ id = "pay_x" } } }).Code -eq 200)

  # ============ B. full refund only in process-refund
  Write-Host "== full-refund-only" -ForegroundColor Cyan
  $C = New-PaidOrder "c" "pay_sn_c_$stamp"; $payC = Val "select id i from payments where razorpay_payment_id='pay_sn_c_$stamp'" "i"
  try {
    Q "alter table public.refund_requests disable trigger trg_refund_full_only" | Out-Null
    $rrC = Val "insert into refund_requests(payment_id,order_id,amount,reason,status,requires_approval) values ($payC,$($C.Id),100,'admin_cancel','requested',false) returning id" "id"
    Q "alter table public.refund_requests enable trigger trg_refund_full_only" | Out-Null
    Q "update refund_requests set status='approved', approved_at=now() where id=$rrC" | Out-Null          # dispatch trigger calls process-refund
    $ok = Wait-For { (Val "select status s from refund_requests where id=$rrC" "s") -eq "failed" } 45
    Check "a partial request that somehow exists is REFUSED by process-refund; nothing is sent to Razorpay" ($ok -and (Val "select error e from refund_requests where id=$rrC" "e") -match "partial refunds are not supported" -and -not (Row "select 1 x from zz_mock_refunds where payment_id='pay_sn_c_$stamp'"))
  } finally { Q "alter table public.refund_requests enable trigger trg_refund_full_only" | Out-Null }
  $partialAccepted = $true; try { Q "insert into refund_requests(payment_id,order_id,amount,reason,status) values ($payC,$($C.Id),50,'admin_cancel','requested')" | Out-Null } catch { $partialAccepted = $false }
  Check "the database trigger is enabled again and blocks partial inserts" (-not $partialAccepted)

  # ============ C. reconciliation
  Write-Host "== reconciliation" -ForegroundColor Cyan
  $old = $stamp - 3600
  $R1 = New-PaidOrder "r1" "pay_sn_r1_$stamp"                      # ledger + Razorpay agree
  $R2 = New-PaidOrder "r2" $null                                    # captured at Razorpay, webhook "lost": the run must heal it
  $R4 = New-PaidOrder "r4" "pay_sn_r4_$stamp"                      # ledger amount differs from Razorpay
  $R6 = New-PaidOrder "r6" "pay_sn_r6_$stamp"                      # refunded at Razorpay, we never knew
  $R7 = New-PaidOrder "r7" "pay_sn_r7_$stamp"                      # we say refunded, Razorpay shows no refund
  Q "update payments set status='refunded' where razorpay_payment_id='pay_sn_r7_$stamp'" | Out-Null
  Q "insert into zz_mock_payments(id,order_id,amount,status,amount_refunded,captured,created_at) values
     ('pay_sn_r1_$stamp','$($R1.Rzp)',19900,'captured',0,true,$old),
     ('pay_sn_r2_$stamp','$($R2.Rzp)',19900,'captured',0,true,$old),
     ('pay_sn_r3_$stamp','order_nobody_$stamp',12300,'captured',0,true,$old),
     ('pay_sn_r4_$stamp','$($R4.Rzp)',25000,'captured',0,true,$old),
     ('pay_sn_r6_$stamp','$($R6.Rzp)',19900,'refunded',19900,true,$old),
     ('pay_sn_r7_$stamp','$($R7.Rzp)',19900,'captured',0,true,$old),
     ('pay_sn_recent_$stamp','order_recent_$stamp',19900,'captured',0,true,$stamp)" | Out-Null
  Q "insert into zz_mock_refunds(payment_id,amount,refund_id,rr_id,status) values ('pay_sn_r6_$stamp',19900,'rfnd_sn_r6_$stamp','','processed')" | Out-Null
  # a ledger row (webhook source) that Razorpay does not show at all
  $ghostOrder = New-PaidOrder "r5" $null
  Q "insert into payments(razorpay_payment_id,razorpay_order_id,order_id,amount,source) values ('pay_sn_ghost_$stamp','$($ghostOrder.Rzp)',$($ghostOrder.Id),199,'razorpay-webhook')" | Out-Null
  $noAuth = Call "POST" "$fn/razorpay-reconcile" @{} '{"hours":24}'
  Check "reconcile refuses a caller with neither the hook secret nor an admin login" ($noAuth.Code -in 401, 403)
  $dry = Call "POST" "$fn/razorpay-reconcile" @{ "x-hook-secret" = $reconHook } '{"hours":24,"dryRun":true}'; $jd = $dry.Body | ConvertFrom-Json
  Check "dry run reports the missing payment as 'would heal' and changes NOTHING (no ledger row, order still pending)" ($jd.dryRun -eq $true -and @($jd.findings | Where-Object { $_.code -eq "missing_payment_would_heal" -and $_.payment -eq "pay_sn_r2_$stamp" }).Count -eq 1 -and -not (Row "select 1 x from payments where razorpay_payment_id='pay_sn_r2_$stamp'") -and (Val "select status s from orders where id=$($R2.Id)" "s") -eq "pending" -and (Val "select trigger_source s from reconciliation_runs where id=$($jd.run)" "s") -eq "cron-dry-run")
  Check "dry run does not record untracked refunds either" (-not (Row "select 1 x from refund_requests rr join payments p on p.id=rr.payment_id where p.razorpay_payment_id='pay_sn_r6_$stamp'"))
  $run = Call "POST" "$fn/razorpay-reconcile" @{ "x-hook-secret" = $reconHook } '{"hours":24}'
  $j = $null; try { $j = $run.Body | ConvertFrom-Json } catch { }
  $codes = @($j.findings | ForEach-Object { "$($_.code):$($_.payment)" })
  Check "reconcile run completes and is stored (reconciliation_runs)" ($run.Code -eq 200 -and $j.run -and (Val "select count(*) c from reconciliation_runs where id=$($j.run)" "c") -eq 1) $run.Body.Substring(0, [Math]::Min(300, $run.Body.Length))
  Check "missing payment HEALED through settle_payment (ledger row + order confirmed) and reported as a warning" ($codes -contains "missing_payment_healed:pay_sn_r2_$stamp" -and (Val "select source s from payments where razorpay_payment_id='pay_sn_r2_$stamp'" "s") -eq "reconcile" -and (Val "select status s from orders where id=$($R2.Id)" "s") -eq "confirmed")
  Check "ORPHAN payment (matches no order) detected, critical" ($codes -contains "orphan_payment:pay_sn_r3_$stamp")
  Check "amount mismatch detected (ledger 199 vs Razorpay 250), critical" ($codes -contains "amount_mismatch:pay_sn_r4_$stamp")
  Check "refund at Razorpay that we did not track: detected, recorded, critical" ($codes -contains "refund_untracked:pay_sn_r6_$stamp" -and (Row "select 1 x from refund_requests rr join payments p on p.id=rr.payment_id where p.razorpay_payment_id='pay_sn_r6_$stamp' and rr.status='processed'"))
  Check "ledger says refunded but Razorpay shows no refund: critical" ($codes -contains "ledger_refunded_not_at_razorpay:pay_sn_r7_$stamp")
  Check "ledger row Razorpay does not know: critical" ($codes -contains "ledger_not_at_razorpay:pay_sn_ghost_$stamp")
  Check "a payment captured in the last 10 minutes is NOT healed yet (grace) and not alarmed" ($codes -contains "recent_payment_not_yet_recorded:pay_sn_recent_$stamp" -and -not (Row "select 1 x from payments where razorpay_payment_id='pay_sn_recent_$stamp'"))
  Check "run is not 'ok' and raised a critical discrepancy alert" ($j.ok -eq $false -and [int](Val "select count(*) c from ops_events where code='reconcile_discrepancy' and entity_id=$($j.run) and severity='critical'" "c") -eq 1)
  $healedOrders = [int](Val "select count(*) c from payments where razorpay_payment_id='pay_sn_r2_$stamp'" "c")
  $run2 = Call "POST" "$fn/razorpay-reconcile" @{ "x-hook-secret" = $reconHook } '{"hours":24}'; $j2 = $run2.Body | ConvertFrom-Json
  Check "second run is idempotent: nothing healed twice, the healed payment is now simply matched" ($healedOrders -eq 1 -and [int](Val "select count(*) c from payments where razorpay_payment_id='pay_sn_r2_$stamp'" "c") -eq 1 -and -not (@($j2.findings | ForEach-Object { $_.code }) -contains "missing_payment_healed") -and (Val "select stock_qty s from products where id=$prod" "s") -eq (500 - [int](Val "select count(*) c from orders where status='confirmed' and shipping_email like 'sn-%@example.test'" "c")))
  Q "update zz_mock_payments set status='captured', amount_refunded=0 where id='pay_sn_r6_$stamp'" | Out-Null
  $h = AsAdmin "public.financial_health() h"
  Check "financial_health (admin): shows critical alerts, last reconciliation, audit check, open event counts" ($h[0].h.open_critical_events -ge 3 -and $h[0].h.last_reconciliation.id -ge $j2.run -and $null -ne $h[0].h.open_events_by_code)

  # ============ D. courier webhook end to end (provider 'canonical' = our own vocabulary; real providers need their own mapping)
  Write-Host "== courier webhook" -ForegroundColor Cyan
  $D = New-PaidOrder "d" "pay_sn_d_$stamp"; $awb = "AWB-SN-$stamp"
  Q "update orders set tracking_number='$awb', courier='TestCourier' where id=$($D.Id)" | Out-Null
  $stockBefore = [int](Val "select stock_qty s from products where id=$prod" "s")
  function Courier($status, $token = $courierTok, $ref = $D.Id) { Call "POST" "$fn/courier-webhook" @{ "x-api-key" = $token } (@{ awb = $awb; order_id = "$ref"; current_status = $status; current_timestamp = "t-$status-$([guid]::NewGuid().ToString('N').Substring(0, 6))" } | ConvertTo-Json -Compress) }
  Check "courier webhook without/with a wrong token: 401" ((Call "POST" "$fn/courier-webhook" @{} '{"awb":"x","status":"delivered"}').Code -eq 401 -and (Courier "shipped" "wrong-token").Code -eq 401)
  $c1 = Courier "Shipped"
  Check "authenticated 'Shipped': order -> shipped" ($c1.Code -eq 200 -and (Val "select status s from orders where id=$($D.Id)" "s") -eq "shipped")
  $null = Courier "RTO Initiated"; $null = Courier "RTO In Transit"
  Check "RTO initiated / in transit: order stays shipped, stock and refunds untouched" ((Val "select status s from orders where id=$($D.Id)" "s") -eq "shipped" -and [int](Val "select stock_qty s from products where id=$prod" "s") -eq $stockBefore -and -not (Row "select 1 x from refund_requests where order_id=$($D.Id)"))
  $c4 = Courier "RTO Delivered"
  Check "definitive 'RTO Delivered': order -> rto, stock restored exactly once, ONE refund request awaiting admin approval" ((Val "select status s from orders where id=$($D.Id)" "s") -eq "rto" -and [int](Val "select stock_qty s from products where id=$prod" "s") -eq $stockBefore + 1 -and [int](Val "select count(*) c from refund_requests where order_id=$($D.Id)" "c") -eq 1 -and (Val "select status s from refund_requests where order_id=$($D.Id)" "s") -eq "requested")
  $dupBody = (@{ awb = $awb; order_id = "$($D.Id)"; current_status = "RTO Delivered"; current_timestamp = "fixed-ts" } | ConvertTo-Json -Compress)
  $null = Call "POST" "$fn/courier-webhook" @{ "x-api-key" = $courierTok } $dupBody; $d2 = Call "POST" "$fn/courier-webhook" @{ "x-api-key" = $courierTok } $dupBody
  Check "the same webhook delivered twice and a re-keyed RTO: no second restock, no second refund request" ([int](Val "select stock_qty s from products where id=$prod" "s") -eq $stockBefore + 1 -and [int](Val "select count(*) c from refund_requests where order_id=$($D.Id)" "c") -eq 1 -and $d2.Body -match "duplicate")
  $null = Courier "Delivered"
  Check "late 'Delivered' after RTO cannot resurrect the order (conflict alert)" ((Val "select status s from orders where id=$($D.Id)" "s") -eq "rto" -and [int](Val "select count(*) c from ops_events where code='courier_conflict' and entity_id=$($D.Id)" "c") -ge 1)
  $null = Courier "Totally Unknown Wording"
  Check "an unmapped provider wording is recorded and alerted but changes nothing" ([int](Val "select count(*) c from ops_events where code='courier_status_unmapped' and resolved_at is null" "c") -ge 1 -and (Val "select status s from orders where id=$($D.Id)" "s") -eq "rto")
  Check "the request awaits an admin: nothing was refunded automatically" ((Val "select status s from refund_requests where order_id=$($D.Id)" "s") -eq "requested" -and -not (Row "select 1 x from zz_mock_refunds where payment_id='pay_sn_d_$stamp'"))
  $rrD = Val "select id i from refund_requests where order_id=$($D.Id)" "i"
  $null = AsAdmin "public.approve_refund($rrD) a"
  $okD = Wait-For { (Val "select status s from refund_requests where id=$rrD" "s") -eq "processed" } 60
  Check "admin approves -> refund processed through process-refund; exactly ONE refund at the (mock) gateway" ($okD -and [int](Val "select count(*) c from zz_mock_refunds where payment_id='pay_sn_d_$stamp'" "c") -eq 1 -and (Val "select status s from payments where razorpay_payment_id='pay_sn_d_$stamp'" "s") -eq "refunded")
  Check "audit trail has the whole chain for this refund (requested, approved, submitted, processed)" ([int](Val "select count(*) c from financial_audit where entity='refund_request' and entity_id=$rrD and action in ('refund_requested','refund_approved','refund_submitted','refund_processed')" "c") -ge 4)
  # recovery: a refund that failed is retried by the scheduled job
  $E = New-PaidOrder "e" "pay_sn_failrefund_$stamp"
  Q "update orders set status='shipped' where id=$($E.Id)" | Out-Null; Q "update orders set status='rto' where id=$($E.Id)" | Out-Null
  $rrE = Val "select id i from refund_requests where order_id=$($E.Id)" "i"; $null = AsAdmin "public.approve_refund($rrE) a"
  $failed = Wait-For { (Val "select status s from refund_requests where id=$rrE" "s") -eq "failed" } 60
  Check "gateway refusing the refund -> status failed with the gateway's words, admin alert, customer not told" ($failed -and (Val "select error e from refund_requests where id=$rrE" "e") -match "mock: refund rejected" -and [int](Val "select count(*) c from ops_events where code='refund_failed' and entity_id=$rrE" "c") -ge 1)
  Q "update refund_requests set status='rejected', decision_note='test cleanup: gateway refusal was the point of the test' where id=$rrE and status='failed'" | Out-Null      # stop the retry job from chasing this deliberately failing refund
  Check "retry job is scheduled (retry-failed-refunds, requeue-stuck-refunds)" ([int](Val "select count(*) c from cron.job where jobname in ('retry-failed-refunds','requeue-stuck-refunds') and active" "c") -eq 2)

  # ============ E. social endpoints are disabled (deferred feature)
  Write-Host "== social endpoints (deferred)" -ForegroundColor Cyan
  $sg = Call "GET" "$fn/social-webhook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=c"; $sp = Call "POST" "$fn/social-webhook" @{} '{"object":"instagram","entry":[{"id":"1","changes":[{"field":"comments","value":{"id":"c1","text":"hi"}}]}]}'
  $sr = Call "POST" "$fn/social-reply" @{} '{"message_id":1,"text":"x"}'
  Check "social-webhook GET and an UNSIGNED POST both answer 503 'disabled' (no exposed unsigned endpoint)" ($sg.Code -eq 503 -and $sp.Code -eq 503)
  Check "unsigned POST stored nothing" (-not (Row "select 1 x from social_messages where external_id='c1'"))
  Check "social-reply is disabled too" ($sr.Code -eq 503)

  # ============ F. scheduled jobs
  Write-Host "== scheduled jobs" -ForegroundColor Cyan
  $jobs = @((Q "select jobname from cron.job where active order by 1") | ForEach-Object { $_.jobname })
  $missingJobs = @("expire-pending-orders", "requeue-stuck-refunds", "cancel-empty-orders", "retry-failed-refunds", "whatsapp-worker", "whatsapp-sync-templates", "razorpay-reconcile", "audit-verify") | Where-Object { $jobs -notcontains $_ }
  Check "all required cron jobs are active" (@($missingJobs).Count -eq 0) ("missing: " + ($missingJobs -join ","))
  $ver = Val "select (private.audit_verify_job())->>'intact' i" "i"
  Check "audit verification job runs and stores a checkpoint" ($ver -in "true", "false" -and [int](Val "select count(*) c from audit_anchors" "c") -ge 1) "intact=$ver"
} finally {
  Q "update ops_events set resolved_at=now() where resolved_at is null and code in ('courier_status_unmapped','courier_conflict')" | Out-Null
  $results | Format-Table -AutoSize -Wrap
}
$failed = @($results | Where-Object { $_.Result -eq "FAIL" }).Count
Write-Host ""; Write-Host "$(@($results).Count) checks, $failed failed." -ForegroundColor $(if ($failed) { "Red" } else { "Green" })
if ($failed) { exit 1 }
