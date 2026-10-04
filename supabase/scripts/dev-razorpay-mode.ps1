# Switch the DEV project between the Razorpay MOCK and your real Razorpay TEST account.
#   ./dev-razorpay-mode.ps1 -Ref lffnmycocbtpyvntccbg -Mode check    (safe: proves the Supabase CLI works against DEV; changes nothing)
#   ./dev-razorpay-mode.ps1 -Ref lffnmycocbtpyvntccbg -Mode real     (asks for your TEST keys, hidden input)
#   ./dev-razorpay-mode.ps1 -Ref lffnmycocbtpyvntccbg -Mode mock     (back to the mock; all mock-based tests work again)
# Hard rules: DEV only, and a key id that does not start with rzp_test_ is REFUSED (no live keys, ever).
# Values you type are passed straight to `supabase secrets set` and never printed or stored.
# The Supabase CLI is resolved automatically: a `supabase` already on PATH if there is one, otherwise
# `npx supabase` (nothing to install globally). Use -ForceNpx to test the npx route even when a global one exists.
param(
  [Parameter(Mandatory = $true)][string]$Ref,
  [Parameter(Mandatory = $true)][ValidateSet("check", "real", "mock")][string]$Mode,
  [switch]$ForceNpx
)
$ErrorActionPreference = "Stop"
if ($Ref -eq "vkcwfwgxelmamuydwrow") { throw "DEV only: refusing to touch PRODUCTION." }
$token = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", "User"); $env:SUPABASE_ACCESS_TOKEN = $token
if (-not $token) { throw "SUPABASE_ACCESS_TOKEN is not set (user environment variable)." }

# --- runtime compatibility check (Windows PowerShell 5.1+ / PowerShell 7): fail early, before any prompt ---
function Get-PlainText([System.Security.SecureString]$s) { (New-Object System.Management.Automation.PSCredential('x', $s)).GetNetworkCredential().Password }
if ($PSVersionTable.PSVersion.Major -lt 5) { throw "PowerShell 5.1 or newer is required (found $($PSVersionTable.PSVersion))." }
if ((Get-PlainText (ConvertTo-SecureString 'compat-probe' -AsPlainText -Force)) -ne 'compat-probe') { throw "SecureString conversion is not working in this PowerShell." }
function Plain($sec) { Get-PlainText $sec }

# --- Supabase CLI resolution: no hard-coded paths, no global install required ---
$global:SbExe = $null; $global:SbPrefix = @()
# prefer a real executable (.exe/.cmd); a .ps1 shim mis-handles argument arrays when called through a function
$onPath = if ($ForceNpx) { $null } else { Get-Command supabase -CommandType Application -ErrorAction SilentlyContinue | Where-Object { $_.Source -match '\.(exe|cmd)$' } | Select-Object -First 1 }
if ($onPath) { $global:SbExe = $onPath.Source; $global:SbRoute = "global supabase on PATH" }
else {
  $npx = Get-Command npx -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $npx) { throw "Neither 'supabase' nor 'npx' was found. Install Node.js (it provides npx); no global Supabase CLI is needed." }
  $global:SbExe = $npx.Source; $global:SbPrefix = @("--yes", "supabase"); $global:SbRoute = "npx supabase"
}
function Invoke-Sb {   # returns @{ Code; Out }  -- Out is for internal checks only and is never printed
  param([string[]]$SbArgs)
  $prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  try { $o = & $global:SbExe @($global:SbPrefix + $SbArgs) 2>&1 | Out-String; $c = $LASTEXITCODE } finally { $ErrorActionPreference = $prev }
  [pscustomobject]@{ Code = $c; Out = $o }
}
function Fail-Safe($what, $r) {   # report only a permission name / status, never raw output (it may echo arguments)
  $why = "see exit code $($r.Code)"
  if ($r.Out -match 'Missing required permission\(s\):\s*([a-z_,\s"\[\]]+)') { $why = "missing permission: " + ($Matches[1] -replace '[^a-z_,]', '') }
  elseif ($r.Out -match 'status (\d{3})') { $why = "HTTP status $($Matches[1])" }
  throw "$what FAILED ($why). Output suppressed to protect secrets."
}

if ($Mode -eq "check") {
  $v = Invoke-Sb @("--version"); if ($v.Code -ne 0) { Fail-Safe "supabase --version" $v }
  "Supabase CLI route : $global:SbRoute"
  "Supabase CLI version: $($v.Out.Trim())"
  $l = Invoke-Sb @("secrets", "list", "--project-ref", $Ref, "-o", "json")
  if ($l.Code -ne 0) { Fail-Safe "secrets list on $Ref" $l }
  $names = @(($l.Out | ConvertFrom-Json) | ForEach-Object { $_.name })   # NAMES only; values/digests are never read or shown
  "DEV project $Ref reachable via the CLI. Secret names present: $($names.Count)"
  "Razorpay-related names: " + ((@("RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "RAZORPAY_API_BASE") | ForEach-Object { "$_=" + $(if ($names -contains $_) { "set" } else { "MISSING" }) }) -join ", ")
  return
}

if ($Mode -eq "real") {
  $keyId = (Read-Host "Razorpay TEST key id (starts with rzp_test_)").Trim()
  if ($keyId -notmatch '^rzp_test_[A-Za-z0-9]+$') { throw "Refused: that is not a rzp_test_ key id. Live keys are never used in DEV." }
  $keySecret = (Plain (Read-Host "Razorpay TEST key secret" -AsSecureString)).Trim()
  $whSecret = (Plain (Read-Host "Razorpay TEST webhook secret (the one you typed when creating the DEV webhook)" -AsSecureString)).Trim()
  if ($whSecret -notmatch '^[A-Za-z0-9_-]{12,}$') { $keySecret = $null; $whSecret = $null; throw "Webhook secret must be 12+ letters/digits/_/- only: symbols such as & | ^ % are altered by the Windows command shim and would silently store a DIFFERENT secret." }
  $r = Invoke-Sb @("secrets", "set", "RAZORPAY_KEY_ID=$keyId", "RAZORPAY_KEY_SECRET=$keySecret", "RAZORPAY_WEBHOOK_SECRET=$whSecret", "RAZORPAY_API_BASE=https://api.razorpay.com", "--project-ref", $Ref)
  $keySecret = $null; $whSecret = $null
  if ($r.Code -ne 0) { Fail-Safe "secrets set" $r }
  "DEV now uses your Razorpay TEST account ($keyId). Remember to switch back with -Mode mock when done."
} else {
  $h = @{ Authorization = "Bearer $token"; "User-Agent" = "Mozilla/5.0"; "Content-Type" = "application/json" }
  function Vault([string]$n) { (Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" -Headers $h -Body (@{ query = "select decrypted_secret s from vault.decrypted_secrets where name='$n'" } | ConvertTo-Json))[0].s }
  $ks = Vault "dev_test_razorpay_key_secret"; $ws = Vault "dev_test_razorpay_webhook_secret"
  $r = Invoke-Sb @("secrets", "set", "RAZORPAY_KEY_ID=rzp_test_devmock", "RAZORPAY_KEY_SECRET=$ks", "RAZORPAY_WEBHOOK_SECRET=$ws", "RAZORPAY_API_BASE=https://$Ref.supabase.co/functions/v1/razorpay-mock", "--project-ref", $Ref)
  $ks = $null; $ws = $null
  if ($r.Code -ne 0) { Fail-Safe "secrets set" $r }
  "DEV is back on the Razorpay MOCK."
}
