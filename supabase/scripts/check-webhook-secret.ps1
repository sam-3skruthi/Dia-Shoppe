# Does the webhook secret you typed match the one stored in the DEV function? Prints MATCH / NO MATCH only.
# The Supabase secrets API returns the SHA-256 of each secret; we hash what you type and compare. Nothing is printed or stored.
param([Parameter(Mandatory = $true)][string]$Ref)
$ErrorActionPreference = "Stop"
if ($Ref -eq "vkcwfwgxelmamuydwrow") { throw "DEV only." }
$pat = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", "User")
$sec = Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$Ref/secrets" -Headers @{ Authorization = "Bearer $pat"; "User-Agent" = "Mozilla/5.0" }
$stored = ($sec | Where-Object name -eq "RAZORPAY_WEBHOOK_SECRET").value
if (-not $stored) { throw "RAZORPAY_WEBHOOK_SECRET is not set on $Ref." }
$ss = Read-Host "Webhook secret to test (the one in the Razorpay dashboard webhook)" -AsSecureString
$typed = (New-Object System.Management.Automation.PSCredential('x', $ss)).GetNetworkCredential().Password
foreach ($cand in @(@{ n = "exactly as typed"; v = $typed }, @{ n = "after trimming spaces/newlines"; v = $typed.Trim() })) {
  $h = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($cand.v))).Replace("-", "").ToLower()
  "{0,-34} {1}" -f $cand.n, $(if ($h -eq $stored) { "MATCH" } else { "NO MATCH" })
}
"typed length: $($typed.Length) (leading/trailing space present: $($typed -ne $typed.Trim()))"
