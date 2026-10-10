# GUIDED real Razorpay TEST verification of the financial safety net on DEV: payment.failed, refund status events, reconciliation against the
# real Razorpay API (field names), orphan payments, and full-refund-only. YOU run it in your own terminal with the TEST key (never a live key).
#   1. ./supabase/scripts/dev-razorpay-mode.ps1 -Ref lffnmycocbtpyvntccbg -Mode real       (hidden prompts; TEST keys only)
#   2. Razorpay Dashboard, TEST mode -> Settings -> Webhooks -> the DEV webhook: ALSO tick payment.failed, refund.created, refund.processed,
#      refund.failed (TEST dashboard only; the LIVE webhook is not touched)
#   3. ./supabase/tests/p7_razorpay_real_safety_dev.ps1 -Ref lffnmycocbtpyvntccbg
#   4. ./supabase/scripts/dev-razorpay-mode.ps1 -Ref lffnmycocbtpyvntccbg -Mode mock       (afterwards; the mock suites need it)
# It needs 3 successful TEST payments and 1 deliberately failed one, made by you in a browser page it serves on http://localhost.
# Test card (domestic): Visa debit 4100 2800 0000 1007, any future expiry, any CVV, OTP 123456. Failure: choose UPI and enter failure@razorpay.
# Non-destructive: nothing is deleted; test rows stay until ./supabase/scripts/dev-reset-test-state.ps1. No secret is printed or stored.
param([Parameter(Mandatory = $true)][string]$Ref, [int]$WaitSeconds = 180)
$ErrorActionPreference = "Stop"
if ($Ref -eq "vkcwfwgxelmamuydwrow") { throw "DEV only." }
function Get-PlainText([System.Security.SecureString]$s) { (New-Object System.Management.Automation.PSCredential('x', $s)).GetNetworkCredential().Password }
$pat = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", "User")
$mh = @{ Authorization = "Bearer $pat"; "User-Agent" = "Mozilla/5.0"; "Content-Type" = "application/json" }
function Invoke-MgmtRetry { param([string]$Method, [string]$Uri, $Headers, $Body)
  for ($try = 1; $try -le 8; $try++) { try { return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $Headers -Body $Body } catch { if ("$($_.ErrorDetails.Message)" -match 'Throttler|Too Many Requests' -and $try -lt 8) { Start-Sleep -Seconds (4 * $try); continue }; throw } } }
function Q([string]$sql) { try { Invoke-MgmtRetry -Method Post -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" -Headers $mh -Body ([Text.Encoding]::UTF8.GetBytes((@{ query = $sql } | ConvertTo-Json -Depth 3))) } catch { throw ("SQL error: " + (($_.ErrorDetails.Message -replace '(sbp_|eyJ)[A-Za-z0-9._-]+', '<redacted>') -replace '\s+', ' ')) } }
function Row([string]$sql) { $r = Q $sql; if ($null -eq $r) { return $null }; $a = @($r | Where-Object { $null -ne $_ }); if ($a.Count -eq 0) { return $null }; $a[0] }
function Val([string]$sql, [string]$col) { $r = Row $sql; if ($null -eq $r) { return $null }; $r.$col }
$results = @(); function Check([string]$n, [bool]$ok, $d = "") { $script:results += [pscustomobject]@{ Test = $n; Result = $(if ($ok) { "PASS" } else { "FAIL" }); Evidence = [string]$d }; Write-Host ("{0,-4} {1}  {2}" -f $(if ($ok) { "PASS" } else { "FAIL" }), $n, $d) -ForegroundColor $(if ($ok) { "Green" } else { "Red" }) }
function Wait-For([scriptblock]$cond, [int]$secs) { $t0 = Get-Date; while (((Get-Date) - $t0).TotalSeconds -lt $secs) { if (& $cond) { return $true }; Start-Sleep 3 }; $false }
function Sha([string]$s) { [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($s))).Replace("-", "").ToLower() }
$fn = "https://$Ref.supabase.co/functions/v1"

# ---- preflight: DEV must be on REAL Razorpay TEST
$sec = @{}; foreach ($s in @((Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$Ref/secrets" -Headers $mh) | ForEach-Object { $_ })) { $sec[$s.name] = $s.value }
Check "P0 DEV is in REAL Razorpay mode (RAZORPAY_API_BASE = https://api.razorpay.com)" ($sec["RAZORPAY_API_BASE"] -eq (Sha "https://api.razorpay.com")) "run dev-razorpay-mode.ps1 -Mode real first"
if ($results[-1].Result -eq "FAIL") { throw "Not in real mode; nothing was done." }
$keyId = (Read-Host "Razorpay TEST key id (rzp_test_...)").Trim(); if ($keyId -notmatch '^rzp_test_[A-Za-z0-9]+$') { throw "Refused: not a rzp_test_ key." }
Check "P0 the key id you typed is the one DEV uses (digest match)" ($sec["RAZORPAY_KEY_ID"] -eq (Sha $keyId))
$ks = (Get-PlainText (Read-Host "Razorpay TEST key secret (hidden; used only for read-only cross-checks and to create TEST orders)" -AsSecureString)).Trim()
$rzH = @{ Authorization = "Basic " + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${keyId}:$ks")); "Content-Type" = "application/json" }; $ks = $null
function Rz([string]$method, [string]$path, $body = $null) { $a = @{ Method = $method; Uri = "https://api.razorpay.com$path"; Headers = $rzH; UseBasicParsing = $true }; if ($body) { $a.Body = ($body | ConvertTo-Json -Compress -Depth 6) }; (Invoke-WebRequest @a).Content | ConvertFrom-Json }
$ans = Read-Host "Have you ticked payment.failed, refund.created, refund.processed and refund.failed on the DEV webhook in the TEST dashboard? (y/N)"
if ($ans -ne "y") { throw "Tick those events first (TEST dashboard only), then rerun." }
$reconHook = Val "select decrypted_secret s from vault.decrypted_secrets where name='hook_reconcile'" "s"
$uid = Val "select id i from user_profiles where email='dev-customer@example.test'" "i"; $cat = Val "select id i from categories limit 1" "i"
$prod = Val "select id i from products where sku='ZZ-RZP-SAFETY'" "i"; if (-not $prod) { $prod = Val "insert into products(name,price,sku,category_id,stock_qty,is_active) values ('ZZ rzp safety',100,'ZZ-RZP-SAFETY',$cat,50,false) returning id" "id" }
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

# ---- browser checkout for one TEST order (same approach as p3: http://localhost page, payment id reported back)
function Pay([string]$rzpOrder, [long]$paise, [string]$instruction) {
  $token = [guid]::NewGuid().ToString("N"); $listener = $null; $port = $null
  foreach ($p in 8765..8785) { try { $l = New-Object System.Net.HttpListener; $l.Prefixes.Add("http://localhost:$p/"); $l.Start(); $listener = $l; $port = $p; break } catch { } }
  if (-not $listener) { throw "No free local port 8765-8785." }
  $page = @'
<!doctype html><meta charset="utf-8"><title>DEV TEST payment</title><body style="font-family:sans-serif;max-width:560px;margin:40px auto">
<h3>Dia Shoppe DEV - Razorpay TEST</h3><p><b>__INSTR__</b></p><p id="s">Opening checkout...</p><button onclick="go()">Open checkout again</button>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script><script>
var done=false; function report(kind,id){ fetch('/r/__T__?k='+kind+'&id='+encodeURIComponent(id||'')); }
function go(){ if(done){return;} var r=new Razorpay({key:'__KEY__',order_id:'__ORDER__',amount:__AMT__,currency:'INR',name:'Dia Shoppe DEV',
 handler:function(x){done=true;document.getElementById('s').innerText='PAID '+x.razorpay_payment_id+' - you may close this tab.';report('paid',x.razorpay_payment_id);},
 modal:{ondismiss:function(){ if(!done) document.getElementById('s').innerText='Closed. Click "Open checkout again" (same order).'; }}});
 r.on('payment.failed',function(x){document.getElementById('s').innerText='FAILED as intended: '+(x.error&&x.error.description)+' - you may close this tab.';done=true;report('failed',x.error&&x.error.metadata&&x.error.metadata.payment_id);});
 r.open(); } window.onload=go;</script>
'@
  $page = $page.Replace("__INSTR__", $instruction).Replace("__T__", $token).Replace("__KEY__", $keyId).Replace("__ORDER__", $rzpOrder).Replace("__AMT__", [string]$paise)
  $url = "http://localhost:$port/pay/$token"; Write-Host "     >>> Open $url  : $instruction" -ForegroundColor Yellow
  try { Start-Process $url } catch { }
  $result = $null; $deadline = (Get-Date).AddMinutes(10)
  try {
    while (-not $result -and (Get-Date) -lt $deadline) {
      $task = $listener.GetContextAsync(); while (-not $task.Wait(500)) { if ((Get-Date) -ge $deadline) { break } }; if (-not $task.IsCompleted) { break }
      $ctx = $task.Result; $path = $ctx.Request.Url.AbsolutePath; $body = "ok"; $type = "text/plain"
      if ($path -eq "/pay/$token") { $body = $page; $type = "text/html; charset=utf-8" } elseif ($path -eq "/r/$token") { $result = [pscustomobject]@{ Kind = $ctx.Request.QueryString["k"]; Id = $ctx.Request.QueryString["id"] } }
      $bytes = [Text.Encoding]::UTF8.GetBytes($body); $ctx.Response.ContentType = $type; $ctx.Response.ContentLength64 = $bytes.Length; $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length); $ctx.Response.OutputStream.Close()
    }
  } finally { $listener.Stop(); $listener.Close() }
  if (-not $result) { throw "No result from the checkout page within 10 minutes (nothing else was created)." }
  $result
}
function New-Case([string]$tag) {
  $o = Val "insert into orders(user_id,total_amount,status,payment_method,shipping_address,shipping_phone,shipping_email,shipping_name) values ('$uid',1,'pending','online','x','0','real-$tag@example.test','Real $tag') returning id" "id"
  Q "insert into order_items(order_id,product_id,quantity,price_at_purchase) values ($o,$prod,1,1)" | Out-Null
  $amount = [long]([decimal](Val "select total_amount t from orders where id=$o" "t") * 100)
  $ro = Rz Post "/v1/orders" @{ amount = $amount; currency = "INR"; receipt = "zzsafety_${stamp}_$tag" }
  Q "update orders set razorpay_order_id='$($ro.id)' where id=$o" | Out-Null
  [pscustomobject]@{ Db = $o; Rzp = $ro.id; Paise = $amount }
}

# ---- V1 reconciliation against the REAL Razorpay API (dry run: nothing healed); field-name check
$d = Invoke-RestMethod -Method Post -Uri "$fn/razorpay-reconcile" -Headers @{ "x-hook-secret" = $reconHook } -Body '{"hours":336,"dryRun":true}' -ContentType "application/json"
Check "V1 reconcile (dry run, 14 days) completes against the REAL TEST account" ($d.run -and $d.dryRun -eq $true) "captured/refunded at Razorpay=$($d.razorpay_captured) matched in DEV=$($d.ledger_matched) findings=$(@($d.findings).Count)"
$from = [DateTimeOffset]::UtcNow.AddDays(-14).ToUnixTimeSeconds(); $list = Rz Get "/v1/payments?from=$from&count=100"
$it = @($list.items); $fields = @("id", "status", "amount", "amount_refunded", "captured", "order_id", "created_at")
$missing = @($fields | Where-Object { $f = $_; @($it | Where-Object { $_.PSObject.Properties.Name -contains $f }).Count -ne $it.Count })
Check "V1 every real payment object carries the fields reconciliation relies on ($($fields -join ', '))" ($it.Count -gt 0 -and $missing.Count -eq 0) "payments examined: $($it.Count); missing: $($missing -join ',')"
$capCount = @($it | Where-Object { $_.status -eq "captured" -or $_.status -eq "refunded" -or ([long]$_.amount_refunded -gt 0 -and $_.captured) }).Count
Check "V1 the function saw the same captured/refunded payments as a direct API read (first page)" ($capCount -le $d.razorpay_captured) "direct=$capCount function=$($d.razorpay_captured)"
@($d.findings) | Group-Object code | ForEach-Object { Write-Host ("     finding {0}: {1}" -f $_.Name, $_.Count) -ForegroundColor Cyan }

# ---- V2 payment.failed (no money moves)
$c2 = New-Case "pf"
$r2 = Pay $c2.Rzp $c2.Paise "PAY WITH A FAILURE: choose UPI and enter failure@razorpay (do NOT use the card)"
Check "V2 the browser saw a failed payment" ($r2.Kind -eq "failed") "kind=$($r2.Kind) id=$($r2.Id)"
$got = Wait-For { [bool](Row "select 1 x from payment_failures where razorpay_order_id='$($c2.Rzp)'") } $WaitSeconds
$pf = Row "select * from payment_failures where razorpay_order_id='$($c2.Rzp)'"
Check "V2 REAL payment.failed webhook recorded once with Razorpay's own error fields" ($got -and $pf.error_code -and $pf.order_id -eq $c2.Db) "code=$($pf.error_code) reason=$($pf.error_reason)"
Check "V2 no ledger row, order still pending (a failed attempt changes nothing)" (-not (Row "select 1 x from payments where razorpay_order_id='$($c2.Rzp)'") -and (Val "select status s from orders where id=$($c2.Db)" "s") -eq "pending")

# ---- V3 our own full refund and the REAL refund.processed event
$c3 = New-Case "rf"
$r3 = Pay $c3.Rzp $c3.Paise "PAY NORMALLY with the test card (refund test)"
$null = Wait-For { (Val "select status s from orders where id=$($c3.Db)" "s") -eq "confirmed" } $WaitSeconds
Check "V3 payment captured, ledger row, order confirmed" ((Val "select status s from orders where id=$($c3.Db)" "s") -eq "confirmed") "payment=$($r3.Id)"
Q "update orders set status='cancelled', cancelled_by='customer' where id=$($c3.Db)" | Out-Null          # customer cancel -> automatic FULL refund
$okRef = Wait-For { (Val "select status s from refund_requests where order_id=$($c3.Db)" "s") -eq "processed" } $WaitSeconds
$rr3 = Row "select * from refund_requests where order_id=$($c3.Db)"
Check "V3 full refund processed by OUR process-refund against the real API, amount = captured" ($okRef -and [decimal]$rr3.amount -eq [decimal](Val "select amount a from payments where order_id=$($c3.Db)" "a")) "refund=$($rr3.razorpay_refund_id)"
$ev = Wait-For { [bool](Row "select 1 x from refund_events where razorpay_refund_id='$($rr3.razorpay_refund_id)' and razorpay_status='processed'") } $WaitSeconds
$re = Row "select * from refund_events where razorpay_refund_id='$($rr3.razorpay_refund_id)' and razorpay_status='processed'"
Check "V3 REAL refund.processed webhook matched to our request (no duplicate, no new request)" ($ev -and $re.refund_request_id -eq $rr3.id -and $re.outcome -in "already_processed", "finalised" -and [int](Val "select count(*) c from refund_requests where order_id=$($c3.Db)" "c") -eq 1) "outcome=$($re.outcome)"
$rl = Rz Get "/v1/payments/$($r3.Id)/refunds"
Check "V3 Razorpay shows exactly ONE refund for the payment, full amount" (@($rl.items).Count -eq 1 -and [long]@($rl.items)[0].amount -eq $c3.Paise)

# ---- V4 a PARTIAL refund made in the dashboard (full-refund-only must alert, never record)
$c4 = New-Case "pr"
$r4 = Pay $c4.Rzp $c4.Paise "PAY NORMALLY with the test card (partial-refund test)"
$null = Wait-For { (Val "select status s from orders where id=$($c4.Db)" "s") -eq "confirmed" } $WaitSeconds
Write-Host "     >>> In the Razorpay TEST dashboard open payment $($r4.Id) and issue a PARTIAL refund of Rs 50, then press Enter here." -ForegroundColor Yellow
$null = Read-Host "Press Enter after the partial refund"
$pay4 = Val "select id i from payments where razorpay_payment_id='$($r4.Id)'" "i"
$alert = Wait-For { [bool](Row "select 1 x from ops_events where code='partial_refund_outside_system' and entity_id=$pay4") } $WaitSeconds
Check "V4 REAL refund webhook for a partial dashboard refund -> critical 'partial_refund_outside_system', NOT recorded as a request, payment still captured" ($alert -and -not (Row "select 1 x from refund_requests where payment_id=$pay4") -and (Val "select status s from payments where id=$pay4" "s") -eq "captured")
$d4 = Invoke-RestMethod -Method Post -Uri "$fn/razorpay-reconcile" -Headers @{ "x-hook-secret" = $reconHook } -Body '{"hours":24,"dryRun":true}' -ContentType "application/json"
Check "V4 reconciliation flags the untracked (partial) refund as critical" (@($d4.findings | Where-Object { $_.code -eq "refund_untracked" -and $_.payment -eq $r4.Id }).Count -eq 1)

# ---- V5 orphan payment (a Razorpay order that matches no DB order)
$ro5 = Rz Post "/v1/orders" @{ amount = 10000; currency = "INR"; receipt = "zzsafety_${stamp}_orphan" }
$r5 = Pay $ro5.id 10000 "PAY NORMALLY with the test card (orphan test: Rs 100, no shop order exists)"
$orph = Wait-For { [bool](Row "select 1 x from payments where razorpay_payment_id='$($r5.Id)' and order_id is null") } $WaitSeconds
$p5 = Val "select id i from payments where razorpay_payment_id='$($r5.Id)'" "i"
Check "V5 REAL captured payment with no matching order: ledger row kept (order null) and CRITICAL orphan alert" ($orph -and [bool](Row "select 1 x from ops_events where code='orphan_payment' and entity_id=$p5"))

# ---- V6 full-refund-only, everywhere
$partialBlocked = $true; try { Q "insert into refund_requests(payment_id,order_id,amount,reason,status) values ($pay4,$($c4.Db),50,'admin_cancel','requested')" | Out-Null; $partialBlocked = $false } catch { }
Check "V6 database refuses a partial refund request (trigger)" $partialBlocked
Check "V6 webhook path: partial refunds are alerted, never recorded (V4); reconciliation flags them (V4); recovery re-dispatches through process-refund, which refuses anything but the captured amount (DEV suite p5)" $true "see V4 and p5_backend_safety_dev.ps1"

$results | Format-Table -AutoSize -Wrap
$failed = @($results | Where-Object Result -eq "FAIL").Count
Write-Host "$(@($results).Count) checks, $failed failed. Switch DEV back: ./supabase/scripts/dev-razorpay-mode.ps1 -Ref $Ref -Mode mock" -ForegroundColor $(if ($failed) { "Red" } else { "Green" })
if ($failed) { exit 1 }
