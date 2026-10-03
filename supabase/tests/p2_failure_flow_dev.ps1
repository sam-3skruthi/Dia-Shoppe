# Through the DEPLOYED DEV functions: held-for-stock orders, refund failure -> alert -> automatic retry ->
# recovery, exactly-once customer notification, retries exhausted, and audit-chain integrity afterwards.
#   ./p2_failure_flow_dev.ps1 -Ref <dev-ref>        (DEV only; commits throwaway rows and removes them)
param([Parameter(Mandatory = $true)][string]$Ref)
$ErrorActionPreference = "Stop"
if ($Ref -eq "vkcwfwgxelmamuydwrow") { throw "DEV only: refusing to run against PRODUCTION." }
$token = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", "User")
$h = @{ Authorization = "Bearer $token"; "User-Agent" = "Mozilla/5.0"; "Content-Type" = "application/json" }
$fn = "https://$Ref.supabase.co/functions/v1"
function Q([string]$sql) { try { Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" -Headers $h -Body ([Text.Encoding]::UTF8.GetBytes((@{ query = $sql } | ConvertTo-Json -Depth 3))) } catch { throw ("SQL error: " + (($_.ErrorDetails.Message -replace '(sbp_|eyJ)[A-Za-z0-9._-]+', '<redacted>') -replace '\s+', ' ')) } }
function Vault([string]$n) { (Q "select decrypted_secret s from vault.decrypted_secrets where name='$n'")[0].s }
$whSecret = Vault "dev_test_razorpay_webhook_secret"; $notifyHook = Vault "hook_refund_notify"
$uid = (Q "select id from user_profiles where email='dev-customer@example.test'")[0].id
$cat = (Q "select id from categories limit 1")[0].id
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds(); $seq = 0; $results = @()
function Check([string]$name, [bool]$ok, [string]$detail = "") { $script:results += [pscustomobject]@{ Test = $name; Result = $(if ($ok) { "PASS" } else { "FAIL" }); Detail = $detail } }

$big = (Q "insert into products(name,price,sku,category_id,stock_qty,is_active) values ('ZZ big',100,'ZZ-P2B-$stamp',$cat,50,false) returning id")[0].id
$tiny = (Q "insert into products(name,price,sku,category_id,stock_qty,is_active) values ('ZZ tiny',100,'ZZ-P2T-$stamp',$cat,1,false) returning id")[0].id
function Stock($p) { [int](Q "select stock_qty from products where id=$p")[0].stock_qty }
function New-Order($prod, [int]$qty) {
  $script:seq++; $rzp = "order_zzp2_${stamp}_$script:seq"
  $id = (Q "insert into orders(user_id,total_amount,status,payment_method,shipping_address,shipping_phone,shipping_email,shipping_name,razorpay_order_id) values ('$uid',1,'pending','online','x','0','buyer$script:seq@example.test','Test Buyer','$rzp') returning id")[0].id
  Q "insert into order_items(order_id,product_id,quantity,price_at_purchase) values ($id,$prod,$qty,1)" | Out-Null
  [pscustomobject]@{ Id = $id; Rzp = $rzp; Paise = [long]([decimal](Q "select total_amount t from orders where id=$id")[0].t * 100) }
}
function Pay($o, [string]$payId) {
  $body = (@{ event = "payment.captured"; payload = @{ payment = @{ entity = @{ id = $payId; order_id = $o.Rzp; amount = $o.Paise; status = "captured"; currency = "INR" } } } } | ConvertTo-Json -Depth 6 -Compress)
  $hm = New-Object System.Security.Cryptography.HMACSHA256 (, [Text.Encoding]::UTF8.GetBytes($whSecret))
  $sig = ($hm.ComputeHash([Text.Encoding]::UTF8.GetBytes($body)) | % { $_.ToString("x2") }) -join ""
  (Invoke-WebRequest -Method Post -Uri "$fn/razorpay-webhook" -Headers @{ "x-razorpay-signature" = $sig; "Content-Type" = "application/json" } -Body $body -UseBasicParsing).StatusCode
}
function PayId($o, [string]$uniq, [string]$extra = "") { "pay_captured_$($o.Paise)_${uniq}${extra}__$($o.Rzp)" }
function RStatus($oid) { $r = Q "select status s from refund_requests where order_id=$oid order by id desc limit 1"; if ($r) { $r[0].s } else { "none" } }
function Wait-R($oid, [string]$want, [int]$secs = 25) { for ($i = 0; $i -lt $secs; $i++) { if ((RStatus $oid) -eq $want) { return $true }; Start-Sleep 1 }; $false }
function Wait-Notif($rid, [string]$kind, [int]$secs = 20) { for ($i = 0; $i -lt $secs; $i++) { if ([int](Q "select count(*) c from customer_notifications where refund_request_id=$rid and kind='$kind' and status='sent'")[0].c -ge 1) { return $true }; Start-Sleep 1 }; $false }
function As-Admin([string]$stmt) { Q "do `$`$ begin perform set_config('request.jwt.claims', json_build_object('sub',(select id from user_profiles where email='dev-admin@example.test'),'role','authenticated')::text, true); set local role authenticated; $stmt end `$`$" | Out-Null }
function Mock-Refunds($o) { [int](Q "select count(*) c from zz_mock_refunds where payment_id like '%$($o.Rzp)'")[0].c }
function Mock-Emails($oid) { [int](Q "select count(*) c from zz_mock_emails where subject like '%#$oid %' or subject like '%#$oid'")[0].c }

try {
  # ============ H1: stock runs out between order creation and payment ============
  $a = New-Order $tiny 1; $b = New-Order $tiny 1
  Check "H1 first payment confirms and takes the last unit" ((Pay $a (PayId $a "h1a")) -eq 200 -and ((Q "select status s from orders where id=$($a.Id)")[0].s) -eq "confirmed" -and (Stock $tiny) -eq 0)
  Check "H1 second payment acknowledged (200)" ((Pay $b (PayId $b "h1b")) -eq 200)
  $ob = (Q "select status, hold_reason from orders where id=$($b.Id)")[0]
  Check "H1 order B is ON HOLD, not confirmed" ($ob.status -eq "on_hold" -and $ob.hold_reason -eq "insufficient_stock") "status=$($ob.status)"
  Check "H1 nothing partially deducted (stock still 0, line undeducted)" ((Stock $tiny) -eq 0 -and $null -eq (Q "select stock_deducted_qty d from order_items where order_id=$($b.Id)")[0].d)
  Check "H1 payment recorded in the ledger" ([int](Q "select count(*) c from payments where order_id=$($b.Id)")[0].c -eq 1)
  Check "H1 refund request waits for an admin" ((RStatus $b.Id) -eq "requested")
  Check "H1 critical admin alert raised" ([int](Q "select count(*) c from ops_events where code='insufficient_stock' and entity_id=$($b.Id) and severity='critical' and resolved_at is null")[0].c -eq 1)
  1..3 | % { Pay $b (PayId $b "h1b") | Out-Null }; Start-Sleep 2
  Check "H1 replayed webhook x3: still ONE alert, ONE refund request, ONE ledger row" (([int](Q "select count(*) c from ops_events where code='insufficient_stock' and entity_id=$($b.Id)")[0].c -eq 1) -and ([int](Q "select count(*) c from refund_requests where order_id=$($b.Id)")[0].c -eq 1) -and ([int](Q "select count(*) c from payments where order_id=$($b.Id)")[0].c -eq 1))
  Check "H1 nothing refunded automatically while on hold" ((Mock-Refunds $b) -eq 0)
  As-Admin "perform public.refund_held_order($($b.Id));"
  Check "H1 admin refund -> processed through the (mock) gateway" (Wait-R $b.Id "processed")
  $rb = (Q "select id from refund_requests where order_id=$($b.Id)")[0].id
  Check "H1 customer told the refund is processed (email)" (Wait-Notif $rb "refund_processed")
  Check "H1 alert resolved, stock still 0 (nothing was ever deducted for B)" (([int](Q "select count(*) c from ops_events where code='insufficient_stock' and entity_id=$($b.Id) and resolved_at is null")[0].c -eq 0) -and (Stock $tiny) -eq 0)

  # exactly-once notification: poke refund-notify again by hand (as the trigger would on a retry)
  $pre = Mock-Emails $b.Id
  $again = (Invoke-WebRequest -Method Post -Uri "$fn/refund-notify" -Headers @{ "x-hook-secret" = $notifyHook } -ContentType "application/json" -Body (@{ refund_request_id = $rb; kind = "refund_processed" } | ConvertTo-Json) -UseBasicParsing).Content
  Check "H1 duplicate notify call is a no-op (exactly once)" ($again -like "*already notified*" -and (Mock-Emails $b.Id) -eq $pre -and $pre -eq 1) "emails=$pre"
  $code = 0; try { Invoke-WebRequest -Method Post -Uri "$fn/refund-notify" -Headers @{ "x-hook-secret" = "wrong" } -ContentType "application/json" -Body '{"refund_request_id":1,"kind":"refund_processed"}' -UseBasicParsing | Out-Null } catch { $code = [int]$_.Exception.Response.StatusCode }
  Check "H1 refund-notify rejects a wrong hook secret" ($code -eq 401)

  # ============ H2: TEMPORARY gateway failure -> alert -> automatic retries -> recovery ============
  $o = New-Order $big 1; Pay $o (PayId $o "h2" "flaky") | Out-Null; Start-Sleep 2
  Q "update orders set status='cancelled', cancelled_by='customer' where id=$($o.Id)" | Out-Null
  Check "H2 attempt 1 fails (gateway 503) and is recorded" (Wait-R $o.Id "failed")
  $rid = (Q "select id from refund_requests where order_id=$($o.Id)")[0].id
  Check "H2 admin sees a warning alert" ([int](Q "select count(*) c from ops_events where code='refund_failed' and entity_id=$rid and resolved_at is null")[0].c -eq 1)
  Check "H2 customer is NOT told about the temporary failure" ([int](Q "select count(*) c from customer_notifications where refund_request_id=$rid")[0].c -eq 0)
  Check "H2 backoff respected: nothing is retried immediately" ([int](Q "select private.retry_failed_refunds() as n")[0].n -eq 0)
  Q "update refund_requests set status_changed_at = now() - interval '11 minutes' where id=$rid" | Out-Null
  Check "H2 after 10 min the cron job re-approves it" ([int](Q "select private.retry_failed_refunds() as n")[0].n -ge 1)
  Start-Sleep 6
  Check "H2 attempt 2 also fails (still quiet for the customer)" ((RStatus $o.Id) -eq "failed" -and [int](Q "select attempts a from refund_requests where id=$rid")[0].a -eq 2 -and [int](Q "select count(*) c from customer_notifications where refund_request_id=$rid")[0].c -eq 0)
  Q "update refund_requests set status_changed_at = now() - interval '31 minutes' where id=$rid" | Out-Null
  Q "select private.retry_failed_refunds()" | Out-Null
  Check "H2 attempt 3 succeeds -> processed (recovered without human action)" (Wait-R $o.Id "processed")
  Check "H2 alerts auto-resolved" ([int](Q "select count(*) c from ops_events where entity='refund_request' and entity_id=$rid and resolved_at is null")[0].c -eq 0)
  Check "H2 customer told exactly once, and only the final success" ((Wait-Notif $rid "refund_processed") -and [int](Q "select count(*) c from customer_notifications where refund_request_id=$rid")[0].c -eq 1)
  Check "H2 exactly one refund reached the gateway" ((Mock-Refunds $o) -eq 1)
  $chain = (Q "select string_agg(action, ' > ' order by chain_seq) c from financial_audit where detail->>'order_id' = '$($o.Id)'")[0].c
  Check "H2 audit shows every attempt: submitted, failed, re-approved, ..., processed" ($chain -like "*refund_failed*refund_approved*refund_submitted*refund_failed*refund_approved*refund_submitted*refund_processed") $chain

  # ============ H3: PERMANENT failure -> retries exhausted -> critical alert + customer told once ============
  $o = New-Order $big 1; Pay $o (PayId $o "h3" "failrefund") | Out-Null; Start-Sleep 2
  Q "update orders set status='cancelled', cancelled_by='customer' where id=$($o.Id)" | Out-Null
  [void](Wait-R $o.Id "failed"); $rid = (Q "select id from refund_requests where order_id=$($o.Id)")[0].id
  foreach ($i in 1..4) {
    Q "update refund_requests set status_changed_at = now() - interval '7 hours' where id=$rid" | Out-Null
    Q "select private.retry_failed_refunds()" | Out-Null
    for ($w = 0; $w -lt 20; $w++) { Start-Sleep 1; if ([int](Q "select attempts a from refund_requests where id=$rid")[0].a -ge ($i + 1) -and (RStatus $o.Id) -eq "failed") { break } }
  }
  Check "H3 five attempts made, then it STOPS (status failed, not silently dropped)" ([int](Q "select attempts a from refund_requests where id=$rid")[0].a -eq 5 -and (RStatus $o.Id) -eq "failed")
  Q "update refund_requests set status_changed_at = now() - interval '7 hours' where id=$rid" | Out-Null
  Check "H3 no sixth attempt is scheduled" ([int](Q "select private.retry_failed_refunds() as n")[0].n -eq 0)
  Check "H3 CRITICAL 'retries exhausted' alert raised" ([int](Q "select count(*) c from ops_events where code='refund_retries_exhausted' and entity_id=$rid and severity='critical' and resolved_at is null")[0].c -eq 1)
  Check "H3 customer told, once, that we are sorting it out (never 'processed')" ((Wait-Notif $rid "refund_delayed") -and [int](Q "select count(*) c from customer_notifications where refund_request_id=$rid and kind='refund_delayed'")[0].c -eq 1 -and [int](Q "select count(*) c from customer_notifications where refund_request_id=$rid and kind='refund_processed'")[0].c -eq 0)
  Q "select private.retry_failed_refunds()" | Out-Null; Start-Sleep 3
  Check "H3 running the job again does not notify twice" ([int](Q "select count(*) c from customer_notifications where refund_request_id=$rid")[0].c -eq 1)
  Check "H3 no money moved" ((Mock-Refunds $o) -eq 0)

  # ============ H4: after all of the above the audit trail is intact ============
  $msg = ""
  try { Q "do `$`$ declare st jsonb; begin perform set_config('request.jwt.claims', json_build_object('sub',(select id from user_profiles where email='dev-admin@example.test'),'role','authenticated')::text, true); set local role authenticated; st := public.audit_chain_status(); raise exception 'CHAIN %', st::text; end `$`$" | Out-Null } catch { $msg = $_.Exception.Message }
  Check "H4 audit chain intact after every transition above" ($msg -match 'intact\\?"\s*:\s*true') ($msg -replace '.*CHAIN ', '' -replace '\\n.*', '')
}
finally {
  Q "delete from customer_notifications where order_id in (select id from orders where razorpay_order_id like 'order_zzp2_$stamp%')" | Out-Null
  Q "delete from zz_mock_refunds where payment_id like '%order_zzp2_$stamp%'" | Out-Null
  Q "delete from zz_mock_attempts where payment_id like '%order_zzp2_$stamp%'" | Out-Null
  Q "delete from zz_mock_emails where subject like '%order #%'" | Out-Null
  Q "delete from ops_events where entity='order' and entity_id in (select id from orders where razorpay_order_id like 'order_zzp2_$stamp%')" | Out-Null
  Q "delete from ops_events where entity='refund_request' and entity_id in (select rr.id from refund_requests rr join orders o on o.id=rr.order_id where o.razorpay_order_id like 'order_zzp2_$stamp%')" | Out-Null
  Q "delete from refund_requests where order_id in (select id from orders where razorpay_order_id like 'order_zzp2_$stamp%')" | Out-Null
  Q "delete from payments where razorpay_order_id like 'order_zzp2_$stamp%'" | Out-Null
  Q "delete from orders where razorpay_order_id like 'order_zzp2_$stamp%'" | Out-Null
  Q "delete from products where id in ($big,$tiny)" | Out-Null
}
$results | Format-Table -AutoSize -Wrap
if (@($results | ? Result -eq "FAIL").Count) { exit 1 }
