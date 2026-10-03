# Switch the DEV project between the Razorpay MOCK and your real Razorpay TEST account.
#   ./dev-razorpay-mode.ps1 -Ref lffnmycocbtpyvntccbg -Mode real     (asks for your TEST keys, hidden input)
#   ./dev-razorpay-mode.ps1 -Ref lffnmycocbtpyvntccbg -Mode mock     (back to the mock; all mock-based tests work again)
# Hard rules: DEV only, and a key id that does not start with rzp_test_ is REFUSED (no live keys, ever).
# Values you type are passed straight to `supabase secrets set` and never printed or stored.
param([Parameter(Mandatory = $true)][string]$Ref, [Parameter(Mandatory = $true)][ValidateSet("real", "mock")][string]$Mode)
$ErrorActionPreference = "Stop"
if ($Ref -eq "vkcwfwgxelmamuydwrow") { throw "DEV only: refusing to touch PRODUCTION." }
$token = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", "User"); $env:SUPABASE_ACCESS_TOKEN = $token
$cli = "$env:APPDATA\npm\supabase.cmd"
function Plain($sec) { [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBGSTR($sec)) }
$ErrorActionPreference = "Continue"
if ($Mode -eq "real") {
  $keyId = Read-Host "Razorpay TEST key id (starts with rzp_test_)"
  if ($keyId -notmatch '^rzp_test_[A-Za-z0-9]+$') { throw "Refused: that is not a rzp_test_ key id. Live keys are never used in DEV." }
  $keySecret = Plain (Read-Host "Razorpay TEST key secret" -AsSecureString)
  $whSecret = Plain (Read-Host "Razorpay TEST webhook secret (the one you typed when creating the DEV webhook)" -AsSecureString)
  $o = & $cli secrets set "RAZORPAY_KEY_ID=$keyId" "RAZORPAY_KEY_SECRET=$keySecret" "RAZORPAY_WEBHOOK_SECRET=$whSecret" "RAZORPAY_API_BASE=https://api.razorpay.com" --project-ref $Ref 2>&1 | Out-String
  $keySecret = $null; $whSecret = $null
  if ($LASTEXITCODE -ne 0) { throw "secrets set failed (output suppressed)" }
  "DEV now uses your Razorpay TEST account ($keyId). Remember to switch back with -Mode mock when done."
} else {
  $tok = $token; $h = @{ Authorization = "Bearer $tok"; "User-Agent" = "Mozilla/5.0"; "Content-Type" = "application/json" }
  function Vault([string]$n) { (Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" -Headers $h -Body (@{ query = "select decrypted_secret s from vault.decrypted_secrets where name='$n'" } | ConvertTo-Json))[0].s }
  $ks = Vault "dev_test_razorpay_key_secret"; $ws = Vault "dev_test_razorpay_webhook_secret"
  $o = & $cli secrets set "RAZORPAY_KEY_ID=rzp_test_devmock" "RAZORPAY_KEY_SECRET=$ks" "RAZORPAY_WEBHOOK_SECRET=$ws" "RAZORPAY_API_BASE=https://$Ref.supabase.co/functions/v1/razorpay-mock" --project-ref $Ref 2>&1 | Out-String
  $ks = $null; $ws = $null
  if ($LASTEXITCODE -ne 0) { throw "secrets set failed (output suppressed)" }
  "DEV is back on the Razorpay MOCK."
}
