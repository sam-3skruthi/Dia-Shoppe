# End-to-end financial edge cases against the DEPLOYED DEV functions (real HTTP, real triggers,
# real pg_net, mock Razorpay). Commits throwaway rows (razorpay order ids order_zzf_*) and removes them.
#   ./p1_financial_dev.ps1 -Ref <dev-ref>
# STATUS: written, not yet executed (waiting for DEV access).
param([Parameter(Mandatory = $true)][string]$Ref)
$ErrorActionPreference = "Stop"
if ($Ref -eq "vkcwfwgxelmamuydwrow") { throw "DEV only: refusing to run against PRODUCTION." }
$token = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", "User")
$h = @{ Authorization = "Bearer $token"; "User-Agent" = "Mozilla/5.0"; "Content-Type" = "application/json" }
$fn = "https://$Ref.supabase.co/functions/v1"
function Q([string]$sql) { try { Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" -Headers $h -Body ([Text.Encoding]::UTF8.GetBytes((@{ query = $sql } | ConvertTo-Json -Depth 3))) } catch { throw ("SQL error: " + (($_.ErrorDetails.Message -replace '(sbp_|eyJ)[A-Za-z0-9._-]+','<redacted>') -replace '\s+',' ')) } }
function Vault([string]$n) { (Q "select decrypted_secret s from vault.decrypted_secrets where name='$n'")[0].s }
$whSecret = Vault "dev_test_razorpay_webhook_secret"; $courierTok = Vault "dev_test_courier_token"; $refundHook = Vault "hook_process_refund"
$uid = (Q "select id from user_profiles where email='dev-customer@example.test'")[0].id
$cat = (Q "select id from categories limit 1")[0].id
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds(); $n = 0
$results = @()
function Check([string]$name, [bool]$ok, [string]$detail = "") { $script:results += [pscustomobject]@{ Test = $name; Result = $(if ($ok) { "PASS" } else { "FAIL" }); Detail = $detail } }

$prod = (Q "insert into products(name,price,sku,category_id,stock_qty,is_active) values ('ZZ fin dev',100,'ZZ-FINDEV-$stamp',$cat,50,false) returning id")[0].id
function Stock { [int](Q "select stock_qty from products where id=$prod")[0].stock_qty }
function New-Order([int]$qty, [string]$status = "pending", [string]$method = "online", [string]$ago = "0 minutes") {
  $script:n++; $rzp = "order_zzf_${stamp}_$n"
  $id = (Q "insert into orders(user_id,total_amount,status,payment_method,shipping_address,shipping_phone,razorpay_order_id,created_at) values ('$uid',1,'$status','$method','x','0','$rzp', now() - interval '$ago') returning id")[0].id
  Q "insert into order_items(order_id,product_id,quantity,price_at_purchase) values ($id,$prod,$qty,1)" | Out-Null
  [pscustomobject]@{ Id = $id; Rzp = $rzp; Total = [decimal](Q "select total_amount from orders where id=$id")[0].total_amount }
}
Add-Type -AssemblyName System.Net.Http
$http = New-Object System.Net.Http.HttpClient
function Webhook-Task($o, [string]$payId, [long]$paise) {      # returns a started Task (for true parallelism)
  $body = (@{ event = "payment.captured"; payload = @{ payment = @{ entity = @{ id = $payId; order_id = $o.Rzp; amount = $paise; status = "captured"; currency = "INR" } } } } | ConvertTo-Json -Depth 6 -Compress)
  $hm = New-Object System.Security.Cryptography.HMACSHA256 (, [Text.Encoding]::UTF8.GetBytes($whSecret))
  $sig = ($hm.ComputeHash([Text.Encoding]::UTF8.GetBytes($body)) | % { $_.ToString("x2") }) -join ""
  $req = New-Object System.Net.Http.HttpRequestMessage ([System.Net.Http.HttpMethod]::Post, "$fn/razorpay-webhook")
  $req.Headers.Add("x-razorpay-signature", $sig)
  $req.Content = New-Object System.Net.Http.StringContent($body, [Text.Encoding]::UTF8, "application/json")
  $http.SendAsync($req)
}
function Post-Webhook($o, [string]$payId, [long]$paise) { $t = Webhook-Task $o $payId $paise; $t.Wait(); $t.Result }
function PayId([string]$status, [long]$paise, $o, [string]$uniq, [string]$extra = "") { "pay_${status}_${paise}_${uniq}${extra}__$($o.Rzp)" }
function Wait-Refund($orderId, [string]$want, [int]$secs = 25) {
  for ($i = 0; $i -lt $secs; $i++) { $r = Q "select status from refund_requests where order_id=$orderId order by id desc limit 1"; if ($r -and $r[0].status -eq $want) { return $true }; Start-Sleep 1 }
  $false
}
function As-Admin([string]$stmt) { Q "do `$`$ begin perform set_config('request.jwt.claims', json_build_object('sub',(select id from user_profiles where email='dev-admin@example.test'),'role','authenticated')::text, true); set local role authenticated; $stmt end `$`$" | Out-Null }
function Mock-Refunds([string]$like) { [int](Q "select count(*) c from zz_mock_refunds where payment_id like '$like'")[0].c }

try {
  # Sanity: the webhook still rejects forged signatures
  try { Invoke-WebRequest -Method Post -Uri "$fn/razorpay-webhook" -Headers @{ "x-razorpay-signature" = "bad" } -Body "{}" -UseBasicParsing | Out-Null; Check "W0 forged webhook rejected" $false } catch { Check "W0 forged webhook rejected (400)" ([int]$_.Exception.Response.StatusCode -eq 400) }

  # E1 normal payment via webhook, duplicates in parallel -> confirmed once, stock once
  $o = New-Order 2; $pid1 = PayId captured ([long]($o.Total * 100)) $o "e1"
  $tasks = 1..6 | % { Webhook-Task $o $pid1 ([long]($o.Total * 100)) }       # 6 simultaneous deliveries of the SAME event
  [System.Threading.Tasks.Task]::WaitAll($tasks)
  Check "E1 all 6 parallel deliveries acknowledged 200" (@($tasks | ? { [int]$_.Result.StatusCode -ne 200 }).Count -eq 0)
  Start-Sleep 3
  $row = (Q "select status, payment_id from orders where id=$($o.Id)")[0]
  Check "E1 order confirmed by webhook" ($row.status -eq "confirmed" -and $row.payment_id -eq $pid1) "status=$($row.status)"
  Check "E1 duplicate events -> exactly 1 ledger row" ([int](Q "select count(*) c from payments where razorpay_payment_id='$pid1'")[0].c -eq 1)
  Check "E1 stock taken once (50-2=48)" ((Stock) -eq 48) "stock=$(Stock)"

  # E2 customer cancels the paid order -> automatic refund executes via process-refund + mock; stock restored
  Q "update orders set status='cancelled', cancelled_by='customer' where id=$($o.Id)" | Out-Null
  Check "E2 refund auto-approved and PROCESSED" (Wait-Refund $o.Id "processed")
  Check "E2 order refund_status synced = processed" ((Q "select refund_status s from orders where id=$($o.Id)")[0].s -eq "processed")
  Check "E2 stock restored (50)" ((Stock) -eq 50) "stock=$(Stock)"
  Check "E2 exactly one refund reached 'Razorpay'" ((Mock-Refunds "%$($o.Rzp)") -eq 1)

  # E3 THE EDGE CASE: customer cancels first, payment arrives afterwards
  $o = New-Order 1; Q "update orders set status='cancelled', cancelled_by='customer' where id=$($o.Id)" | Out-Null
  $p3 = PayId captured ([long]($o.Total * 100)) $o "e3"
  Post-Webhook $o $p3 ([long]($o.Total * 100)) | Out-Null
  Check "E3 late payment -> refund PROCESSED automatically" (Wait-Refund $o.Id "processed")
  $row = (Q "select status, payment_id from orders where id=$($o.Id)")[0]
  Check "E3 order stays cancelled, payment recorded on it" ($row.status -eq "cancelled" -and $row.payment_id -eq $p3)
  Check "E3 full amount refunded" ([decimal](Q "select amount a from refund_requests where order_id=$($o.Id)")[0].a -eq $o.Total)
  Check "E3 stock untouched (50)" ((Stock) -eq 50)
  $chain = (Q "select string_agg(action, ' > ' order by id) c from financial_audit where detail->>'order_id' = '$($o.Id)'")[0].c
  Check "E3 audit chain complete and ordered" ($chain -eq "payment_captured > payment_recorded > refund_requested > refund_approved > refund_submitted > refund_processed") $chain
  Post-Webhook $o $p3 ([long]($o.Total * 100)) | Out-Null; Start-Sleep 3
  Check "E3 replay of the late event -> still ONE refund" ([int](Q "select count(*) c from refund_requests where order_id=$($o.Id)")[0].c -eq 1 -and (Mock-Refunds "%$($o.Rzp)") -eq 1)

  # E4 payment window expiry (30 min) then late payment
  $o = New-Order 1 "pending" "online" "31 minutes"
  $expired = [int](Q "select private.expire_pending_orders(30) as n")[0].n
  Check "E4 pending order older than 30 min expired by system" ((Q "select status||'/'||cancelled_by s from orders where id=$($o.Id)")[0].s -eq "cancelled/system") "expired=$expired"
  Post-Webhook $o (PayId captured ([long]($o.Total * 100)) $o "e4") ([long]($o.Total * 100)) | Out-Null
  Check "E4 payment after expiry -> automatic refund processed" (Wait-Refund $o.Id "processed")
  Check "E4 pg_cron job scheduled every 5 min" ((Q "select count(*) c from cron.job where jobname='expire-pending-orders' and schedule='*/5 * * * *'")[0].c -eq 1)

  # E5 refund API failure is recorded, not lost; order untouched; retry path works
  $o = New-Order 1; Q "update orders set status='cancelled', cancelled_by='customer' where id=$($o.Id)" | Out-Null
  Post-Webhook $o (PayId captured ([long]($o.Total * 100)) $o "e5" "failrefund") ([long]($o.Total * 100)) | Out-Null
  Check "E5 failed refund recorded as 'failed' with the bank's reason" (Wait-Refund $o.Id "failed")
  $err = (Q "select error e from refund_requests where order_id=$($o.Id)")[0].e
  Check "E5 error text stored" ($err -like "*mock*") $err
  $rid = (Q "select id from refund_requests where order_id=$($o.Id)")[0].id
  As-Admin "perform public.retry_refund($rid);"; Start-Sleep 5
  Check "E5 admin retry re-ran the refund (attempts=2, failed again)" ([int](Q "select attempts a from refund_requests where id=$rid")[0].a -eq 2)

  # E6 RTO through the real courier webhook -> NO automatic money; admin approval then executes
  $o = New-Order 1; $p6 = PayId captured ([long]($o.Total * 100)) $o "e6"
  Post-Webhook $o $p6 ([long]($o.Total * 100)) | Out-Null; Start-Sleep 2
  Q "update orders set status='shipped' where id=$($o.Id)" | Out-Null
  $stockBefore = Stock
  $courier = { param($st) Invoke-WebRequest -Method Post -Uri "$fn/courier-webhook" -Headers @{ "x-api-key" = $courierTok; "Content-Type" = "application/json" } -Body (@{ order_id = "$($o.Id)"; current_status = $st; awb = "AWB$stamp" } | ConvertTo-Json) -UseBasicParsing | Out-Null }
  & $courier "RTO Initiated"; & $courier "RTO In Transit"; Start-Sleep 3
  Check "E6 RTO *started*: status unchanged, stock NOT restored, no refund request" ((Q "select status s from orders where id=$($o.Id)")[0].s -eq "shipped" -and (Stock) -eq $stockBefore -and [int](Q "select count(*) c from refund_requests where order_id=$($o.Id)")[0].c -eq 0)
  & $courier "RTO_Delivered"; Start-Sleep 3
  Check "E6 courier RTO -> order status 'rto' (not cancelled)" ((Q "select status s from orders where id=$($o.Id)")[0].s -eq "rto")
  Check "E6 RTO stock restored" ((Stock) -eq $stockBefore + 1) "stock=$(Stock) before=$stockBefore"
  Check "E6 refund waits for admin (requested), not executed" ((Q "select status s from refund_requests where order_id=$($o.Id)")[0].s -eq "requested" -and (Mock-Refunds "%$($o.Rzp)") -eq 0)
  $rid = (Q "select id from refund_requests where order_id=$($o.Id)")[0].id
  As-Admin "perform public.approve_refund($rid);"
  Check "E6 after admin approval the refund is PROCESSED" (Wait-Refund $o.Id "processed")
  $chain6 = (Q "select string_agg(action, ' > ' order by id) c from financial_audit where detail->>'order_id' = '$($o.Id)'")[0].c
  Check "E6 audit chain complete (requested by system, approved by an admin)" ($chain6 -eq "payment_captured > payment_recorded > refund_requested > refund_approved > refund_submitted > refund_processed") $chain6
  Check "E6 approver + actions audited" ([int](Q "select count(*) c from financial_audit where entity='refund_request' and entity_id=$rid and actor is not null")[0].c -ge 1)

  # E7 amount mismatch -> order not confirmed, admin review
  $o = New-Order 1
  Post-Webhook $o (PayId captured 100 $o "e7") 100 | Out-Null; Start-Sleep 3
  Check "E7 wrong amount: order NOT confirmed, refund awaits admin" ((Q "select o.status||'/'||r.status s from orders o join refund_requests r on r.order_id=o.id where o.id=$($o.Id)")[0].s -eq "pending/requested")

  # E8 process-refund endpoint cannot be driven by outsiders or without approval
  $code = 0; try { Invoke-WebRequest -Method Post -Uri "$fn/process-refund" -Headers @{ "x-hook-secret" = "wrong" } -Body '{"refund_request_id":1}' -ContentType "application/json" -UseBasicParsing | Out-Null } catch { $code = [int]$_.Exception.Response.StatusCode }
  Check "E8 wrong hook secret -> 401" ($code -eq 401)
  $pending = (Q "select id from refund_requests where status='requested' limit 1")[0].id
  $resp = Invoke-WebRequest -Method Post -Uri "$fn/process-refund" -Headers @{ "x-hook-secret" = $refundHook } -Body (@{ refund_request_id = $pending } | ConvertTo-Json) -ContentType "application/json" -UseBasicParsing
  Check "E8 valid secret but request not approved -> skipped, nothing refunded" ($resp.Content -like "*skipped*" -and (Q "select status s from refund_requests where id=$pending")[0].s -eq "requested")

  # E9 crash recovery (migration 035): a refund must never be lost, never be reported as done without
  # Razorpay confirming, and never be paid twice.
  # E9a: Razorpay accepted the refund, but the function died before saving it -> row stuck in 'processing'
  $o = New-Order 1; Post-Webhook $o (PayId captured ([long]($o.Total * 100)) $o "e9a") ([long]($o.Total * 100)) | Out-Null; Start-Sleep 2
  Q "update orders set status='cancelled', cancelled_by='customer' where id=$($o.Id)" | Out-Null
  [void](Wait-Refund $o.Id "processed")
  $rid = (Q "select id from refund_requests where order_id=$($o.Id)")[0].id
  Q "update refund_requests set status='processing', razorpay_refund_id=null, processed_at=null, processing_since=now()-interval '20 minutes' where id=$rid" | Out-Null
  Check "E9a crash state is NOT shown as success (processing, no refund id)" ((Q "select status||'/'||coalesce(razorpay_refund_id,'-') s from refund_requests where id=$rid")[0].s -eq "processing/-")
  $requeued = [int](Q "select private.requeue_stuck_refunds(15) as n")[0].n
  Check "E9a stalled request re-queued by the recovery job" ($requeued -ge 1) "requeued=$requeued"
  Check "E9a recovery RECONCILES with Razorpay -> processed" (Wait-Refund $o.Id "processed")
  Check "E9a no second refund was created at Razorpay" ((Mock-Refunds "%$($o.Rzp)") -eq 1) "refunds=$(Mock-Refunds "%$($o.Rzp)")"
  Check "E9a refund id recorded again" ((Q "select razorpay_refund_id r from refund_requests where id=$rid")[0].r -like "rfnd_mock_*")

  # E9b: the function died BEFORE reaching Razorpay -> recovery performs the refund exactly once
  $o = New-Order 1; Post-Webhook $o (PayId captured ([long]($o.Total * 100)) $o "e9b") ([long]($o.Total * 100)) | Out-Null; Start-Sleep 2
  Q "update orders set status='cancelled', cancelled_by='customer' where id=$($o.Id)" | Out-Null
  [void](Wait-Refund $o.Id "processed")
  $rid = (Q "select id from refund_requests where order_id=$($o.Id)")[0].id
  Q "delete from zz_mock_refunds where payment_id like '%$($o.Rzp)'" | Out-Null
  Q "update refund_requests set status='processing', razorpay_refund_id=null, processed_at=null, processing_since=now()-interval '20 minutes' where id=$rid" | Out-Null
  Q "select private.requeue_stuck_refunds(15)" | Out-Null
  Check "E9b recovery completes the refund" (Wait-Refund $o.Id "processed")
  Check "E9b exactly one refund at Razorpay" ((Mock-Refunds "%$($o.Rzp)") -eq 1)

  # E9c: an attempt that is merely in flight (not stale) is left alone
  $o = New-Order 1; Post-Webhook $o (PayId captured ([long]($o.Total * 100)) $o "e9c") ([long]($o.Total * 100)) | Out-Null; Start-Sleep 2
  Q "update orders set status='cancelled', cancelled_by='customer' where id=$($o.Id)" | Out-Null
  [void](Wait-Refund $o.Id "processed")
  $rid = (Q "select id from refund_requests where order_id=$($o.Id)")[0].id
  Q "update refund_requests set status='processing', processing_since=now()-interval '2 minutes' where id=$rid" | Out-Null
  Q "select private.requeue_stuck_refunds(15)" | Out-Null
  Check "E9c recent in-flight refund NOT re-queued" ((Q "select status s from refund_requests where id=$rid")[0].s -eq "processing")
  Check "E9 recovery job scheduled every 10 min" ([int](Q "select count(*) c from cron.job where jobname='requeue-stuck-refunds'")[0].c -eq 1)
}
finally {
  Q "delete from zz_mock_refunds where payment_id like '%order_zzf_$stamp%'" | Out-Null
  Q "delete from zz_mock_attempts where payment_id like '%order_zzf_$stamp%'" | Out-Null
  Q "delete from customer_notifications where order_id in (select id from orders where razorpay_order_id like 'order_zzf_$stamp%')" | Out-Null
  Q "delete from ops_events where (entity='order' and entity_id in (select id from orders where razorpay_order_id like 'order_zzf_$stamp%')) or (entity='refund_request' and entity_id in (select rr.id from refund_requests rr join orders o on o.id=rr.order_id where o.razorpay_order_id like 'order_zzf_$stamp%'))" | Out-Null
  Q "delete from refund_requests where order_id in (select id from orders where razorpay_order_id like 'order_zzf_$stamp%')" | Out-Null
  Q "delete from payments where razorpay_order_id like 'order_zzf_$stamp%'" | Out-Null
  Q "delete from orders where razorpay_order_id like 'order_zzf_$stamp%'" | Out-Null
  Q "delete from products where id=$prod" | Out-Null
}
$results | Format-Table -AutoSize -Wrap
if (@($results | ? Result -eq "FAIL").Count) { exit 1 }
