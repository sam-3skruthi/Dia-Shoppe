# REAL Razorpay TEST-mode verification against the deployed DEV functions. YOU run this in your own terminal.
# RESUMABLE and NON-DESTRUCTIVE: progress is saved to a small state file (no secrets); a failure or crash NEVER deletes
# test rows (they are the evidence). Rows are removed only after a fully green run, or with -Cleanup.
#
# Setup (once):
#   1. Razorpay Dashboard -> TEST mode -> API Keys; Webhooks -> add
#        URL    https://lffnmycocbtpyvntccbg.supabase.co/functions/v1/razorpay-webhook
#        events payment.captured, order.paid        secret: a value you choose (the same one you typed in -Mode real)
#   2. ./supabase/scripts/dev-razorpay-mode.ps1 -Ref lffnmycocbtpyvntccbg -Mode real
#   3. ./supabase/tests/p3_razorpay_real_dev.ps1 -Ref lffnmycocbtpyvntccbg
#   4. when finished: ./supabase/scripts/dev-razorpay-mode.ps1 -Ref lffnmycocbtpyvntccbg -Mode mock
# Key id must be rzp_test_*; anything else is refused. Nothing secret is printed, stored or put in a URL.
# Pay with a DOMESTIC Indian test card (the generic 4111 card is treated as international and rejected):
# Visa debit 4100 2800 0000 1007 (alt: RuPay 6527 6589 0000 1005), any future expiry, any CVV; on the bank page enter any
# 4-10 digit OTP (e.g. 123456). Or choose UPI and enter success@razorpay. Three payments are needed.
# Source: Razorpay docs 'Test Card Details' and 'Test UPI Details'.
#
# Switches:
#   -AdoptPayment pay_xxx  use a payment that ALREADY exists at Razorpay for scenario R1 (no new payment is made)
#   -ReplayWebhook         if the webhook never arrives, replay the REAL payment (fetched from Razorpay) through the DEV
#                          webhook handler with a correct signature (asks for the webhook secret, hidden). This tests our
#                          handler on the real payload; it does NOT prove Razorpay->DEV delivery is configured.
#   -Cleanup               remove the runner's test rows + state file, then exit (no payments, no Razorpay calls)
#   -Fresh                 ignore the saved state and start over
#   -SelfTest              offline self-test of the runner's helpers (no network, no keys)
#   -NoLaunch              only print the checkout URL, do not try to open a browser
param(
  [Parameter(Mandatory = $true)][string]$Ref,
  [switch]$NoLaunch, [string]$AdoptPayment = "", [switch]$ReplayWebhook, [switch]$Cleanup, [switch]$Fresh, [switch]$SelfTest
)
$ErrorActionPreference = "Stop"
if ($Ref -eq "vkcwfwgxelmamuydwrow") { throw "DEV only." }
# --- runtime compatibility check (Windows PowerShell 5.1+ / PowerShell 7): fail early, before any prompt ---
function Get-PlainText([System.Security.SecureString]$s) { (New-Object System.Management.Automation.PSCredential('x', $s)).GetNetworkCredential().Password }
if ($PSVersionTable.PSVersion.Major -lt 5) { throw "PowerShell 5.1 or newer is required (found $($PSVersionTable.PSVersion))." }
if ((Get-PlainText (ConvertTo-SecureString 'compat-probe' -AsPlainText -Force)) -ne 'compat-probe') { throw "SecureString conversion is not working in this PowerShell." }
$pat = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", "User")
$mh = @{ Authorization = "Bearer $pat"; "User-Agent" = "Mozilla/5.0"; "Content-Type" = "application/json" }
function Q([string]$sql) { try { Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" -Headers $mh -Body ([Text.Encoding]::UTF8.GetBytes((@{ query = $sql } | ConvertTo-Json -Depth 3))) } catch { throw ("SQL error: " + (($_.ErrorDetails.Message -replace '(sbp_|eyJ)[A-Za-z0-9._-]+', '<redacted>') -replace '\s+', ' ')) } }

# ---------------- null-safe helpers ----------------
function Json-Safe($text) {            # never passes null/empty/garbage to ConvertFrom-Json
  if ($null -eq $text) { return $null }
  $s = [string]$text; if ([string]::IsNullOrWhiteSpace($s)) { return $null }
  try { return ($s | ConvertFrom-Json) } catch { return $null }
}
function Row([string]$sql) {           # first row, or $null when there is none (never an exception on empty results)
  $r = Q $sql; if ($null -eq $r) { return $null }
  $a = @($r | Where-Object { $null -ne $_ }); if ($a.Count -eq 0) { return $null }
  $a[0]
}
function Val([string]$sql, [string]$col) { $r = Row $sql; if ($null -eq $r) { return $null }; $r.$col }
function ConvertTo-Hash($o) {
  if ($o -is [System.Management.Automation.PSCustomObject]) { $h = @{}; foreach ($p in $o.PSObject.Properties) { $h[$p.Name] = ConvertTo-Hash $p.Value }; return $h }
  if ($o -is [System.Array]) { return , @($o | ForEach-Object { ConvertTo-Hash $_ }) }   # leading comma: keep one-item lists as lists
  return $o
}
$StatePath = Join-Path $env:TEMP "dia-dev-rzp-real-state.json"      # ids only: no keys, no secrets
function Load-State { if (-not $Fresh -and (Test-Path $StatePath)) { $s = Json-Safe (Get-Content $StatePath -Raw); if ($s -and $s.ref -eq $Ref) { return (ConvertTo-Hash $s) } }; @{ ref = $Ref; product = $null; cases = @{}; done = @(); results = @() } }
function Save-State { ($script:state | ConvertTo-Json -Depth 8) | Set-Content -Path $StatePath -Encoding UTF8 }
function Rz-Require($r, [string]$what) { if ($r.Code -ne 200) { throw "$what failed: HTTP $($r.Code) on $($r.Endpoint)$(if ($r.Error) { ' - ' + $r.Error })" } }

# ---------------- self-test (offline) ----------------
if ($SelfTest) {
  $fails = @(); function T($n, $ok) { if (-not $ok) { $script:fails += $n }; "{0,-62} {1}" -f $n, $(if ($ok) { "PASS" } else { "FAIL" }) }
  T "Json-Safe(null) -> null, no throw" ($null -eq (Json-Safe $null))
  T "Json-Safe('') / whitespace -> null" (($null -eq (Json-Safe "")) -and ($null -eq (Json-Safe "   ")))
  T "Json-Safe(garbage) -> null, no throw" ($null -eq (Json-Safe "<html>502</html>"))
  T "Json-Safe(valid) parses" ((Json-Safe '{"a":1}').a -eq 1)
  function Q([string]$sql) { switch ($sql) { "none" { return $null } "empty" { return @() } "one" { return @([pscustomobject]@{ r = "x" }) } } }
  T "Row on null result -> null (the exact crash case)" ($null -eq (Row "none"))
  T "Row on empty result -> null" ($null -eq (Row "empty"))
  T "Val on missing row -> null, and ConvertFrom-Json is never fed null" (($null -eq (Val "none" "r")) -and ($null -eq (Json-Safe (Val "none" "r"))))
  T "Val on a real row returns the column" ((Val "one" "r") -eq "x")
  $script:Fresh = $false; $tmp = Join-Path $env:TEMP "dia-selftest-state.json"; $StatePath = $tmp
  $script:state = @{ ref = $Ref; product = @{ id = 1 }; cases = @{ R1 = @{ db = 5; rzp = "order_x"; paymentId = "pay_y" } }; done = @("R1"); results = @(@{ Test = "t"; Result = "PASS" }) }
  Save-State; $back = Load-State
  T "state file round-trips (resume after a crash)" ($back.cases.R1.paymentId -eq "pay_y" -and $back.done -contains "R1" -and $back.results.Count -eq 1)
  T "state for a different project is ignored" ((Json-Safe '{"ref":"other"}').ref -ne $Ref)
  Set-Content -Path $tmp -Value "{ not json" -Encoding UTF8; T "corrupt state file -> clean start, no crash" ((Load-State).done.Count -eq 0)
  [IO.File]::Delete($tmp)
  $src = Get-Content $PSCommandPath -Raw
  T "no cleanup inside a finally block (failures keep the evidence)" (-not ($src -match '(?s)finally\s*\{[^}]*delete from'))
  T "live-key refusal regex rejects rzp_live_" (("rzp_live_abc" -notmatch '^rzp_test_[A-Za-z0-9]+$') -and ("rzp_test_abc" -match '^rzp_test_[A-Za-z0-9]+$'))
  T "no secret echo helpers (Write-Host of key/secret variables)" (-not ($src -match 'Write-Host[^\r\n]*\$(ks|keySecret|whSecret|rzH)\b'))
  if ($fails.Count) { "SELF-TEST FAILED: $($fails -join '; ')"; exit 1 } else { "SELF-TEST PASSED"; exit 0 }
}

# ---------------- cleanup-only mode (no Razorpay, no payments) ----------------
function Remove-TestRows {
  Q "delete from customer_notifications where order_id in (select id from orders where shipping_email like 'real%@example.test')" | Out-Null
  Q "delete from ops_events where entity='refund_request' and entity_id in (select rr.id from refund_requests rr join orders o on o.id=rr.order_id where o.shipping_email like 'real%@example.test')" | Out-Null
  Q "delete from ops_events where entity='order' and entity_id in (select id from orders where shipping_email like 'real%@example.test')" | Out-Null
  Q "delete from refund_requests where order_id in (select id from orders where shipping_email like 'real%@example.test')" | Out-Null
  Q "delete from payments where order_id in (select id from orders where shipping_email like 'real%@example.test')" | Out-Null
  Q "delete from orders where shipping_email like 'real%@example.test'" | Out-Null
  Q "delete from products where sku = 'ZZ-RZP-REAL'" | Out-Null
  if (Test-Path $StatePath) { [IO.File]::Delete($StatePath) }
}
if ($Cleanup) { Remove-TestRows; "Runner test rows and state file removed."; exit 0 }

# ---------------- credentials (TEST only) ----------------
$keyId = Read-Host "Razorpay TEST key id"
if ($keyId -notmatch '^rzp_test_[A-Za-z0-9]+$') { throw "Refused: not a rzp_test_ key." }
$sec = Read-Host "Razorpay TEST key secret" -AsSecureString
$ks = Get-PlainText $sec; $sec = $null
$rzH = @{ Authorization = "Basic " + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${keyId}:$ks")); "Content-Type" = "application/json" }; $ks = $null
function Rz([string]$method, [string]$path, $body = $null) {
  $ep = "$method $path"
  try {
    $a = @{ Method = $method; Uri = "https://api.razorpay.com$path"; Headers = $rzH; UseBasicParsing = $true }; if ($body) { $a.Body = ($body | ConvertTo-Json -Compress -Depth 6) }
    $r = Invoke-WebRequest @a
    [pscustomobject]@{ Code = [int]$r.StatusCode; Json = (Json-Safe $r.Content); Error = $null; Endpoint = $ep }
  } catch {
    $code = 0; if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    $j = $null; if ($_.ErrorDetails) { $j = Json-Safe $_.ErrorDetails.Message }
    $msg = ""; if ($j -and $j.error) { $msg = [string]$j.error.description }
    if (-not $msg) { $msg = "no response body ($($_.Exception.GetType().Name))" }
    [pscustomobject]@{ Code = $code; Json = $null; Error = $msg; Endpoint = $ep }
  }
}

# ---------------- state, results, fixtures ----------------
$state = Load-State
$resumed = ($state.done.Count -gt 0 -or $state.cases.Count -gt 0)
if ($resumed) { Write-Host "Resuming from saved state: completed = [$($state.done -join ', ')]. Existing orders/payments are reused; no new payment is created for a scenario that already has one." -ForegroundColor Cyan }
$results = @($state.results | ForEach-Object { [pscustomobject]$_ })
function Check($n, [bool]$ok, $d = "") {
  $row = [pscustomobject]@{ Test = $n; Result = $(if ($ok) { "PASS" } else { "FAIL" }); Detail = [string]$d }
  $script:results += $row; $script:state.results = @($script:results | ForEach-Object { @{ Test = $_.Test; Result = $_.Result; Detail = $_.Detail } }); Save-State
}
function Stop-Run([string]$why) { throw "STOPPED (state saved, nothing deleted): $why" }
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$uid = Val "select id from user_profiles where email='dev-customer@example.test'" "id"
$cat = Val "select id from categories limit 1" "id"
if (-not $uid -or -not $cat) { throw "DEV fixtures missing (customer user or a category). Run the DEV bootstrap first." }
$prod = Val "select id from products where sku='ZZ-RZP-REAL'" "id"
if (-not $prod) { $prod = Val "insert into products(name,price,sku,category_id,stock_qty,is_active) values ('ZZ rzp real',100,'ZZ-RZP-REAL',$cat,20,false) returning id" "id" }
function Stock { [int](Val "select stock_qty s from products where id=$prod" "s") }
function As-Admin([string]$stmt) { Q "do `$`$ begin perform set_config('request.jwt.claims', json_build_object('sub',(select id from user_profiles where email='dev-admin@example.test'),'role','authenticated')::text, true); set local role authenticated; $stmt end `$`$" | Out-Null }
function Wait-For([scriptblock]$cond, [int]$secs = 90) { for ($i = 0; $i -lt $secs; $i++) { if (& $cond) { return $true }; Start-Sleep 1 }; $false }

# A case = one DB order + one Razorpay order (+ later its payment). Reused across runs; never duplicated.
function Get-Case([string]$key, [long]$paise, [string]$adoptRzpOrder = "") {
  $c = $script:state.cases[$key]
  if ($c -and $c.db -and (Row "select id from orders where id=$($c.db)")) { return $c }          # fully intact: reuse
  $email = "real$($key.ToLower())@example.test"
  $rzp = $null; if ($c -and $c.rzp) { $rzp = $c.rzp } elseif ($adoptRzpOrder) { $rzp = $adoptRzpOrder }
  $o = Row "select id, razorpay_order_id from orders where shipping_email='$email'"             # DB order survived but state didn't
  if (-not $o) {
    $new = Val "insert into orders(user_id,total_amount,status,payment_method,shipping_address,shipping_phone,shipping_email,shipping_name) values ('$uid',1,'pending','online','x','0','$email','Real Test') returning id" "id"
    Q "insert into order_items(order_id,product_id,quantity,price_at_purchase) values ($new,$prod,1,1)" | Out-Null
    $o = [pscustomobject]@{ id = $new; razorpay_order_id = $null }
  }
  if ($o.razorpay_order_id) { $rzp = $o.razorpay_order_id }
  if (-not $rzp) {                                                                              # only now do we ask Razorpay for a NEW order
    $ro = Rz Post "/v1/orders" @{ amount = $paise; currency = "INR"; receipt = "zzreal_${stamp}_$key" }; Rz-Require $ro "Razorpay order creation"
    $rzp = $ro.Json.id
  }
  Q "update orders set razorpay_order_id='$rzp' where id=$($o.id) and razorpay_order_id is distinct from '$rzp'" | Out-Null
  $pid0 = $null; if ($c -and $c.paymentId) { $pid0 = $c.paymentId }
  $script:state.cases[$key] = @{ db = [long]$o.id; rzp = $rzp; paise = $paise; paymentId = $pid0 }
  Save-State
  $script:state.cases[$key]
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
<p>Order <b>__ORDER__</b> - Rs __RUPEES__ (TEST mode, no real money). Use Visa debit <b>4100 2800 0000 1007</b> (or RuPay <b>6527 6589 0000 1005</b>), any future expiry, any CVV; on the bank page enter any OTP of 4-10 digits (e.g. <b>123456</b>). Or choose UPI and enter <b>success@razorpay</b>. (The generic 4111 card is treated as international and is rejected.)</p>
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
  Write-Host "    Pay with the DOMESTIC test card Visa debit 4100 2800 0000 1007 (or RuPay 6527 6589 0000 1005): any future expiry, any CVV,"
  Write-Host "    then any 4-10 digit OTP (e.g. 123456) on the bank page. Alternative: choose UPI and enter success@razorpay."
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

function Mark-Done([string]$k) { if ($script:state.done -notcontains $k) { $script:state.done = @($script:state.done) + $k }; Save-State }

# The real Razorpay payment entity, replayed through OUR webhook handler with a correct signature.
$script:whPlain = $null
function Replay-Webhook([string]$paymentId) {
  $p = Rz Get "/v1/payments/$paymentId"; Rz-Require $p "Fetching the real payment for replay"
  if (-not $script:whPlain) { $script:whPlain = Get-PlainText (Read-Host "Razorpay TEST webhook secret (the same one you gave -Mode real; needed only to replay)" -AsSecureString) }
  $body = (@{ event = "payment.captured"; payload = @{ payment = @{ entity = $p.Json } } } | ConvertTo-Json -Depth 10 -Compress)
  $bytes = [Text.Encoding]::UTF8.GetBytes($body)
  $hm = New-Object System.Security.Cryptography.HMACSHA256 (, [Text.Encoding]::UTF8.GetBytes($script:whPlain))
  $sig = ($hm.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join ""
  $url = "https://$Ref.supabase.co/functions/v1/razorpay-webhook"
  try {
    $r = Invoke-WebRequest -Method Post -Uri $url -Headers @{ "x-razorpay-signature" = $sig; "Content-Type" = "application/json" } -Body $bytes -UseBasicParsing
    Write-Host "    Replayed the real payment entity to the DEV webhook: HTTP $([int]$r.StatusCode) $($r.Content)"
  } catch {
    $code = 0; if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    Write-Host "    DEV webhook replay answered HTTP $code on POST /functions/v1/razorpay-webhook (400 = signature/secret mismatch, 500 = handler error)." -ForegroundColor Yellow
  }
}

function Ensure-Paid([string]$key) {
  $c = $script:state.cases[$key]
  if ($c.paymentId) { Write-Host "[$key] payment $($c.paymentId) already exists for this order - not opening another checkout." -ForegroundColor Cyan; return $c.paymentId }
  $op = Rz Get "/v1/orders/$($c.rzp)/payments"
  if ($op.Code -ne 200) { Stop-Run "could not ask Razorpay whether order $($c.rzp) already has a payment (HTTP $($op.Code) on $($op.Endpoint): $($op.Error)); refusing to open a checkout blind" }
  $existing = @(); if ($op.Json -and $op.Json.items) { $existing = @($op.Json.items) }
  if ($existing.Count -gt 0) {
    $c.paymentId = $existing[0].id; Save-State
    Write-Host "[$key] Razorpay already has payment $($c.paymentId) for this order - NOT opening a second checkout." -ForegroundColor Cyan
    return $c.paymentId
  }
  $id = Pay-InBrowser $c
  $c.paymentId = $id; Save-State
  $id
}
function Confirm-Captured([string]$key) {
  $c = $script:state.cases[$key]
  $st = Rz Get "/v1/payments/$($c.paymentId)"
  $status = if ($st.Json) { [string]$st.Json.status } else { "unknown (HTTP $($st.Code) on $($st.Endpoint): $($st.Error))" }
  Check "[$key] Razorpay reports the payment $($c.paymentId) as captured" ($status -eq "captured") "status=$status"
  if ($status -eq "authorized") { Stop-Run "payment is only AUTHORIZED, so Razorpay will never send payment.captured. Set Settings -> Payment Capture to automatic in the TEST dashboard (or capture it), then rerun the same command." }
  if ($status -ne "captured") { Stop-Run "unexpected payment status '$status'" }
}
function Wait-Ledger([string]$key) {
  $c = $script:state.cases[$key]
  $has = { [bool](Row "select 1 as x from payments where razorpay_payment_id='$($c.paymentId)'") }
  Write-Host "[$key] DEV order exists and is waiting for the webhook for $($c.paymentId) (up to 2 minutes)." -ForegroundColor Cyan
  Write-Host "      If Razorpay did not deliver it yet: in the Razorpay dashboard (TEST mode) open that webhook's delivery log and click Resend NOW (not earlier: DEV must already have the order)." -ForegroundColor Cyan
  $found = Wait-For $has 120
  if (-not $found -and $ReplayWebhook) { Write-Host "[$key] webhook not seen after 60s; -ReplayWebhook given, replaying the real payment..." -ForegroundColor Yellow; Replay-Webhook $c.paymentId; $found = Wait-For $has 30 }
  Check "[$key] DEV recorded the payment in its ledger" $found $c.paymentId
  if (-not $found) {
    Stop-Run ("DEV never recorded payment $($c.paymentId) (no webhook request reached DEV). Nothing was created or deleted. Check in the Razorpay dashboard, TEST mode: " +
      "(1) Settings -> Webhooks: an ACTIVE webhook with URL https://$Ref.supabase.co/functions/v1/razorpay-webhook, events payment.captured (and order.paid), created in TEST mode; " +
      "(2) that webhook's delivery log for this payment (HTTP status / 'resend'); (3) the payment is 'Captured'. " +
      "To test our handler meanwhile, rerun the same command with -ReplayWebhook. Resuming never creates a new payment.")
  }
}
function Pay-Id($c) { Val "select razorpay_payment_id p from payments where razorpay_order_id='$($c.rzp)'" "p" }

$runError = $null
try {
  # ---------- R0 credentials
  $ping = Rz Get "/v1/payments?count=1"
  Check "R0 TEST credentials accepted by the real API" ($ping.Code -eq 200) "HTTP $($ping.Code) on $($ping.Endpoint)"
  if ($ping.Code -ne 200) { Stop-Run "Razorpay rejected the TEST credentials: $($ping.Error)" }

  # ---------- R1 normal payment: real captured payload -> ledger -> confirmed -> stock once
  if ($state.done -notcontains "R1") {
    $adoptOrder = ""
    if ($AdoptPayment -and -not $state.cases.R1) {
      if ($AdoptPayment -notmatch '^pay_[A-Za-z0-9]+$') { throw "-AdoptPayment must look like pay_xxxxx" }
      $ap = Rz Get "/v1/payments/$AdoptPayment"; Rz-Require $ap "Looking up the payment to adopt"
      if ($ap.Json.amount -ne 19900) { throw "The payment to adopt is for $($ap.Json.amount) paise, but R1 needs 19900 (Rs 199)." }
      $adoptOrder = [string]$ap.Json.order_id
      Write-Host "Adopting existing payment $AdoptPayment on Razorpay order $adoptOrder (status $($ap.Json.status)); no new payment will be made for R1." -ForegroundColor Cyan
    }
    $c1 = Get-Case "R1" 19900 $adoptOrder
    if ($AdoptPayment -and -not $c1.paymentId) { $c1.paymentId = $AdoptPayment; Save-State }
    $p1 = Ensure-Paid "R1"; Confirm-Captured "R1"; Wait-Ledger "R1"
    Check "R1 webhook confirmed the order" (Wait-For { (Val "select status s from orders where id=$($c1.db)" "s") -eq "confirmed" } 30) "status=$(Val "select status s from orders where id=$($c1.db)" "s")"
    $led = Row "select amount, raw::text r from payments where razorpay_payment_id='$p1'"
    $raw = $null; if ($led) { $raw = Json-Safe $led.r }
    Check "R1 ledger row has the real payment id + amount 199.00" ($null -ne $led -and [decimal]$led.amount -eq 199) $p1
    $need = @("id", "amount", "currency", "status", "order_id", "method")
    Check "R1 real payload carries id/amount/currency/status/order_id/method" ($null -ne $raw -and @($need | Where-Object { $null -eq $raw.$_ }).Count -eq 0) $(if ($raw) { "keys: " + (($raw.PSObject.Properties.Name | Select-Object -First 30) -join ",") } else { "no raw payload stored" })
    Check "R1 stock taken once (20-1=19)" ((Stock) -eq 19) "stock=$(Stock)"
    $api = Rz Get "/v1/payments/$p1"
    Check "R1 independent GET /payments/:id agrees (captured, 19900, same order)" ($api.Json -and $api.Json.status -eq "captured" -and $api.Json.amount -eq 19900 -and $api.Json.order_id -eq $c1.rzp) "HTTP $($api.Code)"
    Mark-Done "R1"
  }

  # ---------- R2 wrong amount: Razorpay order for Rs 150 while the DB order costs Rs 199
  if ($state.done -notcontains "R2") {
    $c2 = Get-Case "R2" 15000
    $p2 = Ensure-Paid "R2"; Confirm-Captured "R2"; Wait-Ledger "R2"
    Check "R2 wrong amount: order NOT confirmed, refund waits for admin" (Wait-For { (Val "select status s from refund_requests where order_id=$($c2.db) order by id limit 1" "s") -eq "requested" } 30)
    Check "R2 order still pending, nothing deducted" (((Val "select status s from orders where id=$($c2.db)" "s") -eq "pending") -and (Stock) -eq 19) "stock=$(Stock)"
    $rr2 = Val "select id from refund_requests where order_id=$($c2.db) order by id limit 1" "id"
    if (-not $rr2) { Stop-Run "no refund request exists for the mismatched payment" }
    if ((Val "select status s from refund_requests where id=$rr2" "s") -eq "requested") { As-Admin "perform public.approve_refund($rr2);" }
    Check "R2 after admin approval a REAL refund is processed" (Wait-For { (Val "select status s from refund_requests where id=$rr2" "s") -eq "processed" } 60) "status=$(Val "select status s from refund_requests where id=$rr2" "s")"
    $l2 = Rz Get "/v1/payments/$p2/refunds"; $items2 = @(); if ($l2.Json -and $l2.Json.items) { $items2 = @($l2.Json.items) }
    Check "R2 refund lookup returns exactly one refund tagged with our request id" ($items2.Count -eq 1 -and [string]$items2[0].notes.refund_request_id -eq [string]$rr2) $(if ($items2.Count) { "notes=" + ($items2[0].notes | ConvertTo-Json -Compress) } else { "HTTP $($l2.Code) on $($l2.Endpoint): $($l2.Error)" })
    Check "R2 refund amount = what was captured (15000)" ($items2.Count -ge 1 -and $items2[0].amount -eq 15000)
    Mark-Done "R2"
  }

  # ---------- R3 late payment after cancellation -> automatic full refund
  if ($state.done -notcontains "R3") {
    $c3 = Get-Case "R3" 19900
    if ((Val "select status s from orders where id=$($c3.db)" "s") -ne "cancelled" -and -not $c3.paymentId) { Q "update orders set status='cancelled', cancelled_by='customer' where id=$($c3.db)" | Out-Null }
    $p3 = Ensure-Paid "R3"; Confirm-Captured "R3"; Wait-Ledger "R3"
    Check "R3 late payment -> refund PROCESSED automatically" (Wait-For { (Val "select status s from refund_requests where order_id=$($c3.db) order by id limit 1" "s") -eq "processed" } 90) "status=$(Val "select status s from refund_requests where order_id=$($c3.db) order by id limit 1" "s")"
    $l3 = Rz Get "/v1/payments/$p3/refunds"; $items3 = @(); if ($l3.Json -and $l3.Json.items) { $items3 = @($l3.Json.items) }
    Check "R3 order stays cancelled, stock untouched, full amount refunded" (((Val "select status s from orders where id=$($c3.db)" "s") -eq "cancelled") -and (Stock) -eq 19 -and $items3.Count -ge 1 -and $items3[0].amount -eq 19900) "stock=$(Stock) refunds=$($items3.Count)"
    Mark-Done "R3"
  }

  # ---------- R4 idempotency / crash recovery against the REAL refund API
  if ($state.done -notcontains "R4") {
    $c3 = $state.cases.R3; $p3 = $c3.paymentId
    $rr3 = Val "select id from refund_requests where order_id=$($c3.db) order by id limit 1" "id"
    Q "update refund_requests set status='processing', razorpay_refund_id=null, processed_at=null, processing_since=now()-interval '20 minutes' where id=$rr3" | Out-Null
    Q "select private.requeue_stuck_refunds(15)" | Out-Null
    Check "R4 lost-result recovery reconciles instead of refunding twice" (Wait-For { (Val "select status s from refund_requests where id=$rr3" "s") -eq "processed" } 60)
    $l3b = Rz Get "/v1/payments/$p3/refunds"; $n3b = 0; if ($l3b.Json -and $l3b.Json.items) { $n3b = @($l3b.Json.items).Count }
    Check "R4 Razorpay still shows exactly ONE refund for the payment" ($n3b -eq 1) "refunds=$n3b"
    $dup = Rz Post "/v1/payments/$p3/refund" @{ amount = 19900 }
    Check "R4 a deliberate second refund is refused by Razorpay itself" ($dup.Code -ge 400) "HTTP $($dup.Code): $($dup.Error)"
    Mark-Done "R4"
  }

  # ---------- R5 a REAL gateway refusal is recorded, alerted, and does not reach the customer
  if ($state.done -notcontains "R5") {
    $c3 = $state.cases.R3; $p3 = $c3.paymentId
    $rr3 = Val "select id from refund_requests where order_id=$($c3.db) order by id limit 1" "id"
    Q "update refund_requests set status='rejected' where id=$rr3" | Out-Null          # lets us open a second request for the same payment
    $pay3 = Val "select id from payments where razorpay_payment_id='$p3'" "id"
    $rr5 = Val "insert into refund_requests(payment_id,order_id,amount,reason,status,requires_approval) values ($pay3,$($c3.db),199,'admin_cancel','requested',false) returning id" "id"
    Q "update refund_requests set status='approved', approved_at=now() where id=$rr5" | Out-Null
    Check "R5 gateway refusal is recorded as failed with Razorpay's own words" (Wait-For { (Val "select status s from refund_requests where id=$rr5" "s") -eq "failed" } 60)
    Check "R5 real error text stored" ([int](Val "select length(coalesce(error,'')) l from refund_requests where id=$rr5" "l") -gt 5) (Val "select left(error,120) e from refund_requests where id=$rr5" "e")
    Check "R5 admin alert raised, customer not told" (([int](Val "select count(*) c from ops_events where code='refund_failed' and entity_id=$rr5" "c") -eq 1) -and ([int](Val "select count(*) c from customer_notifications where refund_request_id=$rr5" "c") -eq 0))
    Mark-Done "R5"
  }
} catch {
  $runError = $_.Exception.Message
} finally {
  # NOTE: nothing is deleted here. A failure keeps every row, the saved state and the evidence.
  $results | Format-Table -AutoSize -Wrap
}
$failed = @($results | Where-Object { $_.Result -eq "FAIL" }).Count
if ($runError) {
  Write-Host ""; Write-Host $runError -ForegroundColor Yellow
  Write-Host "Progress is saved ($StatePath). Resume with the SAME command (add -ReplayWebhook / -AdoptPayment if relevant). Remove test rows later with -Cleanup." -ForegroundColor Yellow
  exit 2
}
if ($failed) { Write-Host "$failed check(s) failed. Rows and state are kept for inspection; rerun the same command to resume, or -Cleanup to remove them." -ForegroundColor Yellow; exit 1 }
Remove-TestRows
Write-Host "All scenarios passed. Test rows and state file removed. Switch DEV back with dev-razorpay-mode.ps1 -Mode mock." -ForegroundColor Green

