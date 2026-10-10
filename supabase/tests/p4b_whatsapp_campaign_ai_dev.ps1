# P1 WhatsApp: the AI copy endpoint (whatsapp-campaign) with REAL logins on DEV. Creates two throwaway DEV accounts (one admin,
# one customer) with generated passwords kept only in the DEV Vault; passwords are never printed. DEV only.
#   ./supabase/tests/p4b_whatsapp_campaign_ai_dev.ps1 -Ref lffnmycocbtpyvntccbg
param([Parameter(Mandatory = $true)][string]$Ref)
$ErrorActionPreference = "Stop"
# The Supabase Management API throttles bursts ("ThrottlerException: Too Many Requests"); a long suite polls a lot, so every database call retries with backoff
function Invoke-MgmtRetry { param([string]$Method, [string]$Uri, $Headers, $Body)
  for ($try = 1; $try -le 8; $try++) {
    try { return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $Headers -Body $Body }
    catch { if ("$($_.ErrorDetails.Message)" -match 'Throttler|Too Many Requests' -and $try -lt 8) { Start-Sleep -Seconds (4 * $try); continue }; throw }
  }
}
if ($Ref -eq "vkcwfwgxelmamuydwrow") { throw "DEV only." }
$pat = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", "User")
$mh = @{ Authorization = "Bearer $pat"; "User-Agent" = "Mozilla/5.0"; "Content-Type" = "application/json" }
function Q([string]$sql) { try { Invoke-MgmtRetry -Method Post -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" -Headers $mh -Body ([Text.Encoding]::UTF8.GetBytes((@{ query = $sql } | ConvertTo-Json -Depth 3))) } catch { throw ("SQL error: " + (($_.ErrorDetails.Message -replace '(sbp_|eyJ)[A-Za-z0-9._-]+', '<redacted>') -replace '\s+', ' ')) } }
function Rand([int]$n) { -join ((48..57) + (97..122) | Get-Random -Count $n | ForEach-Object { [char]$_ }) }
$results = @(); function Check($n, [bool]$ok, $d = "") { $script:results += [pscustomobject]@{ Test = $n; Result = $(if ($ok) { "PASS" } else { "FAIL" }); Detail = [string]$d }; Write-Host ("{0,-4} {1}" -f $(if ($ok) { "ok" } else { "FAIL" }), $n) }
$anon = ((Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$Ref/api-keys" -Headers $mh) | Where-Object { $_.name -eq "anon" -or $_.type -eq "publishable" } | Select-Object -First 1).api_key
$fn = "https://$Ref.supabase.co/functions/v1"

function Ensure-Login([string]$email, [string]$role) {
  Q "do `$`$ begin if not exists (select 1 from vault.secrets where name='dev_test_pw_$role') then perform vault.create_secret('Pw-$(Rand 20)-x9', 'dev_test_pw_$role', 'DEV only: throwaway test login'); end if; end `$`$" | Out-Null
  $pw = (Q "select decrypted_secret s from vault.decrypted_secrets where name='dev_test_pw_$role'")[0].s
  Q "insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current)
     select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '$email', crypt('$pw', gen_salt('bf')), now(), '{`"provider`":`"email`",`"providers`":[`"email`"]}'::jsonb,
            '{`"first_name`":`"WA`",`"last_name`":`"$role`",`"phone`":`"98800009$(if ($role -eq 'admin') {'01'} else {'02'})`"}'::jsonb, now(), now(), '', '', '', '', ''
      where not exists (select 1 from auth.users where email='$email')" | Out-Null
  Q "update auth.users set encrypted_password = crypt('$pw', gen_salt('bf')), email_confirmed_at = coalesce(email_confirmed_at, now()) where email='$email'" | Out-Null
  Q "insert into auth.identities(id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
     select gen_random_uuid(), u.id, u.id::text, 'email', jsonb_build_object('sub', u.id::text, 'email', u.email), now(), now(), now() from auth.users u
      where u.email='$email' and not exists (select 1 from auth.identities i where i.user_id=u.id)" | Out-Null
  Q "update user_profiles set role='$role' where email='$email'" | Out-Null
  $r = Invoke-RestMethod -Method Post -Uri "https://$Ref.supabase.co/auth/v1/token?grant_type=password" -Headers @{ apikey = $anon; "Content-Type" = "application/json" } -Body (@{ email = $email; password = $pw } | ConvertTo-Json)
  $pw = $null; $r.access_token
}
function Call([string]$jwt, $body) {
  try { $r = Invoke-WebRequest -Method Post -Uri "$fn/whatsapp-campaign" -Headers @{ Authorization = "Bearer $jwt"; apikey = $anon; "Content-Type" = "application/json" } -Body ($body | ConvertTo-Json -Compress) -UseBasicParsing -TimeoutSec 60; [pscustomobject]@{ Code = [int]$r.StatusCode; Json = ($r.Content | ConvertFrom-Json) } }
  catch { $c = [int]$_.Exception.Response.StatusCode; $j = $null; try { $j = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() | ConvertFrom-Json } catch { }; [pscustomobject]@{ Code = $c; Json = $j } }
}

$adminJwt = Ensure-Login "wa-admin-login@example.test" "admin"; $custJwt = Ensure-Login "wa-customer-login@example.test" "customer"
$adm = (Q "select id i from user_profiles where email='wa-admin-login@example.test'")[0].i
Q "update ai_circuit set state='closed', consecutive_failures=0, opened_until=null where id=1" | Out-Null
$cid = (Q "select set_config('request.jwt.claims', json_build_object('sub','$adm','role','authenticated')::text, true) c, public.wa_create_campaign('ZZ WA AI copy','promo','en','{`"segment`":`"all_opted_in`"}'::jsonb,'https://img.example/x.png') id")[0].id
$brief = "Diwali offer 10% off glucometers"

$r1 = Call $adminJwt @{ action = "generate_copy"; campaign_id = $cid; brief = $brief }
Check "admin login: AI copy returns validated suggestions" ($r1.Code -eq 200 -and @($r1.Json.suggestions).Count -ge 1 -and $r1.Json.variable -eq "message") "HTTP $($r1.Code)"
$row = (Q "select status, variables, ai_copy from whatsapp_campaigns where id=$cid")[0]
Check "suggestions are stored as ai_copy ONLY: status stays draft and the campaign's approved wording (variables) stays empty" ($row.status -eq "draft" -and $null -eq $row.variables -and $row.ai_copy.suggestions.Count -ge 1)
Check "the AI call never touched recipients: no message was queued for this campaign" ([int](Q "select count(*) c from whatsapp_messages where campaign_id=$cid")[0].c -eq 0)
$r2 = Call $custJwt @{ action = "generate_copy"; campaign_id = $cid; brief = $brief }
Check "customer login: 403" ($r2.Code -eq 403) "HTTP $($r2.Code)"
$r3 = Call $adminJwt @{ action = "generate_copy"; campaign_id = $cid; brief = "" }
Check "empty brief: 400" ($r3.Code -eq 400)
$r4 = Call $adminJwt @{ action = "approve_campaign"; campaign_id = $cid }
Check "the function has no approve/send/audience action (unknown action -> 400)" ($r4.Code -eq 400)
$r5 = Call $adminJwt @{ action = "generate_copy"; campaign_id = 999999; brief = $brief }
Check "unknown campaign: 404" ($r5.Code -eq 404)
Q "update ai_circuit set state='open', consecutive_failures=5, opened_until=now()+interval '5 minutes' where id=1" | Out-Null
$r6 = Call $adminJwt @{ action = "generate_copy"; campaign_id = $cid; brief = $brief }
Check "AI circuit open: 503 with 'write the copy by hand', no model call" ($r6.Code -eq 503 -and "$($r6.Json.error)" -match "by hand")
Q "update ai_circuit set state='closed', consecutive_failures=0, opened_until=null where id=1" | Out-Null
Q "update whatsapp_campaigns set status='cancelled' where id=$cid" | Out-Null
$results | Format-Table -AutoSize -Wrap
$failed = @($results | Where-Object { $_.Result -eq "FAIL" }).Count
Write-Host "$(@($results).Count) checks, $failed failed."; if ($failed) { exit 1 }
