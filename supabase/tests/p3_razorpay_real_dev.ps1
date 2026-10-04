# REAL Razorpay TEST-mode verification against the deployed DEV functions. YOU run this in your own terminal.
#
# Setup (once):
#   1. Razorpay Dashboard -> switch to TEST mode -> API Keys -> generate; Webhooks -> add
#        URL    https://lffnmycocbtpyvntccbg.supabase.co/functions/v1/razorpay-webhook
#        events payment.captured, order.paid        secret: a value you choose (keep it, you will type it below)
#   2. ./supabase/scripts/dev-razorpay-mode.ps1 -Ref lffnmycocbtpyvntccbg -Mode real
#   3. ./supabase/tests/p3_razorpay_real_dev.ps1 -Ref lffnmycocbtpyvntccbg
#   4. when finished: ./supabase/scripts/dev-razorpay-mode.ps1 -Ref lffnmycocbtpyvntccbg -Mode mock
# Key id must be rzp_test_*; anything else is refused. Nothing is printed or stored except results.
# The script opens a small local page with Razorpay Checkout; pay with the test card 4111 1111 1111 1111,
# any future expiry, any CVV, and choose Success on the bank page. Three payments are needed.
param([Parameter(Mandatory = $true)][string]$Ref, [switch]$NoLaunch)   # -NoLaunch: only print the URL (for tests)
$ErrorActionPreference = "Stop"
if ($Ref -eq "vkcwfwgxelmamuydwrow") { throw "DEV only." }
# --- runtime compatibility check (Windows PowerShell 5.1+ / PowerShell 7): fail early, before any prompt ---
function Get-PlainText([System.Security.SecureString]$s) { (New-Object System.Management.Automation.PSCredential('x', $s)).GetNetworkCredential().Password }
if ($PSVersionTable.PSVersion.Major -lt 5) { throw "PowerShell 5.1 or newer is required (found $($PSVersionTable.PSVersion))." }
if ((Get-PlainText (ConvertTo-SecureString 'compat-probe' -AsPlainText -Force)) -ne 'compat-probe') { throw "SecureString conversion is not working in this PowerShell." }
$pat = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", "User")
$mh = @{ Authorization = "Bearer $pat"; "User-Agent" = "Mozilla/5.0"; "Content-Type" = "application/json" }
function Q([string]$sql) { try { Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" -Headers $mh -Body ([Text.Encoding]::UTF8.GetBytes((@{ query = $sql } | ConvertTo-Json -Depth 3))) } catch { throw ("SQL error: " + (($_.ErrorDetails.Message -replace '(sbp_|eyJ)[A-Za-z0-9._-]+', '<redacted>') -replace '\s+', ' ')) } }

$keyId = Read-Host "Razorpay TEST key id"
if ($keyId -notmatch '^rzp_test_[A-Za-z0-9]+$') { throw "Refused: not a rzp_test_ key." }
$sec = Read-Host "Razorpay TEST key secret" -AsSecureString
$ks = Get-PlainText $sec; $sec = $null
$rzH = @{ Authorization = "Basic " + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${keyId}:$ks")); "Content-Type" = "application/json" }; $ks = $null
function Rz([string]$method, [string]$path, $body = $null) {
  try { $a = @{ Method = $method; Uri = "https://api.razorpay.com$path"; Headers = $rzH; UseBasicParsing = $true }; if ($body) { $a.Body = ($body | ConvertTo-Json -Compress) }
        $r = Invoke-WebRequest @a; [pscustomobject]@{ Code = [int]$r.StatusCode; Json = ($r.Content | ConvertFrom-Json) } }
  catch { $msg = ""; try { $msg = ($_.ErrorDetails.Message | ConvertFrom-Json).error.description } catch {}; [pscustomobject]@{ Code = [int]$_.Exception.Response.StatusCode; Json = $null; Error = $msg } }
}
$results = @(); function Check($n, [bool]$ok, $d = "") { $script:results += [pscustomobject]@{ Test = $n; Result = $(if ($ok) { "PASS" } else { "FAIL" }); Detail = $d } }
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds(); $seq = 0
$uid = (Q "select id from user_profiles where email='dev-customer@example.test'")[0].id
$cat = (Q "select id from categories limit 1")[0].id
$prod = (Q "insert into products(name,price,sku,category_id,stock_qty,is_active) values ('ZZ rzp real',100,'ZZ-RZP-$stamp',$cat,20,false) returning id")[0].id
function Stock { [int](Q "select stock_qty from products where id=$prod")[0].stock_qty }
function As-Admin([string]$stmt) { Q "do `$`$ begin perform set_config('request.jwt.claims', json_build_object('sub',(select id from user_profiles where email='dev-admin@example.test'),'role','authenticated')::text, true); set local role authenticated; $stmt end `$`$" | Out-Null }
function Wait-For([scriptblock]$cond, [int]$secs = 90) { for ($i = 0; $i -lt $secs; $i++) { if (& $cond) { return $true }; Start-Sleep 1 }; $false }

# a DB order (total Rs 199) + a REAL Razorpay order for $paise
function New-Case([long]$paise) {
  $script:seq++
  $o = (Q "insert into orders(user_id,total_amount,status,payment_method,shipping_address,shipping_phone,shipping_email,shipping_name) values ('$uid',1,'pending','online','x','0','real$script:seq@example.test','Real Test') returning id")[0].id
  Q "insert into order_items(order_id,product_id,quantity,price_at_purchase) values ($o,$prod,1,1)" | Out-Null
  $ro = Rz Post "/v1/orders" @{ amount = $paise; currency = "INR"; receipt = "zzreal_${stamp}_$script:seq" }
  if ($ro.Code -ne 200) { throw "Razorpay order creation failed ($($ro.Code)): $($ro.Error)" }
  Q "update orders set razorpay_order_id='$($ro.Json.id)' where id=$o" | Out-Null
  [pscustomobject]@{ Id = $o; Rzp = $ro.Json.id; Paise = $paise }
}
function Pay-InBrowser($c) {
  # Serves ONE payment page for ONE already-created Razorpay TEST order on http://localhost (never file://),
  # prints the URL, tries to open a browser, and waits for the page to report the payment id.
  # No secret ever appears in the page, the URL or the output: only the public key id and the order id.
  $token = [guid]::NewGuid().ToString("N")
  $listener = $null; $port = $null
  foreach ($p in 8765..8785) {
    try { $l = New-Object System.Net.HttpListener; $l.Prefixes.Add("http://localhost:$p/"); $l.Start(); $listener = $l; $port = $p; break } catch { }
  }
  if (-not $listener) { throw "Could not start the local payment page (ports 8765-8785 are all busy or blocked). Close other tools using them and retry." }
  $url = "http://localhost:$port/pay/$token"

  $page = @'
<!doctype html><meta charset="utf-8"><title>DEV test payment</title>
<body style="font-family:sans-serif;max-width:560px;margin:40px auto">
<h3>Dia Shoppe DEV - Razorpay TEST payment</h3>
<p>Order <b>__ORDER__</b> - Rs __RUPEES__ (TEST mode, no real money). Test card <b>4111 1111 1111 1111</b>, any future expiry, any CVV, choose <b>Success</b>.</p>
<p id="s">Opening checkout...</p><button id="b" onclick="go()">Open checkout again</button>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
var paid = false;
function go() {
  if (paid) { document.getElementById('s').innerText = 'Already paid - nothing more to do. You may close this tab.'; return; }
  new Razorpay({
    key: '__KEY__', order_id: '__ORDER__', amount: __AMOUNT__, currency: 'INR', name: 'Dia Shoppe DEV', description: 'test',
    handler: function (r) {
      paid = true;
      document.getElementById('s').innerText = 'PAID ' + r.razorpay_payment_id + ' - reporting back to the test runner...';
      fetch('/done/__TOKEN__?pid=' + encodeURIComponent(r.razorpay_payment_id)).then(function () {
        document.getElementById('s').innerText = 'PAID ' + r.razorpay_payment_id + ' - you may close this tab.';
      });
    },
    modal: { ondismiss: function () { if (!paid) document.getElementById('s').innerText = 'Checkout closed without paying. Click "Open checkout again" (same order, no duplicate).'; } }
  }).open();
}
window.onload = go;
</script>
'@
  $page = $page.Replace("__KEY__", $keyId).Replace("__ORDER__", $c.Rzp).Replace("__AMOUNT__", [string]$c.Paise).Replace("__RUPEES__", ("{0:N2}" -f ($c.Paise / 100))).Replace("__TOKEN__", $token)

  Write-Host ""
  Write-Host "==> CHECKOUT URL (TEST mode): $url" -ForegroundColor Cyan
  Write-Host "    Pay with test card 4111 1111 1111 1111, any future expiry, any CVV, then choose Success."
  $opened = $false
  if (-not $NoLaunch) {
    foreach ($try in @({ Start-Process $url }, { Start-Process "cmd.exe" -ArgumentList "/c", "start", '""', $url -WindowStyle Hidden }, { Start-Process "explorer.exe" -ArgumentList $url })) {
      try { & $try; $opened = $true; break } catch { }
    }
  }
  if ($opened) { Write-Host "    A browser was asked to open it. If nothing appears within ~10 seconds, copy the URL above into any browser." }
  else { Write-Host "    Could not launch a browser automatically: open the URL above manually." -ForegroundColor Yellow }
  Write-Host "    Waiting for the payment to complete (up to 10 minutes; Ctrl+C aborts and cleans up)..."

  $paidId = $null; $deadline = (Get-Date).AddMinutes(10)
  try {
    while (-not $paidId -and (Get-Date) -lt $deadline) {
      $task = $listener.GetContextAsync()
      while (-not $task.Wait(500)) { if ((Get-Date) -ge $deadline) { break } }
      if (-not $task.IsCompleted) { break }
      $ctx = $task.Result; $path = $ctx.Request.Url.AbsolutePath
      $body = ""; $code = 200; $type = "text/html; charset=utf-8"
      if ($path -eq "/pay/$token") { $body = $page }
      elseif ($path -eq "/done/$token") { $q = $ctx.Request.QueryString["pid"]; if ($q -match '^pay_[A-Za-z0-9]+$') { $paidId = $q; $body = "ok"; $type = "text/plain" } else { $code = 400; $body = "bad payment id"; $type = "text/plain" } }
      else { $code = 404; $body = "not found"; $type = "text/plain" }
      $bytes = [Text.Encoding]::UTF8.GetBytes($body); $ctx.Response.StatusCode = $code; $ctx.Response.ContentType = $type
      $ctx.Response.ContentLength64 = $bytes.Length; $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length); $ctx.Response.OutputStream.Close()
    }
  } finally { $listener.Stop(); $listener.Close() }
  if (-not $paidId) { throw "No payment was reported within 10 minutes for order $($c.Rzp). Nothing else was created; re-run to try again." }
  Write-Host "    Payment reported by the browser: $paidId" -ForegroundColor Green
  $paidId
}
function Pay-Id($c) { (Q "select razorpay_payment_id p from payments where razorpay_order_id='$($c.Rzp)'")[0].p }

try {
  # ---------- R0 credentials + real API shape
  $ping = Rz Get "/v1/payments?count=1"
  Check "R0 TEST credentials accepted by the real API" ($ping.Code -eq 200)

  # ---------- R1 normal payment: real captured payload -> ledger -> confirmed -> stock once
  $c1 = New-Case 19900; $null = Pay-InBrowser $c1
  Check "R1 webhook confirmed the order" (Wait-For { (Q "select status s from orders where id=$($c1.Id)")[0].s -eq "confirmed" })
  $p1 = Pay-Id $c1
  $raw = (Q "select raw::text r from payments where razorpay_order_id='$($c1.Rzp)'")[0].r | ConvertFrom-Json
  Check "R1 ledger row has the real payment id + amount 199.00" ($p1 -like "pay_*" -and [decimal](Q "select amount a from payments where razorpay_order_id='$($c1.Rzp)'")[0].a -eq 199) $p1
  Check "R1 real payload carries id/amount/currency/status/order_id/method" (@("id", "amount", "currency", "status", "order_id", "method" | ? { $null -eq $raw.$_ }).Count -eq 0) ("keys: " + (($raw.PSObject.Properties.Name | select -First 30) -join ","))
  Check "R1 stock taken once (20-1=19)" ((Stock) -eq 19) "stock=$(Stock)"
  $api = Rz Get "/v1/payments/$p1"
  Check "R1 independent GET /payments/:id agrees (captured, 19900, same order)" ($api.Json.status -eq "captured" -and $api.Json.amount -eq 19900 -and $api.Json.order_id -eq $c1.Rzp)

  # ---------- R2 wrong amount: Razorpay order for Rs 150 while the DB order costs Rs 199
  $c2 = New-Case 15000; $null = Pay-InBrowser $c2
  Check "R2 wrong amount: order NOT confirmed, refund waits for admin" (Wait-For { (Q "select status s from refund_requests where order_id=$($c2.Id)" | select -First 1).s -eq "requested" } 60)
  Check "R2 order still pending, nothing deducted" (((Q "select status s from orders where id=$($c2.Id)")[0].s -eq "pending") -and (Stock) -eq 19)
  $rr2 = (Q "select id from refund_requests where order_id=$($c2.Id)")[0].id
  As-Admin "perform public.approve_refund($rr2);"
  Check "R2 after admin approval a REAL refund is processed" (Wait-For { (Q "select status s from refund_requests where id=$rr2")[0].s -eq "processed" } 60)
  $p2 = Pay-Id $c2; $l2 = Rz Get "/v1/payments/$p2/refunds"
  Check "R2 refund lookup returns exactly one refund tagged with our request id" ($l2.Json.items.Count -eq 1 -and [string]$l2.Json.items[0].notes.refund_request_id -eq [string]$rr2) ("notes=" + ($l2.Json.items[0].notes | ConvertTo-Json -Compress))
  Check "R2 refund amount = what was captured (15000)" ($l2.Json.items[0].amount -eq 15000)

  # ---------- R3 late payment after cancellation -> automatic full refund
  $c3 = New-Case 19900
  Q "update orders set status='cancelled', cancelled_by='customer' where id=$($c3.Id)" | Out-Null
  $null = Pay-InBrowser $c3
  Check "R3 late payment -> refund PROCESSED automatically" (Wait-For { (Q "select status s from refund_requests where order_id=$($c3.Id)" | select -First 1).s -eq "processed" } 90)
  $p3 = Pay-Id $c3; $rr3 = (Q "select id from refund_requests where order_id=$($c3.Id)")[0].id; $l3 = Rz Get "/v1/payments/$p3/refunds"
  Check "R3 order stays cancelled, stock untouched, full amount refunded" (((Q "select status s from orders where id=$($c3.Id)")[0].s -eq "cancelled") -and (Stock) -eq 19 -and $l3.Json.items[0].amount -eq 19900)

  # ---------- R4 idempotency / crash recovery against the REAL refund API
  Q "update refund_requests set status='processing', razorpay_refund_id=null, processed_at=null, processing_since=now()-interval '20 minutes' where id=$rr3" | Out-Null
  Q "select private.requeue_stuck_refunds(15)" | Out-Null
  Check "R4 lost-result recovery reconciles instead of refunding twice" (Wait-For { (Q "select status s from refund_requests where id=$rr3")[0].s -eq "processed" } 60)
  $l3b = Rz Get "/v1/payments/$p3/refunds"
  Check "R4 Razorpay still shows exactly ONE refund for the payment" ($l3b.Json.items.Count -eq 1) "refunds=$($l3b.Json.items.Count)"
  $dup = Rz Post "/v1/payments/$p3/refund" @{ amount = 19900 }
  Check "R4 a deliberate second refund is refused by Razorpay itself" ($dup.Code -ge 400) ("HTTP $($dup.Code): $($dup.Error)")

  # ---------- R5 a REAL gateway refusal is recorded, alerted, and does not reach the customer
  Q "update refund_requests set status='rejected' where id=$rr3" | Out-Null          # lets us open a second request for the same payment
  $pid3 = (Q "select id from payments where razorpay_payment_id='$p3'")[0].id
  $rr5 = (Q "insert into refund_requests(payment_id,order_id,amount,reason,status,requires_approval) values ($pid3,$($c3.Id),199,'admin_cancel','requested',false) returning id")[0].id
  Q "update refund_requests set status='approved', approved_at=now() where id=$rr5" | Out-Null
  Check "R5 gateway refusal is recorded as failed with Razorpay's own words" (Wait-For { (Q "select status s from refund_requests where id=$rr5")[0].s -eq "failed" } 60)
  Check "R5 real error text stored" ((Q "select length(coalesce(error,'')) l from refund_requests where id=$rr5")[0].l -gt 5) ((Q "select left(error,120) e from refund_requests where id=$rr5")[0].e)
  Check "R5 admin alert raised, customer not told" (([int](Q "select count(*) c from ops_events where code='refund_failed' and entity_id=$rr5")[0].c -eq 1) -and ([int](Q "select count(*) c from customer_notifications where refund_request_id=$rr5")[0].c -eq 0))
}
finally {
  Q "delete from customer_notifications where order_id in (select id from orders where shipping_email like 'real%@example.test')" | Out-Null
  Q "delete from ops_events where entity='refund_request' and entity_id in (select rr.id from refund_requests rr join orders o on o.id=rr.order_id where o.shipping_email like 'real%@example.test')" | Out-Null
  Q "delete from refund_requests where order_id in (select id from orders where shipping_email like 'real%@example.test')" | Out-Null
  Q "delete from payments where order_id in (select id from orders where shipping_email like 'real%@example.test')" | Out-Null
  Q "delete from orders where shipping_email like 'real%@example.test'" | Out-Null
  Q "delete from products where id=$prod" | Out-Null
}
$results | Format-Table -AutoSize -Wrap
if (@($results | ? Result -eq "FAIL").Count) { exit 1 }
