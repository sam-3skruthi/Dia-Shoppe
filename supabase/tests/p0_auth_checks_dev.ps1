# REAL-LOGIN permission checks for the DEV project. YOU run this in your own terminal.
#   ./p0_auth_checks_dev.ps1 -Ref lffnmycocbtpyvntccbg
# Before running, sign up TWO accounts in the DEV app (or Supabase DEV dashboard > Authentication > Add user):
#   - a CUSTOMER (any email)           - an ADMIN: use an email on the admin allow-list (migration 025)
# The script asks for both emails + passwords with hidden input. Passwords are used only to call DEV's
# /auth/v1/token and are never written anywhere. It creates throwaway fixtures with your access token
# and removes them at the end. DEV only.
param([Parameter(Mandatory = $true)][string]$Ref)
$ErrorActionPreference = "Stop"
if ($Ref -eq "vkcwfwgxelmamuydwrow") { throw "DEV only." }
$pat = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", "User")
$mh = @{ Authorization = "Bearer $pat"; "User-Agent" = "Mozilla/5.0"; "Content-Type" = "application/json" }
function Q([string]$sql) { try { Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" -Headers $mh -Body ([Text.Encoding]::UTF8.GetBytes((@{ query = $sql } | ConvertTo-Json -Depth 3))) } catch { throw ("SQL error: " + (($_.ErrorDetails.Message -replace '(sbp_|eyJ)[A-Za-z0-9._-]+','<redacted>') -replace '\s+',' ')) } }
$anon = ((Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$Ref/api-keys" -Headers $mh) | ? { $_.name -eq "anon" -or $_.type -eq "publishable" } | select -First 1).api_key
$rest = "https://$Ref.supabase.co/rest/v1"

function Login([string]$label) {
  $email = Read-Host "$label email"; $sec = Read-Host "$label password" -AsSecureString
  $pw = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBGSTR($sec))
  $r = Invoke-RestMethod -Method Post -Uri "https://$Ref.supabase.co/auth/v1/token?grant_type=password" -Headers @{ apikey = $anon; "Content-Type" = "application/json" } -Body (@{ email = $email; password = $pw } | ConvertTo-Json)
  $pw = $null
  [pscustomobject]@{ Email = $email; Id = $r.user.id; Jwt = $r.access_token }
}
$cust = Login "CUSTOMER"; $adm = Login "ADMIN"
$role = (Q "select role r from user_profiles where id='$($adm.Id)'")[0].r
if ($role -ne "admin") { throw "The ADMIN account is not an admin in DEV (role=$role). Use an allow-listed email (migration 025)." }
if ((Q "select role r from user_profiles where id='$($cust.Id)'")[0].r -ne "customer") { throw "The CUSTOMER account must have role customer." }

function Api($who, [string]$method, [string]$path, $body = $null) {
  $h = @{ apikey = $anon; Authorization = "Bearer $($who.Jwt)"; "Content-Type" = "application/json"; Prefer = "return=representation" }
  try {
    $a = @{ Method = $method; Uri = "$rest/$path"; Headers = $h; UseBasicParsing = $true }; if ($body) { $a.Body = ($body | ConvertTo-Json -Compress) }
    $r = Invoke-WebRequest @a; [pscustomobject]@{ Code = [int]$r.StatusCode; Json = $(if ($r.Content) { $r.Content | ConvertFrom-Json } else { $null }) }
  } catch { [pscustomobject]@{ Code = [int]$_.Exception.Response.StatusCode; Json = $null } }
}
$results = @(); function Check($n, [bool]$ok, $d = "") { $script:results += [pscustomobject]@{ Test = $n; Result = $(if ($ok) { "PASS" } else { "FAIL" }); Detail = $d } }

# ---- fixtures (created with the access token, removed in finally)
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$cat = (Q "select id from categories limit 1")[0].id
$prod = (Q "insert into products(name,price,sku,category_id,stock_qty,is_active,cost_price) values ('ZZ auth',100,'ZZ-AUTH-$stamp',$cat,10,true,55) returning id")[0].id
$cid = $cust.Id
function Mk($status, $rzp) { (Q "insert into orders(user_id,total_amount,status,payment_method,shipping_address,shipping_phone,razorpay_order_id) values ('$cid',1,'$status','online','x','0','$rzp') returning id")[0].id }
$oCancel = Mk "pending" "order_zza_c_$stamp"; Q "insert into order_items(order_id,product_id,quantity,price_at_purchase) values ($oCancel,$prod,1,1)" | Out-Null
$oRto = Mk "pending" "order_zza_r_$stamp"; Q "insert into order_items(order_id,product_id,quantity,price_at_purchase) values ($oRto,$prod,1,1)" | Out-Null
$tot = [int]([decimal](Q "select total_amount t from orders where id=$oRto")[0].t * 100)
Q "select public.settle_payment('pay_captured_${tot}_auth1__order_zza_r_$stamp','order_zza_r_$stamp',$tot,'test')" | Out-Null
Q "update orders set status='shipped' where id=$oRto" | Out-Null; Q "update orders set status='rto' where id=$oRto" | Out-Null
$reqId = (Q "select id from refund_requests where order_id=$oRto")[0].id
function Wait-Status($oid,[string]$want){ for($i=0;$i -lt 25;$i++){ $r=Q "select status s from refund_requests where order_id=$oid order by id desc limit 1"; if($r -and $r[0].s -eq $want){return $true}; Start-Sleep 1 }; $false }
$otherUser = (Q "select id from auth.users where id <> '$cid' and id <> '$($adm.Id)' limit 1")
try {
  # ---------------- CUSTOMER ----------------
  $p = Api $cust GET "products?select=*&id=eq.$prod"
  Check "CUST sees the product but cost_price is empty" ($p.Json.Count -eq 1 -and $null -eq $p.Json[0].cost_price)
  Check "CUST product_costs returns nothing" ((Api $cust GET "product_costs?select=*").Json.Count -eq 0)
  foreach ($t in "payments", "refund_requests", "financial_audit") { Check "CUST $t returns nothing" ((Api $cust GET "${t}?select=*").Json.Count -eq 0) }
  $own = Api $cust GET "orders?select=id,user_id"
  Check "CUST sees only their own orders" (@($own.Json | ? { $_.user_id -ne $cid }).Count -eq 0 -and $own.Json.Count -ge 2)
  Check "CUST cannot make themselves admin" ((Api $cust PATCH "user_profiles?id=eq.$cid" @{ role = "admin" }).Code -in 401, 403)
  Check "CUST cannot change an order total" ((Api $cust PATCH "orders?id=eq.$oCancel" @{ total_amount = 1 }).Code -in 401, 403)
  Check "CUST cannot approve a refund (and it stays requested)" (((Api $cust POST "rpc/approve_refund" @{ p_request_id = $reqId }).Code -ge 400) -and ((Q "select status s from refund_requests where id=$reqId")[0].s -eq "requested"))
  Check "CUST cannot call settle_payment" ((Api $cust POST "rpc/settle_payment" @{ p_payment_id = "x"; p_rzp_order_id = "y"; p_amount_paise = 1; p_source = "t" }).Code -in 401, 403)
  $c = Api $cust PATCH "orders?id=eq.$oCancel" @{ status = "cancelled"; cancelled_by = "customer" }
  Check "CUST can cancel their own pending order" ($c.Code -in 200, 204 -and (Q "select status s from orders where id=$oCancel")[0].s -eq "cancelled")

  # ---------------- DEPLOYED verify-payment, called with the customer's REAL session ----------------
  $keySecret = (Q "select decrypted_secret s from vault.decrypted_secrets where name='dev_test_razorpay_key_secret'")[0].s
  function Verify([string]$orderId, [string]$rzp, [long]$paise, [string]$uniq) {
    $payId = "pay_captured_${paise}_${uniq}__$rzp"
    $hm = New-Object System.Security.Cryptography.HMACSHA256 (, [Text.Encoding]::UTF8.GetBytes($keySecret))
    $sig = ($hm.ComputeHash([Text.Encoding]::UTF8.GetBytes("$rzp|$payId")) | % { $_.ToString("x2") }) -join ""
    $b = @{ razorpay_order_id = $rzp; razorpay_payment_id = $payId; razorpay_signature = $sig; internal_order_id = [long]$orderId } | ConvertTo-Json
    try { (Invoke-WebRequest -Method Post -Uri "https://$Ref.supabase.co/functions/v1/verify-payment" -Headers @{ apikey = $anon; Authorization = "Bearer $($cust.Jwt)"; "Content-Type" = "application/json" } -Body $b -UseBasicParsing).Content | ConvertFrom-Json }
    catch { [pscustomobject]@{ success = $false; code = "HTTP_$([int]$_.Exception.Response.StatusCode)" } }
  }
  $tCancel = [int]([decimal](Q "select total_amount t from orders where id=$oCancel")[0].t * 100)
  $v = Verify $oCancel "order_zza_c_$stamp" $tCancel "v1"
  Check "VERIFY late payment after customer cancel -> success:false + ORDER_CANCELLED_REFUND_INITIATED" ($v.success -eq $false -and $v.code -eq "ORDER_CANCELLED_REFUND_INITIATED") "code=$($v.code)"
  $v = Verify $oCancel "order_zza_c_$stamp" $tCancel "v1"
  Check "VERIFY replay of that late payment -> still success:false" ($v.success -eq $false -and $v.code -eq "ORDER_CANCELLED_REFUND_INITIATED")
  $oExp = (Q "insert into orders(user_id,total_amount,status,payment_method,shipping_address,shipping_phone,razorpay_order_id,created_at) values ('$cid',1,'pending','online','x','0','order_zza_e_$stamp', now() - interval '31 minutes') returning id")[0].id
  Q "insert into order_items(order_id,product_id,quantity,price_at_purchase) values ($oExp,$prod,1,1)" | Out-Null
  Q "select private.expire_pending_orders(30)" | Out-Null
  $v = Verify $oExp "order_zza_e_$stamp" $tCancel "v2"
  Check "VERIFY payment after 30-min EXPIRY -> success:false + refund code" ($v.success -eq $false -and $v.code -eq "ORDER_CANCELLED_REFUND_INITIATED") "code=$($v.code)"
  $oBad = Mk "pending" "order_zza_b_$stamp"; Q "insert into order_items(order_id,product_id,quantity,price_at_purchase) values ($oBad,$prod,1,1)" | Out-Null
  $v = Verify $oBad "order_zza_b_$stamp" 100 "v3"
  Check "VERIFY wrong amount -> success:false + PAYMENT_UNDER_REVIEW, order NOT confirmed" ($v.success -eq $false -and $v.code -eq "PAYMENT_UNDER_REVIEW" -and (Q "select status s from orders where id=$oBad")[0].s -eq "pending") "code=$($v.code)"
  $v = Verify $oBad "order_zza_b_$stamp" 100 "v3"
  Check "VERIFY replay of wrong-amount payment -> STILL success:false" ($v.success -eq $false -and $v.code -eq "PAYMENT_UNDER_REVIEW")
  $oOk = Mk "pending" "order_zza_o_$stamp"; Q "insert into order_items(order_id,product_id,quantity,price_at_purchase) values ($oOk,$prod,1,1)" | Out-Null
  $tOk = [int]([decimal](Q "select total_amount t from orders where id=$oOk")[0].t * 100)
  $v = Verify $oOk "order_zza_o_$stamp" $tOk "v4"
  Check "VERIFY normal payment -> success:true and order confirmed" ($v.success -eq $true -and (Q "select status s from orders where id=$oOk")[0].s -eq "confirmed")
  $v = Verify $oOk "order_zza_o_$stamp" $tOk "v4"
  Check "VERIFY replay of normal payment -> success:true alreadyProcessed, stock taken once" ($v.success -eq $true -and $v.alreadyProcessed -eq $true -and [int](Q "select stock_deducted_qty d from order_items where order_id=$oOk")[0].d -eq 1)
  Check "VERIFY late payments were refunded through the mock" ((Wait-Status $oCancel "processed") -and (Wait-Status $oExp "processed"))

  # ---------------- ADMIN ----------------
  Check "ADMIN sees product cost (55)" ([decimal](Api $adm GET "product_costs?select=*&product_id=eq.$prod").Json[0].cost_price -eq 55)
  foreach ($t in "payments", "refund_requests", "financial_audit") { Check "ADMIN can read $t" ((Api $adm GET "${t}?select=*&limit=1").Json.Count -ge 1) }
  Api $adm PATCH "products?id=eq.$prod" @{ cost_price = 60 } | Out-Null
  Check "ADMIN cost edit lands in product_costs, public column stays empty" (([decimal](Q "select cost_price c from product_costs where product_id=$prod")[0].c -eq 60) -and ($null -eq (Q "select cost_price c from products where id=$prod")[0].c))
  $ap = Api $adm POST "rpc/approve_refund" @{ p_request_id = $reqId }
  Check "ADMIN can approve the RTO refund" ($ap.Code -in 200, 204 -and (Q "select approved_by::text a from refund_requests where id=$reqId")[0].a -eq $adm.Id)
  Start-Sleep 12
  $final = (Q "select status s from refund_requests where id=$reqId")[0].s
  Check "RTO refund executed after approval (needs deployed process-refund + mock)" ($final -eq "processed") "status=$final"
  $chain = (Q "select string_agg(action, ' > ' order by id) c from financial_audit where detail->>'order_id' = '$oRto'")[0].c
  Check "audit chain complete" ($chain -eq "payment_captured > payment_recorded > refund_requested > refund_approved > refund_submitted > refund_processed") $chain
}
finally {
  Q "delete from zz_mock_refunds where payment_id like '%order_zza_%$stamp%'" | Out-Null
  $all = (@($oCancel,$oRto,$oExp,$oBad,$oOk) | ? { $_ }) -join ','
  Q "delete from refund_requests where order_id in ($all)" | Out-Null
  Q "delete from payments where order_id in ($all)" | Out-Null
  Q "delete from orders where id in ($all)" | Out-Null
  Q "delete from products where id=$prod" | Out-Null
}
$results | Format-Table -AutoSize -Wrap
if (@($results | ? Result -eq "FAIL").Count) { exit 1 }
