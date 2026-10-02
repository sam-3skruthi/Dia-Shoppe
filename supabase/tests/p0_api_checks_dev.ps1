# P0 checks that need the DEPLOYED environment (HTTP + real triggers). DEV only.
#   ./p0_api_checks_dev.ps1 -Ref <dev-ref>
# STATUS: written, not yet executed (waiting for DEV access).
param([Parameter(Mandatory = $true)][string]$Ref)
$ErrorActionPreference = "Stop"
if ($Ref -eq "vkcwfwgxelmamuydwrow") { throw "DEV only." }
$token = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", "User")
$h = @{ Authorization = "Bearer $token"; "User-Agent" = "Mozilla/5.0"; "Content-Type" = "application/json" }
function Q([string]$sql) { Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" -Headers $h -Body ([Text.Encoding]::UTF8.GetBytes((@{ query = $sql } | ConvertTo-Json -Depth 3))) }
$fn = "https://$Ref.supabase.co/functions/v1"; $rest = "https://$Ref.supabase.co/rest/v1"
$results = @(); function Check($n, [bool]$ok, $d = "") { $script:results += [pscustomobject]@{ Test = $n; Result = $(if ($ok) { "PASS" } else { "FAIL" }); Detail = $d } }
function Code([scriptblock]$b) { try { (& $b).StatusCode } catch { [int]$_.Exception.Response.StatusCode } }

# --- hook secrets -------------------------------------------------------------------------
$sbRoot = Split-Path $PSScriptRoot -Parent
$old = [regex]::Match((Get-Content "$sbRoot\migrations\012_whatsapp_trigger.sql" -Raw), "x-hook-secret',\s*'([0-9a-f]+)'").Groups[1].Value
$v = @{}; foreach ($r in (Q "select name, decrypted_secret s from vault.decrypted_secrets where name like 'hook_%'")) { $v[$r.name] = $r.s }
$targets = @(@("whatsapp-notify", '{"order_id":999999,"new_status":"shipped"}', "hook_whatsapp_notify"), @("order-email", '{"order_id":999999}', "hook_order_email"), @("process-refund", '{"refund_request_id":999999}', "hook_process_refund"))
foreach ($t in $targets) {
  $call = { param($sec) Code { Invoke-WebRequest -Method Post -Uri "$fn/$($t[0])" -Headers @{ "x-hook-secret" = $sec } -ContentType "application/json" -Body $t[1] -UseBasicParsing } }
  Check "H1 $($t[0]): OLD committed secret rejected" ((& $call $old) -eq 401)
  Check "H2 $($t[0]): own Vault secret accepted (not 401)" ((& $call $v[$t[2]]) -ne 401)
  $other = ($v.GetEnumerator() | ? { $_.Name -ne $t[2] } | select -First 1).Value
  Check "H3 $($t[0]): another function's secret rejected" ((& $call $other) -eq 401)
}

# --- triggers authenticate their targets (real committed order, real pg_net) --------------
$uid = (Q "select id from user_profiles where email='dev-customer@example.test'")[0].id
$since = (Q "select coalesce(max(id),0) m from net._http_response")[0].m
$oid = (Q "insert into orders(user_id,total_amount,status,payment_method,shipping_address,shipping_phone) values ('$uid',1,'confirmed','cod','x','0') returning id")[0].id
Start-Sleep 8
$resp = Q "select status_code, count(*) c from net._http_response where id > $since group by 1"
$n401 = (@($resp) | ? { $_.status_code -eq 401 } | % { $_.c } | Measure-Object -Sum).Sum
$ok = (@($resp) | ? { $_.status_code -ne 401 } | % { $_.c } | Measure-Object -Sum).Sum
Check "H4 triggers reached order-email + whatsapp-notify without 401" (($n401 -eq 0 -or -not $n401) -and $ok -ge 2) "responses: $((@($resp) | % { "$($_.status_code)x$($_.c)" }) -join ', ')"
Q "delete from orders where id=$oid" | Out-Null

# --- anonymous / customer data exposure over the REAL PostgREST API ----------------------
$anon = ((Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$Ref/api-keys" -Headers $h) | ? { $_.name -eq "anon" -or $_.type -eq "publishable" } | select -First 1).api_key
$ah = @{ apikey = $anon }
$cat = (Q "select id from categories limit 1")[0].id
Q "insert into products(name,price,sku,category_id,stock_qty,is_active,cost_price) values ('ZZ api',100,'ZZ-API',$cat,5,true,77.5)" | Out-Null
$pj = Invoke-RestMethod -Uri "$rest/products?select=*,categories(slug)&sku=eq.ZZ-API" -Headers $ah
Check "C1 storefront query (select=*) works for anon" ($pj.Count -eq 1)
Check "C2 anon sees NO cost_price value" ($null -eq $pj[0].cost_price)
Check "C3 anon cannot read product_costs" ((Code { Invoke-WebRequest -Uri "$rest/product_costs?select=*" -Headers $ah -UseBasicParsing }) -eq 401 -or (Code { Invoke-WebRequest -Uri "$rest/product_costs?select=*" -Headers $ah -UseBasicParsing }) -eq 403)
Check "C4 cost stored privately (admin-only table)" ([decimal](Q "select cost_price c from product_costs pc join products p on p.id=pc.product_id where p.sku='ZZ-API'")[0].c -eq 77.5)
Check "C5 anon cannot call settle_payment / confirm_online_payment" ((Code { Invoke-WebRequest -Method Post -Uri "$rest/rpc/settle_payment" -Headers $ah -ContentType "application/json" -Body '{"p_payment_id":"x","p_rzp_order_id":"y","p_amount_paise":1,"p_source":"t"}' -UseBasicParsing }) -in 401, 403)
Check "C6 anon cannot read payments / refund_requests / financial_audit" ((@("payments", "refund_requests", "financial_audit") | ? { (Code { Invoke-WebRequest -Uri "$rest/${_}?select=*" -Headers $ah -UseBasicParsing }) -notin 401, 403 }).Count -eq 0)
Q "delete from products where sku='ZZ-API'" | Out-Null

$results | Format-Table -AutoSize -Wrap
if (@($results | ? Result -eq "FAIL").Count) { exit 1 }
