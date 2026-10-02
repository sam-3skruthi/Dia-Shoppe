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
  $script:results += [pscustomobject]@{ Test = $name; Result = $(if ($ok) { "PASS" } else { "FAIL" }); Detail = $detail }
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

  # ---- S2: oversell race - 10 different orders x1 unit, only 3 in stock, each confirmed twice in parallel
  $p2 = New-Product 3; $os = 1..10 | ForEach-Object { New-Order $p2 1 "order_zz_s2_${stamp}_$_" }
  $sqls = @(); foreach ($x in $os) { 1..2 | ForEach-Object { $sqls += "select public.confirm_online_payment($x,'pay_zz_s2_$x') as r" } }
  Parallel-Q $sqls | Out-Null
  $agg = (Q "select (select stock_qty from products where id=$p2) stock, (select coalesce(sum(stock_deducted_qty),0) from order_items where product_id=$p2) taken, (select count(*) from orders where id in ($($os -join ',')) and status='confirmed') confirmed")[0]
  Check "S2 stock never negative" ([int]$agg.stock -ge 0) "stock=$($agg.stock)"
  Check "S2 exactly 3 units handed out (no oversell, no double-take)" ([int]$agg.taken -eq 3 -and [int]$agg.stock -eq 0) "taken=$($agg.taken) stock=$($agg.stock)"
  Check "S2 all 10 paid orders confirmed (money was taken)" ([int]$agg.confirmed -eq 10) "confirmed=$($agg.confirmed)"

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

  # ---- S5 (optional): signed duplicate Razorpay webhooks through the real function
  $wsec = [Environment]::GetEnvironmentVariable($WebhookSecretEnv)
  if ($WebhookUrl -and $wsec) {
    $p5 = New-Product 10; $o5 = New-Order $p5 2 "order_zz_s5_$stamp"
    $body = (@{ event = "payment.captured"; payload = @{ payment = @{ entity = @{ id = "pay_zz_s5"; order_id = "order_zz_s5_$stamp" } } } } | ConvertTo-Json -Depth 6 -Compress)
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
  if ($orderIds.Count) { Q "delete from orders where id in ($($orderIds -join ','))" | Out-Null }
  if ($prodIds.Count)  { Q "delete from products where id in ($($prodIds -join ','))" | Out-Null }
}
$results | Format-Table -AutoSize -Wrap
if (@($results | Where-Object Result -eq "FAIL").Count) { exit 1 }
