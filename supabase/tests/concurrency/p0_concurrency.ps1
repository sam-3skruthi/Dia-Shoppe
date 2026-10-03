# P0 concurrency proof - run ONLY against a DEV Supabase project.
#   ./p0_concurrency.ps1 -Ref <dev-project-ref> [-WebhookUrl https://<dev>.supabase.co/functions/v1/razorpay-webhook]
# Uses real parallel HTTP requests (separate DB connections) so the row locks are
# genuinely contended. Creates throwaway rows (sku ZZ-CONC-*), deletes them at the end.
# STATUS: written, NOT yet executed (no DEV project exists yet).
param(
  [Parameter(Mandatory = $true)][string]$Ref,
  [string]$WebhookUrl = "",                 # optional S5: signed duplicate Razorpay webhooks
  [string]$WebhookSecretEnv = "DEV_RAZORPAY_WEBHOOK_SECRET"
)
$ErrorActionPreference = "Stop"
$PROD = "vkcwfwgxelmamuydwrow"
if ($Ref -eq $PROD) { throw "Refusing to run concurrency tests against PRODUCTION ($PROD)." }

Add-Type -AssemblyName System.Net.Http
$token = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", "User"); if (-not $token) { $token = $env:SUPABASE_ACCESS_TOKEN }
$api = "https://api.supabase.com/v1/projects/$Ref/database/query"
$client = New-Object System.Net.Http.HttpClient
$client.Timeout = [TimeSpan]::FromSeconds(60)
$client.DefaultRequestHeaders.Add("Authorization", "Bearer $token")
$client.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0")

function New-Req([string]$sql) {
  $json = @{ query = $sql } | ConvertTo-Json -Compress
  $c = New-Object System.Net.Http.StringContent($json, [Text.Encoding]::UTF8, "application/json")
  $client.PostAsync($api, $c)           # returns a Task - started immediately
}
function Read-Res($task) { $task.Result.Content.ReadAsStringAsync().Result | ConvertFrom-Json }
function Q([string]$sql) { Read-Res (New-Req $sql) }
function Parallel-Q([string[]]$sqls) {  # fire all, then collect
  $tasks = @(); foreach ($s in $sqls) { $tasks += New-Req $s }
  [System.Threading.Tasks.Task]::WaitAll($tasks)
  $tasks | ForEach-Object { Read-Res $_ }
}

$results = @()
function Check([string]$name, [bool]$ok, [string]$detail) {
  $script:results += [pscustomobject]@{ Test = $name; Result = $(if ($detail -like "SKIPPED*") { "SKIP" } elseif ($ok) { "PASS" } else { "FAIL" }); Detail = $detail }
}

$uid = (Q "select id from user_profiles where role='customer' limit 1")[0].id
$cat = (Q "select id from categories limit 1")[0].id
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$prodIds = @(); $orderIds = @()

function New-Product([int]$stock) {
  $id = (Q "insert into products(name,price,sku,category_id,stock_qty,is_active) values ('ZZ conc',100,'ZZ-CONC-$stamp-' || floor(random()*1e6)::int,$cat,$stock,false) returning id")[0].id
  $script:prodIds += $id; $id
}
function New-Order([long]$prod, [int]$qty, [string]$rzp) {
  $id = (Q "insert into orders(user_id,total_amount,status,payment_method,shipping_address,shipping_phone,razorpay_order_id) values ('$uid',1,'pending','online','x','0','$rzp') returning id")[0].id
  Q "insert into order_items(order_id,product_id,quantity,price_at_purchase) values ($id,$prod,$qty,1)" | Out-Null
  $script:orderIds += $id; $id
}
function Stock($p) { [int](Q "select stock_qty from products where id=$p")[0].stock_qty }

try {
  # ---- S1: 8 simultaneous confirmations of the SAME order (webhook + verify-payment + retries)
  $p = New-Product 10; $o = New-Order $p 3 "order_zz_s1_$stamp"
  $rs = Parallel-Q (1..8 | ForEach-Object { "select public.confirm_online_payment($o,'pay_zz_s1') as r" })
  $wins = @($rs | Where-Object { $_[0].r.won -eq $true }).Count
  $row = (Q "select o.status, o.payment_id, oi.stock_deducted_qty d from orders o join order_items oi on oi.order_id=o.id where o.id=$o")[0]
  Check "S1 exactly one winner of 8" ($wins -eq 1) "winners=$wins"
  Check "S1 stock decremented once (10-3=7)" ((Stock $p) -eq 7) "stock=$(Stock $p)"
  Check "S1 final state confirmed + payment_id" ($row.status -eq 'confirmed' -and $row.payment_id -eq 'pay_zz_s1' -and $row.d -eq 3) "status=$($row.status) pay=$($row.payment_id) deducted=$($row.d)"

  # ---- S2: oversell race - 10 orders x1 unit, only 3 in stock, each payment delivered twice at once
  $strict = [int](Q "select count(*) c from pg_proc where proname='order_stock_shortages'")[0].c -gt 0
  $p2 = New-Product 3; $os = 1..10 | ForEach-Object { New-Order $p2 1 "order_zz_s2_${stamp}_$_" }
  $sqls = @()
  foreach ($x in $os) {
    if ($strict) { $amt2 = [int]([decimal](Q "select total_amount t from orders where id=$x")[0].t * 100)
      1..2 | ForEach-Object { $sqls += "select public.settle_payment('pay_zz_s2_${stamp}_$x','order_zz_s2_${stamp}_$($os.IndexOf($x) + 1)',$amt2,'test') as r" } }
    else { 1..2 | ForEach-Object { $sqls += "select public.confirm_online_payment($x,'pay_zz_s2_$x') as r" } }
  }
  Parallel-Q $sqls | Out-Null
  $agg = (Q "select (select stock_qty from products where id=$p2) stock, (select coalesce(sum(stock_deducted_qty),0) from order_items where product_id=$p2) taken, (select count(*) from orders where id in ($($os -join ',')) and status='confirmed') confirmed, (select count(*) from orders where id in ($($os -join ',')) and status='on_hold') held")[0]
  Check "S2 stock never negative" ([int]$agg.stock -ge 0) "stock=$($agg.stock)"
  Check "S2 exactly 3 units handed out (no oversell, no double-take)" ([int]$agg.taken -eq 3 -and [int]$agg.stock -eq 0) "taken=$($agg.taken) stock=$($agg.stock)"
  if ($strict) {
    Check "S2b INVARIANT: exactly 3 orders confirmed, the other 7 ON HOLD (never confirmed short)" ([int]$agg.confirmed -eq 3 -and [int]$agg.held -eq 7) "confirmed=$($agg.confirmed) held=$($agg.held)"
    $ev = (Q "select (select count(*) from refund_requests where order_id in ($($os -join ',')) and reason='insufficient_stock' and status='requested') r, (select count(*) from ops_events where code='insufficient_stock' and entity_id in ($($os -join ',')) and resolved_at is null) e, (select count(*) from payments where order_id in ($($os -join ','))) p")[0]
    Check "S2b every held order: payment recorded + refund awaiting admin + ops alert, none duplicated" ([int]$ev.r -eq 7 -and [int]$ev.e -eq 7 -and [int]$ev.p -eq 10) "refunds=$($ev.r) alerts=$($ev.e) payments=$($ev.p)"
  } else {
    Check "S2 all 10 paid orders confirmed (legacy clamp behaviour, schema < 036)" ([int]$agg.confirmed -eq 10) "confirmed=$($agg.confirmed)"
  }

  # ---- S3: forced overlap - A holds the lock 4s, B arrives at +1s and must WAIT, then lose
  $p3 = New-Product 10; $o3 = New-Order $p3 2 "order_zz_s3_$stamp"
  $ta = New-Req "do `$`$ begin perform public.confirm_online_payment($o3,'pay_zz_s3'); perform pg_sleep(4); end `$`$"
  Start-Sleep -Milliseconds 1000
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $rb = Q "select public.confirm_online_payment($o3,'pay_zz_s3_dup') as r"
  $sw.Stop(); $ta.Wait()
  Check "S3 second caller blocked on the lock (>=2s)" ($sw.Elapsed.TotalSeconds -ge 2) ("waited {0:N1}s" -f $sw.Elapsed.TotalSeconds)
  Check "S3 second caller lost, stock taken once" (($rb[0].r.won -eq $false) -and ((Stock $p3) -eq 8)) "won=$($rb[0].r.won) stock=$(Stock $p3)"
  Check "S3 original payment_id kept (not overwritten by duplicate)" ((Q "select payment_id from orders where id=$o3")[0].payment_id -eq 'pay_zz_s3') ""

  # ---- S4: 6 simultaneous cancellations of the confirmed S1 order -> restored exactly once
  Parallel-Q (1..6 | ForEach-Object { "update orders set status='cancelled' where id=$o and status<>'cancelled'" }) | Out-Null
  Check "S4 parallel cancels restore once (7+3=10)" ((Stock $p) -eq 10) "stock=$(Stock $p)"

  # ---- S6 (needs migration 034): the REAL settlement path under contention
  if ([int](Q "select count(*) c from pg_proc where proname='settle_payment'")[0].c -gt 0) {
    # S6a: 8 simultaneous deliveries of the same captured payment
    $p6 = New-Product 20; $o6 = New-Order $p6 2 "order_zz_s6a_$stamp"; $amt = [int]([decimal](Q "select total_amount t from orders where id=$o6")[0].t * 100)
    $rs = Parallel-Q (1..8 | ForEach-Object { "select public.settle_payment('pay_zz_s6a_$stamp','order_zz_s6a_$stamp',$amt,'test') as r" })
    $kinds = @($rs | ForEach-Object { $_[0].r.result })
    Check "S6a exactly one 'confirmed', seven 'duplicate_event'" ((@($kinds | ? { $_ -eq 'confirmed' }).Count -eq 1) -and (@($kinds | ? { $_ -eq 'duplicate_event' }).Count -eq 7)) ($kinds -join ',')
    Check "S6a one ledger row, stock taken once (20-2=18)" (([int](Q "select count(*) c from payments where razorpay_payment_id='pay_zz_s6a_$stamp'")[0].c -eq 1) -and ((Stock $p6) -eq 18)) "stock=$(Stock $p6)"

    # S6b: customer cancel RACES the payment, 10 orders. Whatever interleaving wins, the invariants must hold:
    #   order cancelled, exactly ONE live refund for the payment, stock back to the starting level, no negative stock.
    $p7 = New-Product 30; $bad = @(); $reasons = @{}
    1..10 | ForEach-Object {
      $o7 = New-Order $p7 1 "order_zz_s6b_${stamp}_$_"; $amt7 = [int]([decimal](Q "select total_amount t from orders where id=$o7")[0].t * 100)
      Parallel-Q @("update orders set status='cancelled', cancelled_by='customer' where id=$o7",
                   "select public.settle_payment('pay_zz_s6b_${stamp}_$_','order_zz_s6b_${stamp}_$_',$amt7,'test') as r") | Out-Null
      $st = (Q "select o.status, (select count(*) from refund_requests rr join payments p on p.id=rr.payment_id where p.order_id=o.id and rr.status in ('requested','approved','processing','processed')) live from orders o where o.id=$o7")[0]
      $rs7 = (Q "select string_agg(rr.reason, ',') r from refund_requests rr where rr.order_id=$o7")[0].r; $reasons[$rs7] = 1 + [int]$reasons[$rs7]
      if ($st.status -ne 'cancelled' -or [int]$st.live -ne 1) { Start-Sleep 6; $why = (Q "select string_agg(rr.status || ':' || coalesce(left(rr.error,90),''), ' | ') w from refund_requests rr where rr.order_id=$o7")[0].w; $bad += "order $o7 status=$($st.status) liveRefunds=$($st.live) requests=[$why]" }
    }
    Check "S6b 10 cancel-vs-payment races: always cancelled + exactly one refund" ($bad.Count -eq 0) (($bad -join '; ') + " outcomes: " + (($reasons.GetEnumerator() | % { "$($_.Name)=$($_.Value)" }) -join ' , '))
    Check "S6b stock back to 30 after all races, never negative" ((Stock $p7) -eq 30) "stock=$(Stock $p7)"
  } else { Check "S6 settlement path" $true "SKIPPED (migration 034 not present)" }

  # ---- S5 (optional): signed duplicate Razorpay webhooks through the real function
  $wsec = [Environment]::GetEnvironmentVariable($WebhookSecretEnv)
  if ($WebhookUrl -and $wsec) {
    $p5 = New-Product 10; $o5 = New-Order $p5 2 "order_zz_s5_$stamp"
    $body = (@{ event = "payment.captured"; payload = @{ payment = @{ entity = @{ id = "pay_zz_s5"; order_id = "order_zz_s5_$stamp"; amount = [int]([decimal](Q "select total_amount t from orders where id=$o5")[0].t * 100); status = "captured" } } } } | ConvertTo-Json -Depth 6 -Compress)
    $hm = New-Object System.Security.Cryptography.HMACSHA256 (,[Text.Encoding]::UTF8.GetBytes($wsec))
    $sig = ($hm.ComputeHash([Text.Encoding]::UTF8.GetBytes($body)) | ForEach-Object { $_.ToString("x2") }) -join ""
    $tasks = 1..6 | ForEach-Object {
      $req = New-Object System.Net.Http.HttpRequestMessage ([System.Net.Http.HttpMethod]::Post, $WebhookUrl)
      $req.Headers.Add("x-razorpay-signature", $sig)
      $req.Content = New-Object System.Net.Http.StringContent($body, [Text.Encoding]::UTF8, "application/json")
      $client.SendAsync($req)
    }
    [System.Threading.Tasks.Task]::WaitAll($tasks)
    Check "S5 all webhook deliveries acknowledged 200" (@($tasks | Where-Object { [int]$_.Result.StatusCode -ne 200 }).Count -eq 0) ""
    Check "S5 duplicate webhooks decrement once (10-2=8)" ((Stock $p5) -eq 8) "stock=$(Stock $p5)"
  } else { Check "S5 webhook duplicates" $true "SKIPPED (pass -WebhookUrl and set `$env:$WebhookSecretEnv)" }
}
finally {
  Q "delete from zz_mock_refunds where payment_id like '%zz_%$stamp%'" | Out-Null
  if ($orderIds.Count) {
    Q "delete from customer_notifications where order_id in ($($orderIds -join ','))" | Out-Null
    Q "delete from ops_events where (entity='order' and entity_id in ($($orderIds -join ','))) or (entity='refund_request' and entity_id in (select id from refund_requests where order_id in ($($orderIds -join ','))))" | Out-Null
    Q "delete from refund_requests where order_id in ($($orderIds -join ','))" | Out-Null
    Q "delete from payments where order_id in ($($orderIds -join ','))" | Out-Null
    Q "delete from orders where id in ($($orderIds -join ','))" | Out-Null }
  if ($prodIds.Count)  { Q "delete from products where id in ($($prodIds -join ','))" | Out-Null }
}
$results | Format-Table -AutoSize -Wrap
if (@($results | Where-Object Result -eq "FAIL").Count) { exit 1 }
