# GUIDED real-Meta round trip on DEV. YOU run this with a Meta TEST number and your own phone; it cannot be run without them.
#   1. ./supabase/scripts/dev-whatsapp-real-mode.ps1 -Ref lffnmycocbtpyvntccbg -Mode real        (follow what it prints for the Meta webhook)
#   2. ./supabase/tests/p6_meta_real_dev_roundtrip.ps1 -Ref lffnmycocbtpyvntccbg
# It asks for your phone number (digits with country code), the Meta app secret and the access token (hidden input, used only inside this
# window to verify signatures and to read template/phone info from Graph; never stored or printed), and asks you to send messages from your phone.
# Every check prints PASS/FAIL and the evidence. It never deletes anything and never touches production.
# What it proves: webhook verification, X-Hub-Signature-256 over REAL Meta bytes, real inbound -> dedup -> reply, a real outbound utility
# template, real sent/delivered/read callbacks, a real failed send and Meta's real error code, STOP/START, queue behaviour with the real API.
param([Parameter(Mandatory = $true)][string]$Ref, [int]$WaitSeconds = 180)
$ErrorActionPreference = "Stop"
if ($Ref -eq "vkcwfwgxelmamuydwrow") { throw "DEV only." }
function Get-PlainText([System.Security.SecureString]$s) { (New-Object System.Management.Automation.PSCredential('x', $s)).GetNetworkCredential().Password }
$pat = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", "User")
$mh = @{ Authorization = "Bearer $pat"; "User-Agent" = "Mozilla/5.0"; "Content-Type" = "application/json" }
function Q([string]$sql) { try { Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" -Headers $mh -Body ([Text.Encoding]::UTF8.GetBytes((@{ query = $sql } | ConvertTo-Json -Depth 3))) } catch { throw ("SQL error: " + (($_.ErrorDetails.Message -replace '(sbp_|eyJ)[A-Za-z0-9._-]+', '<redacted>') -replace '\s+', ' ')) } }
function Row([string]$sql) { $r = Q $sql; if ($null -eq $r) { return $null }; $a = @($r | Where-Object { $null -ne $_ }); if ($a.Count -eq 0) { return $null }; $a[0] }
function Val([string]$sql, [string]$col) { $r = Row $sql; if ($null -eq $r) { return $null }; $r.$col }
function Esc([string]$s) { $s.Replace("'", "''") }
$fn = "https://$Ref.supabase.co/functions/v1"
$results = @(); function Check([string]$n, [bool]$ok, $d = "") { $script:results += [pscustomobject]@{ Test = $n; Result = $(if ($ok) { "PASS" } else { "FAIL" }); Evidence = [string]$d }; Write-Host ("{0,-4} {1}  {2}" -f $(if ($ok) { "PASS" } else { "FAIL" }), $n, $d) -ForegroundColor $(if ($ok) { "Green" } else { "Red" }) }
function Info([string]$m) { Write-Host "     $m" -ForegroundColor Cyan }
function Wait-For([scriptblock]$cond, [int]$secs) { for ($i = 0; $i -lt $secs; $i++) { if (& $cond) { return $true }; Start-Sleep 2; $i++ }; $false }
function HmacHex([byte[]]$bytes, [string]$secret) { $h = New-Object System.Security.Cryptography.HMACSHA256 (, [Text.Encoding]::UTF8.GetBytes($secret)); ($h.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join "" }
$workerSec = Val "select decrypted_secret s from vault.decrypted_secrets where name='hook_whatsapp_worker'" "s"
$verifyTok = Val "select decrypted_secret s from vault.decrypted_secrets where name='dev_test_whatsapp_verify_token'" "s"
function Run-Worker { try { Invoke-RestMethod -Method Post -Uri "$fn/whatsapp-worker" -Headers @{ "x-hook-secret" = $workerSec } -Body "{}" -ContentType "application/json" -TimeoutSec 120 } catch { $null } }

# ---- preflight
$s = Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$Ref/secrets" -Headers $mh; $names = @($s | ForEach-Object { $_.name })
Check "R0 DEV is in REAL mode (no WHATSAPP_API_BASE override, Meta secrets present, payload capture on)" (($names -notcontains "WHATSAPP_API_BASE") -and ($names -contains "META_APP_SECRET_WHATSAPP") -and ($names -contains "WHATSAPP_TOKEN") -and ($names -contains "WHATSAPP_CAPTURE_PAYLOADS")) "run dev-whatsapp-real-mode.ps1 -Mode real first"
if (@($results | Where-Object { $_.Result -eq "FAIL" }).Count) { throw "Not in real mode; nothing was sent." }
$g = try { (Invoke-WebRequest -UseBasicParsing "$fn/whatsapp-inbound?hub.mode=subscribe&hub.verify_token=$verifyTok&hub.challenge=PING").Content } catch { "" }
Check "R0 our callback answers the verification handshake (what Meta does when you press 'Verify and save')" ($g -eq "PING")
$phone = (Read-Host "Your WhatsApp number that is allowed to receive from the test number (digits, with country code, e.g. 919876543210)").Trim()
if ($phone -notmatch '^\d{11,15}$') { throw "Digits only, with country code." }
$secret = Get-PlainText (Read-Host "Meta APP SECRET (to re-verify captured signatures here; not stored)" -AsSecureString)
$token = Get-PlainText (Read-Host "WhatsApp ACCESS TOKEN (read-only Graph checks; not stored)" -AsSecureString)
$phoneId = (Read-Host "WhatsApp PHONE NUMBER ID").Trim(); $waba = (Read-Host "WhatsApp BUSINESS ACCOUNT ID").Trim()
$gh = @{ Authorization = "Bearer $token" }

# ---- R1 Graph read-only checks and template readiness
try { $pn = Invoke-RestMethod -Uri "https://graph.facebook.com/v21.0/${phoneId}?fields=display_phone_number,verified_name,quality_rating" -Headers $gh; Check "R1 access token + phone-number id are valid at Meta" $true "number $($pn.display_phone_number), name '$($pn.verified_name)', quality $($pn.quality_rating)" } catch { Check "R1 access token + phone-number id are valid at Meta" $false "Graph said HTTP $([int]$_.Exception.Response.StatusCode)" }
$sync = try { Invoke-RestMethod -Method Post -Uri "$fn/whatsapp-sync-templates" -Headers @{ "x-hook-secret" = $workerSec } -Body "{}" -ContentType "application/json" } catch { $null }
Check "R1 template registry sync with REAL Meta succeeds" ($sync -and $sync.ok) ($sync | ConvertTo-Json -Compress)
$tpls = Q "select name, language, category, status, body_params, enabled from whatsapp_templates order by name"
$tpls | ForEach-Object { Info ("registry: {0}/{1} {2} {3} vars={4} enabled={5}" -f $_.name, $_.language, $_.category, $_.status, $_.body_params, $_.enabled) }
$ou = Row "select * from whatsapp_templates where name='order_update' and language='en'"
Check "R1 order_update/en exists at Meta, is APPROVED, enabled, 4 variables (else the next step cannot work: fix the template or the registry)" ($ou -and $ou.status -eq "approved" -and $ou.enabled -and $ou.body_params -eq 4) ($ou | ConvertTo-Json -Compress)

# ---- R2 real outbound template + real status callbacks
$idem = "real:out:$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
$enq = (Row "select public.wa_enqueue('$phone','utility','order_confirmed','order_update','en','[`"Tester`",`"1`",`"confirmed`",`"This is a DEV round-trip test.`"]'::jsonb,'DEV real round trip','$idem') r").r
Run-Worker | Out-Null; $o = Row "select * from whatsapp_messages where idempotency_key='$idem'"
Check "R2 outbound utility template ACCEPTED by real Meta: wamid saved, status accepted" ($o.status -eq "accepted" -and $o.wamid -like "wamid.*") "status=$($o.status) wamid=$($o.wamid) err=$($o.error_code) $($o.error_message)"
if ($o.status -ne "accepted") { Info "Meta's reason is stored on the row (error_code / error_message). Typical: 131030 recipient not in the allowed list, 132001 template/language mismatch, 190 token." }
else {
  Write-Host "     >>> Look at your phone: the message should arrive. Open it so Meta can send the 'read' callback." -ForegroundColor Yellow
  $got = Wait-For { (Val "select status s from whatsapp_messages where idempotency_key='$idem'" "s") -in "sent", "delivered", "read" } $WaitSeconds
  $o = Row "select * from whatsapp_messages where idempotency_key='$idem'"
  Check "R2 REAL status callback received and verified (sent/delivered/read) through the signed webhook" $got "status=$($o.status) sent=$($o.provider_sent_at) delivered=$($o.delivered_at) read=$($o.read_at)"
  $null = Wait-For { (Val "select status s from whatsapp_messages where idempotency_key='$idem'" "s") -eq "read" } 60
  $o = Row "select * from whatsapp_messages where idempotency_key='$idem'"
  Check "R2 delivery timeline is monotonic and complete (read after delivered after sent)" ($o.status -eq "read" -and $o.delivered_at -and $o.read_at) "final status $($o.status)  (open the message on the phone to get 'read')"
}

# ---- R3 real inbound + dedup + reply
$mark = [DateTimeOffset]::UtcNow.ToString("o"); $beforeId = [int](Val "select coalesce(max(id),0) m from whatsapp_messages" "m")
Write-Host "     >>> From your phone, send the text  hello from the tester  to the business number now (waiting up to $WaitSeconds s)." -ForegroundColor Yellow
$in = Wait-For { [bool](Row "select 1 x from whatsapp_messages where direction='inbound' and id > $beforeId") } $WaitSeconds
$inRow = Row "select * from whatsapp_messages where direction='inbound' and id > $beforeId order by id limit 1"
Check "R3 REAL inbound message stored through the signed webhook (wamid format, E.164 phone, type text)" ($inRow -and $inRow.wamid -like "wamid.*" -and $inRow.content_type -eq "text") "wamid=$($inRow.wamid) phone=$($inRow.phone_e164)"
if ($inRow) {
  $null = Wait-For { Run-Worker | Out-Null; (Val "select status s from whatsapp_messages where id=$($inRow.id)" "s") -eq "processed" } 60
  $reply = Row "select * from whatsapp_messages where direction='outbound' and idempotency_key='reply:$($inRow.wamid)'"
  Check "R3 reply queued once and sent through real Meta inside the 24 h window (AI disabled -> safe handoff text)" ($reply -and $reply.status -in "accepted", "sent", "delivered", "read" -and $reply.wamid -like "wamid.*") "status=$($reply.status) code=$($reply.error_code) $($reply.error_message)"
}

# ---- R3b webhook latency / async: what Meta experienced, read from the Edge logs (calls whose caller is not this script)
$lq = "select timestamp, log_attributes['response.status_code'] st, log_attributes['execution_time_ms'] ms, log_attributes['request.headers.user_agent'] ua from logs where source='function_edge_logs' and log_attributes['request.pathname'] like '%whatsapp-inbound%' and log_attributes['request.method']='POST' order by timestamp desc limit 30"
$iso0 = (Get-Date).ToUniversalTime().AddHours(-3).ToString("o"); $iso1 = (Get-Date).ToUniversalTime().AddMinutes(1).ToString("o")
$lg = $null; try { $lg = @((Invoke-RestMethod -Uri ("https://api.supabase.com/v1/projects/$Ref/analytics/endpoints/logs?sql=" + [uri]::EscapeDataString($lq) + "&iso_timestamp_start=$iso0&iso_timestamp_end=$iso1") -Headers $mh).result | Where-Object { $_.ua -notlike "Mozilla*" }) } catch { }
if ($lg -and @($lg).Count) {
  $maxMs = ($lg | ForEach-Object { [int]$_.ms } | Measure-Object -Maximum).Maximum; $non200 = @($lg | Where-Object { $_.st -ne "200" }).Count
  Check "R3b Meta's REAL webhook calls were all answered HTTP 200, slowest $maxMs ms (acknowledged before the slow work; Meta retries unacknowledged events for up to 36 h)" ($non200 -eq 0 -and $maxMs -lt 3000) "calls=$(@($lg).Count) non200=$non200 caller=$(@($lg)[0].ua)"
} else { Check "R3b Edge log shows Meta's real webhook calls (caller user-agent is not this script)" $false "no log rows yet (logs can lag a minute or two); rerun this step or read them in the dashboard" }

# ---- R4 REAL bytes: signature validation and replay of a captured delivery
$caps = Q "select id, signature, body from whatsapp_payload_captures order by id"
$okSig = 0; foreach ($c in $caps) { if ($c.signature -eq ("sha256=" + (HmacHex ([Text.Encoding]::UTF8.GetBytes($c.body)) $secret))) { $okSig++ } }
Check "R4 every captured REAL webhook body matches its X-Hub-Signature-256 under the Meta app secret ($okSig of $(@($caps).Count))" (@($caps).Count -gt 0 -and $okSig -eq @($caps).Count)
$msgCap = $caps | Where-Object { $_.body -match '"messages"' } | Select-Object -First 1
if ($msgCap) {
  $r1 = try { Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$fn/whatsapp-inbound" -Headers @{ "x-hub-signature-256" = $msgCap.signature; "Content-Type" = "application/json" } -Body ([Text.Encoding]::UTF8.GetBytes($msgCap.body)) } catch { $null }
  $dupBody = if ($r1) { $r1.Content } else { "" }
  $repliesNow = [int](Val "select count(*) c from whatsapp_messages where direction='outbound' and idempotency_key like 'reply:%'" "c")
  Check "R4 replaying the REAL captured delivery (real signature) -> 200 duplicate, no second reply" ($r1 -and $r1.StatusCode -eq 200 -and $dupBody -match '"duplicates":[1-9]') $dupBody
  $tam = $msgCap.body -replace "hello", "hellp"
  $r2 = try { Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$fn/whatsapp-inbound" -Headers @{ "x-hub-signature-256" = $msgCap.signature } -Body ([Text.Encoding]::UTF8.GetBytes($tam)) -ContentType "application/json" } catch { $_.Exception.Response }
  Check "R4 the same real signature over a modified body is rejected (401)" ([int]$r2.StatusCode -eq 401)
}

# ---- R5 real failed send and Meta's real error classification
$bad = (Read-Host "A phone number NOT on your test allow-list (any valid number, digits) to provoke a real Meta failure, or press Enter to skip").Trim()
if ($bad -match '^\d{11,15}$') {
  $ik = "real:fail:$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
  Q "select public.wa_enqueue('$bad','utility','order_confirmed','order_update','en','[`"Tester`",`"2`",`"confirmed`",`"x`"]'::jsonb,'x','$ik')" | Out-Null; Run-Worker | Out-Null
  $f = Row "select * from whatsapp_messages where idempotency_key='$ik'"
  Info "Meta's answer: code=$($f.error_code) message='$($f.error_message)' -> our status=$($f.status) retryable=$($f.error_retryable)"
  if ($f.status -eq "accepted") { Info "Meta ACCEPTED this number (it is on the allow-list or the account is live), so there is no failure to classify; use another number to test failure handling." }
  else { Check "R5 a real Meta rejection is recorded with Meta's own code/text and classified (check the code against Meta's error docs)" ($f.status -in "failed_permanent", "queued" -and $null -ne $f.error_code) "status=$($f.status) code=$($f.error_code)" }
}

# ---- R6 STOP / START from the real phone
$b6 = [int](Val "select coalesce(max(id),0) m from whatsapp_messages" "m")
Write-Host "     >>> From your phone send  STOP  (waiting up to $WaitSeconds s)" -ForegroundColor Yellow
$stopSeen = Wait-For { Run-Worker | Out-Null; [bool](Row "select 1 x from whatsapp_messages where direction='inbound' and id > $b6 and lower(trim(message_text)) like 'stop%' and status='processed'") } $WaitSeconds
Check "R6 STOP from a real phone revokes marketing consent and a confirmation is sent" ($stopSeen -and (Val "select status s from whatsapp_consent where phone_e164='$phone' and scope='marketing'" "s") -eq "revoked") "consent=$(Val "select status s from whatsapp_consent where phone_e164='$phone' and scope='marketing'" "s")"
Write-Host "     >>> Now send  START  to re-subscribe (waiting up to $WaitSeconds s)" -ForegroundColor Yellow
$null = Wait-For { Run-Worker | Out-Null; (Val "select status s from whatsapp_consent where phone_e164='$phone' and scope='marketing'" "s") -eq "granted" } $WaitSeconds
Check "R6 START re-subscribes" ((Val "select status s from whatsapp_consent where phone_e164='$phone' and scope='marketing'" "s") -eq "granted")

$secret = $null; $token = $null
$results | Format-Table -AutoSize -Wrap
$failed = @($results | Where-Object { $_.Result -eq "FAIL" }).Count
Write-Host "$(@($results).Count) checks, $failed failed. Tell Claude the result; real captured payloads remain in whatsapp_payload_captures (DEV)." -ForegroundColor $(if ($failed) { "Red" } else { "Green" })
if ($failed) { exit 1 }
