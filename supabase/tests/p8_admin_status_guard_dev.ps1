# 042 order-status guard through the REAL API path of the frozen admin UI (PostgREST PATCH orders.status with a real admin login),
# the admin RPCs, customer attempts, schema exposure, and two CONCURRENT manual decisions. DEV only.
#   ./supabase/tests/p8_admin_status_guard_dev.ps1 -Ref lffnmycocbtpyvntccbg
# Logins: the two throwaway DEV accounts whose generated passwords live only in the DEV Vault (see p4b). Nothing is printed.
# Fixtures use order_zzg_* / ZZ-* names (also removed by dev-reset-test-state.ps1) and are deleted at the end.
param([Parameter(Mandatory = $true)][string]$Ref)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http
if ($Ref -eq "vkcwfwgxelmamuydwrow") { throw "DEV only." }
$pat = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", "User")
$mh = @{ Authorization = "Bearer $pat"; "User-Agent" = "Mozilla/5.0"; "Content-Type" = "application/json" }
function Q([string]$sql) {
  for ($try = 1; $try -le 8; $try++) {
    try { return Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" -Headers $mh -Body ([Text.Encoding]::UTF8.GetBytes((@{ query = $sql } | ConvertTo-Json -Depth 3))) }
    catch { $m = "$($_.ErrorDetails.Message)"; if ($m -match 'Throttler|Too Many Requests' -and $try -lt 8) { Start-Sleep -Seconds (4 * $try); continue }; throw ("SQL error: " + (($m -replace '(sbp_|eyJ)[A-Za-z0-9._-]+', '<redacted>') -replace '\s+', ' ')) }
  }
}
$anon = ((Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$Ref/api-keys" -Headers $mh) | ? { $_.name -eq "anon" -or $_.type -eq "publishable" } | select -First 1).api_key
$rest = "https://$Ref.supabase.co/rest/v1"
function Login([string]$email, [string]$vaultName) {
  $pw = (Q "select decrypted_secret s from vault.decrypted_secrets where name='$vaultName'")[0].s
  try { $r = Invoke-RestMethod -Method Post -Uri "https://$Ref.supabase.co/auth/v1/token?grant_type=password" -Headers @{ apikey = $anon; "Content-Type" = "application/json" } -Body (@{ email = $email; password = $pw } | ConvertTo-Json) }
  catch { $pw = $null; throw "Sign-in failed for $email (HTTP $([int]$_.Exception.Response.StatusCode))." }
  $pw = $null
  [pscustomobject]@{ Email = $email; Id = $r.user.id; Jwt = $r.access_token }
}
$adm = Login "wa-admin-login@example.test" "dev_test_pw_admin"
$cust = Login "wa-customer-login@example.test" "dev_test_pw_customer"
if ((Q "select role r from user_profiles where id='$($adm.Id)'")[0].r -ne "admin") { throw "DEV test admin is not an admin." }
if ((Q "select role r from user_profiles where id='$($cust.Id)'")[0].r -ne "customer") { throw "DEV test customer is not a customer." }

function Api($who, [string]$method, [string]$path, $body = $null) {
  $h = @{ apikey = $anon; Authorization = "Bearer $($who.Jwt)"; "Content-Type" = "application/json"; Prefer = "return=representation" }
  try {
    $a = @{ Method = $method; Uri = "$rest/$path"; Headers = $h; UseBasicParsing = $true }; if ($body) { $a.Body = ($body | ConvertTo-Json -Compress) }
    $r = Invoke-WebRequest @a; [pscustomobject]@{ Code = [int]$r.StatusCode; Body = "$($r.Content)" }
  } catch {
    $b = "$($_.ErrorDetails.Message)"   # Windows PowerShell 5.1 leaves this empty for Invoke-WebRequest: read the response stream instead
    if (-not $b -and $_.Exception.Response) { try { $b = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch {} }
    [pscustomobject]@{ Code = [int]$_.Exception.Response.StatusCode; Body = $b } }
}
# exactly what AdminOrders.jsx -> updateOrderStatus() sends
function UiSetStatus([long]$id, [string]$status) {
  $patch = @{ status = $status }
  if ($status -eq "cancelled") { $patch.cancelled_at = (Get-Date).ToUniversalTime().ToString("o"); $patch.cancelled_by = "admin" }
  Api $adm PATCH "orders?id=eq.$id" $patch
}
$results = @(); function Check($n, [bool]$ok, $d = "") { $script:results += [pscustomobject]@{ Test = $n; Result = $(if ($ok) { "PASS" } else { "FAIL" }); Detail = $d } }
function State([long]$id) { (Q "select o.status, (select stock_qty from products where id=$script:pa) a, (select stock_qty from products where id=$script:pb) b, (select string_agg(coalesce(stock_deducted_qty::text,'null'),',') from order_items where order_id=o.id) ded, (select string_agg(reason||':'||status, ',' order by id) from refund_requests where order_id=o.id) rr, (select count(*) from payments where order_id=o.id and status='captured') pay from orders o where o.id=$id")[0] }

$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$cat = (Q "select id from categories limit 1")[0].id
$script:pa = (Q "insert into products(name,price,sku,category_id,stock_qty,is_active) values ('ZZ guard api A',100,'ZZ-GAPI-A-$stamp',$cat,5,false) returning id")[0].id
$script:pb = (Q "insert into products(name,price,sku,category_id,stock_qty,is_active) values ('ZZ guard api B',100,'ZZ-GAPI-B-$stamp',$cat,50,false) returning id")[0].id
$cid = $cust.Id
function Mk([string]$tag, [long]$prod, [int]$qty) {
  $id = (Q "insert into orders(user_id,total_amount,status,payment_method,shipping_address,shipping_phone,razorpay_order_id) values ('$cid',1,'pending','online','x','0','order_zzg_${tag}_$stamp') returning id")[0].id
  Q "insert into order_items(order_id,product_id,quantity,price_at_purchase) values ($id,$prod,$qty,100)" | Out-Null; $id }
function Pay([long]$id, [string]$tag, [int]$extraPaise = 0) {
  $tot = [int]([decimal](Q "select total_amount t from orders where id=$id")[0].t * 100) + $extraPaise
  (Q "select public.settle_payment('pay_captured_${tot}_zzg${tag}__order_zzg_${tag}_$stamp','order_zzg_${tag}_$stamp',$tot,'test') r")[0].r }

try {
  # ---- fixtures (service level, like the payment path)
  $oh = Mk "h" $pa 2; Q "update products set stock_qty=1 where id=$pa" | Out-Null; $null = Pay $oh "h"
  $om = Mk "m" $pb 1; $null = Pay $om "m" 100
  $om2 = Mk "m2" $pb 1; $null = Pay $om2 "m2" 100
  $or = Mk "r" $pb 1; $null = Pay $or "r"
  Q "select public.courier_apply_event('canonical','zzg-r-ship-$stamp','$or','AWB-ZZG-$stamp','Shipped'), public.courier_apply_event('canonical','zzg-r-rto-$stamp','$or','AWB-ZZG-$stamp','RTO Delivered')" | Out-Null
  $oc = Mk "c" $pb 1; $null = Pay $oc "c"
  $ok = Mk "k" $pb 1; $null = Pay $ok "k"
  $op = Mk "p" $pb 1
  $s = State $oh; Check "fixture: held order on_hold, nothing deducted, refund requested" ($s.status -eq "on_hold" -and $s.ded -eq "null" -and $s.rr -eq "insufficient_stock:requested" -and $s.a -eq 1) "$($s | ConvertTo-Json -Compress)"
  $s = State $om; Check "fixture: mismatch order pending, refund requested" ($s.status -eq "pending" -and $s.rr -eq "amount_mismatch:requested") "$($s | ConvertTo-Json -Compress)"
  $s = State $or; Check "fixture: rto order (via courier function), stock restored, refund requested" ($s.status -eq "rto" -and $s.rr -eq "rto:requested") "$($s | ConvertTo-Json -Compress)"
  $b0 = (State $ok).b

  # ---- unsafe: the admin dropdown, real admin JWT
  foreach ($case in @(@($oh, "held", @("pending", "paid", "confirmed", "shipped", "delivered", "cancelled")),
                       @($om, "amount-mismatch", @("paid", "confirmed", "shipped", "delivered")),
                       @($or, "rto", @("pending", "paid", "confirmed", "shipped", "delivered", "cancelled")),
                       @($op, "unpaid", @("paid", "confirmed", "shipped", "delivered")))) {
    $before = State $case[0]
    foreach ($st in $case[2]) {
      $r = UiSetStatus $case[0] $st
      Check "admin UI: $($case[1]) -> $st is refused" ($r.Code -eq 400 -and $r.Body -match "ORDER_STATUS_BLOCKED") "HTTP $($r.Code)"
    }
    $after = State $case[0]
    Check "admin UI: $($case[1]) order unchanged (status, stock, lines, refunds, ledger)" (($before | ConvertTo-Json -Compress) -eq ($after | ConvertTo-Json -Compress)) "$($after | ConvertTo-Json -Compress)"
  }
  $r = Api $adm PATCH "orders?id=eq.$ok" @{ status = "on_hold" }
  Check "admin API: confirmed -> on_hold is refused" ($r.Code -eq 400 -and $r.Body -match "ORDER_STATUS_BLOCKED") "HTTP $($r.Code)"

  # ---- legitimate: normal fulfilment, cancel paths
  $r1 = Api $adm PATCH "orders?id=eq.$ok" @{ status = "shipped"; courier = "X"; tracking_number = "AWB-K-$stamp" }; $r2 = UiSetStatus $ok "delivered"
  $s = State $ok; Check "admin UI: paid order confirmed -> shipped -> delivered works, stock untouched" ($r1.Code -eq 200 -and $r2.Code -eq 200 -and $s.status -eq "delivered" -and $s.b -eq $b0 -and $s.ded -eq "1") "HTTP $($r1.Code)/$($r2.Code) $($s | ConvertTo-Json -Compress)"
  $r = UiSetStatus $op "cancelled"; $s = State $op
  Check "admin UI: unpaid order -> cancelled works, no refund, no stock change" ($r.Code -eq 200 -and $s.status -eq "cancelled" -and -not $s.rr -and $s.b -eq $b0) "HTTP $($r.Code)"
  $r = UiSetStatus $om2 "cancelled"; $s = State $om2
  Check "admin UI: amount-mismatch order -> cancelled works, still ONE refund request awaiting a decision" ($r.Code -eq 200 -and $s.status -eq "cancelled" -and $s.rr -eq "amount_mismatch:requested") "HTTP $($r.Code) $($s.rr)"
  $r = UiSetStatus $oc "cancelled"
  $done = $false; for ($i = 0; $i -lt 40 -and -not $done; $i++) { Start-Sleep 1; $done = ((State $oc).rr -eq "admin_cancel:processed") }
  $s = State $oc
  Check "admin UI: paid order -> cancelled: stock back once, refund auto-approved and PROCESSED (mock Razorpay)" ($r.Code -eq 200 -and $done -and $s.b -eq ($b0 + 1)) "HTTP $($r.Code) $($s | ConvertTo-Json -Compress)"
  $r = UiSetStatus $oc "confirmed"
  Check "admin UI: cancelled -> confirmed (reopen) is refused" ($r.Code -eq 400 -and $r.Body -match "ORDER_STATUS_BLOCKED") "HTTP $($r.Code)"
  Check "after reopen attempt: stock and refund unchanged" ((State $oc).b -eq ($b0 + 1) -and (State $oc).rr -eq "admin_cancel:processed")

  # ---- legitimate admin RPC on a held order: restock, fulfil, then ship
  Q "update products set stock_qty=5 where id=$pa" | Out-Null
  $r = Api $adm POST "rpc/fulfil_held_order" @{ p_order_id = $oh }; $s = State $oh
  Check "admin RPC fulfil_held_order after restock: confirmed, 2 taken, refund rejected" ($r.Code -in 200, 204 -and $s.status -eq "confirmed" -and $s.a -eq 3 -and $s.ded -eq "2" -and $s.rr -eq "insufficient_stock:rejected") "HTTP $($r.Code) $($s | ConvertTo-Json -Compress)"
  $r = UiSetStatus $oh "shipped"; Check "admin UI: fulfilled (formerly held) order ships" ($r.Code -eq 200 -and (State $oh).status -eq "shipped") "HTTP $($r.Code)"

  # ---- privileges through the API
  $rid = (Q "select id from refund_requests where order_id=$om")[0].id
  $r = Api $cust POST "rpc/approve_refund" @{ p_request_id = $rid }
  Check "customer cannot approve a refund (approve_refund)" ($r.Code -in 401, 403) "HTTP $($r.Code)"
  $r = Api $cust POST "rpc/reject_refund" @{ p_request_id = $rid; p_note = "x" }
  Check "customer cannot reject a refund (reject_refund)" ($r.Code -in 401, 403) "HTTP $($r.Code)"
  foreach ($who in @(@($cust, "customer"), @($adm, "admin"))) {
    $r = Api $who[0] POST "rpc/manual_refund_decision" @{ p_request_id = $rid; p_decision = "approve"; p_admin_email = $adm.Email; p_note = "x" }
    Check "manual procedure is not reachable over the API ($($who[1]))" ($r.Code -in 400, 401, 403, 404) "HTTP $($r.Code)"
  }
  $r = Api $cust PATCH "orders?id=eq.$om" @{ status = "confirmed" }
  Check "customer cannot confirm their own unpaid order" ($r.Code -ne 200 -or (State $om).status -eq "pending") "HTTP $($r.Code)"
  Check "after all API attempts: mismatch refund still awaiting a decision" ((State $om).rr -eq "amount_mismatch:requested")

  # ---- two operators decide the SAME request at the same moment: exactly one decision, one audit entry
  $rid2 = (Q "select id from refund_requests where order_id=$om2")[0].id
  $http = New-Object System.Net.Http.HttpClient
  $http.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", $pat)
  $http.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0")
  $tasks = foreach ($who in "A", "B") {
    $q = @{ query = "select private.manual_refund_decision($rid2, 'reject', '$($adm.Email)', 'concurrency test $who')::text r, pg_sleep(3)::text z" } | ConvertTo-Json
    $http.PostAsync("https://api.supabase.com/v1/projects/$Ref/database/query", (New-Object System.Net.Http.StringContent($q, [Text.Encoding]::UTF8, "application/json")))
  }
  [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]$tasks)
  $outs = @($tasks | % { $_.Result.Content.ReadAsStringAsync().Result })
  $http.Dispose()
  $nRej = @($outs | ? { $_ -match '\\"result\\":\s*\\"rejected' -or $_ -match '"result": "rejected' }).Count
  $nAlr = @($outs | ? { $_ -match 'already_rejected' }).Count
  $aud = (Q "select count(*) filter (where action='manual_decision') m, count(*) filter (where action='refund_rejected') r from financial_audit where entity='refund_request' and entity_id=$rid2")[0]
  Check "concurrent manual decisions: one 'rejected' + one 'already_rejected'" ($nRej -eq 1 -and $nAlr -eq 1) ($outs -join " | ")
  Check "concurrent manual decisions: exactly one manual_decision and one refund_rejected audit row" ($aud.m -eq 1 -and $aud.r -eq 1) "manual=$($aud.m) rejected=$($aud.r)"
  Check "concurrent manual decisions: request rejected, approved_by = the named admin" ((Q "select (status='rejected' and approved_by='$($adm.Id)')::text v from refund_requests where id=$rid2")[0].v -eq "true")
}
finally {
  # remove the fixtures (refund rows first; audit rows are append-only by design and stay)
  $ids = "select id from orders where razorpay_order_id like 'order\_zzg\_%\_$stamp'"
  Q "delete from refund_events where payment_id in (select id from payments where order_id in ($ids)); delete from refund_requests where order_id in ($ids); delete from payments where order_id in ($ids); delete from order_items where order_id in ($ids); delete from courier_events where awb='AWB-ZZG-$stamp'; delete from orders where id in ($ids); delete from products where sku like 'ZZ-GAPI-%-$stamp'; update ops_events set resolved_at=now() where resolved_at is null and entity='order' and entity_id not in (select id from orders)" | Out-Null
}
$results | Format-Table -AutoSize -Wrap
$f = @($results | ? Result -eq "FAIL").Count
"{0} checks, {1} passed, {2} failed" -f $results.Count, ($results.Count - $f), $f
if ($f) { exit 1 }
