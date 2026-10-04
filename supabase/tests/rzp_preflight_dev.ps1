# Razorpay TEST credential preflight. Makes ONE harmless authenticated GET and reports only:
#   HTTP status, Razorpay's error code/description, which environment the key belongs to, and yes/no comparisons.
# It never prints, logs or stores a key secret, webhook secret, Authorization header or Supabase token.
# It creates no payment, no order, no refund; it touches no database and no production.
#   .\supabase\tests\rzp_preflight_dev.ps1 -Ref lffnmycocbtpyvntccbg
# Typed values are compared to what DEV has stored using SHA-256 digests only (Supabase exposes digests, never values).
param([Parameter(Mandatory = $true)][string]$Ref, [switch]$SelfTest)
$ErrorActionPreference = "Stop"
if ($Ref -eq "vkcwfwgxelmamuydwrow") { throw "DEV only." }
function Get-PlainText([System.Security.SecureString]$s) { (New-Object System.Management.Automation.PSCredential('x', $s)).GetNetworkCredential().Password }
function Sha256Hex([string]$s) { ([BitConverter]::ToString((New-Object Security.Cryptography.SHA256Managed).ComputeHash([Text.Encoding]::UTF8.GetBytes($s))) -replace "-", "").ToLower() }

function Probe([string]$keyId, [string]$keySecret) {      # returns Status / Code / Description only
  $auth = "Basic " + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${keyId}:$keySecret"))
  try {
    $r = Invoke-WebRequest -Uri "https://api.razorpay.com/v1/payments?count=1" -Headers @{ Authorization = $auth } -UseBasicParsing
    [pscustomobject]@{ Status = [int]$r.StatusCode; Code = ""; Description = "" }
  } catch {
    $st = 0; if ($_.Exception.Response) { $st = [int]$_.Exception.Response.StatusCode }
    $code = ""; $desc = ""
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) { try { $j = $_.ErrorDetails.Message | ConvertFrom-Json; $code = [string]$j.error.code; $desc = [string]$j.error.description } catch { $desc = "(non-JSON error body)" } }
    if (-not $desc) { $desc = "no response body ($($_.Exception.GetType().Name))" }
    [pscustomobject]@{ Status = $st; Code = $code; Description = $desc }
  }
}
function Report($keyId, $keySecret, $stored) {
  $idTrim = $keyId.Trim(); $secTrim = $keySecret.Trim()
  if ($idTrim.Length -ne $keyId.Length) { "note: key id had $($keyId.Length - $idTrim.Length) stray whitespace character(s); trimmed." }
  if ($secTrim.Length -ne $keySecret.Length) { "note: key secret had $($keySecret.Length - $secTrim.Length) stray whitespace character(s) (paste artefact); trimmed for this test. The old runner did NOT trim, which alone causes HTTP 401." }
  "key id starts with rzp_test_ : " + ($idTrim -match '^rzp_test_[A-Za-z0-9]+$')
  "key id length / secret length (characters only): $($idTrim.Length) / $($secTrim.Length)   (Razorpay secrets are normally 24 characters)"
  "environment the key belongs to: " + $(if ($idTrim -match '^rzp_test_') { "TEST (Razorpay picks test mode from the key; there is one API host, https://api.razorpay.com)" } elseif ($idTrim -match '^rzp_live_') { "LIVE - REFUSED, not probing" } else { "unrecognised - not probing" })
  if ($idTrim -notmatch '^rzp_test_[A-Za-z0-9]+$') { return }
  $p = Probe $idTrim $secTrim
  "GET /v1/payments?count=1  ->  HTTP $($p.Status)" + $(if ($p.Code) { "   code=$($p.Code)" }) + $(if ($p.Description) { "   description=$($p.Description)" })
  if ($stored) {
    "typed key id    == key id stored in DEV : " + ($stored.ContainsKey("RAZORPAY_KEY_ID") -and $stored["RAZORPAY_KEY_ID"] -eq (Sha256Hex $idTrim))
    "typed secret    == key secret stored in DEV : " + ($stored.ContainsKey("RAZORPAY_KEY_SECRET") -and $stored["RAZORPAY_KEY_SECRET"] -eq (Sha256Hex $secTrim))
  }
  if ($p.Status -eq 200) { "RESULT: credential pair is VALID for the Razorpay TEST API." }
  elseif ($p.Status -eq 401) { "RESULT: Razorpay REJECTED this key id + secret pair (authentication failed). Generate a fresh matching pair in Dashboard -> Test Mode -> Account & Settings -> API Keys." }
  else { "RESULT: unexpected HTTP $($p.Status); see description above." }
}

if ($SelfTest) {      # offline logic + ONE deliberately fake pair to see the real 401 reporting path (harmless)
  "== self-test with a deliberately FAKE test-mode pair =="
  Report "rzp_test_FAKEFAKEFAKE00" ("x" * 24 + " ") @{ RAZORPAY_KEY_ID = (Sha256Hex "rzp_test_FAKEFAKEFAKE00"); RAZORPAY_KEY_SECRET = (Sha256Hex ("x" * 24)) }
  "== a live-looking id must be refused before any request =="
  Report "rzp_live_FAKEFAKEFAKE00" "yyyyyyyyyyyyyyyyyyyyyyyy" $null
  return
}

$tok = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", "User")
$stored = @{}
try { foreach ($s in (Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$Ref/secrets" -Headers @{ Authorization = "Bearer $tok"; "User-Agent" = "Mozilla/5.0" })) { $stored[$s.name] = ([string]$s.value).ToLower() } } catch { $stored = $null; "(could not read DEV secret digests: HTTP $([int]$_.Exception.Response.StatusCode); comparison skipped)" }
$keyId = Read-Host "Razorpay TEST key id"
$sec = Read-Host "Razorpay TEST key secret" -AsSecureString
$keySecret = Get-PlainText $sec; $sec = $null
Report $keyId $keySecret $stored
$keySecret = $null
