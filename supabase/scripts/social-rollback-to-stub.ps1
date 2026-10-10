# ROLLBACK for the social-inbox containment that does NOT re-open the unsigned endpoint.
# Deploys the two fixed 503 stubs from supabase/rollback/social-disabled/ in place of social-webhook and social-reply.
# Use it only if the containment release misbehaves (boot error, unexpected 5xx). Rolling back to git 29669e4 is NOT a supported path:
# that code accepts unsigned POSTs and writes them to social_messages.
#   ./supabase/scripts/social-rollback-to-stub.ps1 -Ref <project-ref>
# Builds a throwaway project folder in %TEMP% (config.toml + the two stubs), deploys ONLY those two functions from it, then removes it.
# The working tree is not modified. Needs SUPABASE_ACCESS_TOKEN with deploy rights on the target project. Asks you to type the ref to confirm.
param([Parameter(Mandatory = $true)][string]$Ref)
$ErrorActionPreference = "Stop"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$src = Join-Path $root "supabase\rollback\social-disabled"
foreach ($f in "social-webhook", "social-reply") { if (-not (Test-Path (Join-Path $src "$f\index.ts"))) { throw "stub missing: $f" } }
Write-Host "Target project: $Ref. This replaces social-webhook and social-reply with 503 stubs. Nothing else is deployed." -ForegroundColor Yellow
if ((Read-Host "Type the project ref to confirm") -ne $Ref) { throw "Not confirmed; nothing deployed." }

$work = Join-Path $env:TEMP ("dia-social-stub-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory (Join-Path $work "supabase\functions") | Out-Null
Copy-Item (Join-Path $root "supabase\config.toml") (Join-Path $work "supabase\config.toml")
foreach ($f in "social-webhook", "social-reply") { Copy-Item (Join-Path $src $f) (Join-Path $work "supabase\functions\$f") -Recurse }
try {
  $o = & npx --yes supabase functions deploy social-webhook social-reply --project-ref $Ref --use-api --no-verify-jwt --workdir $work 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw ("deploy FAILED: " + (($o -replace '(sbp_|eyJ)[A-Za-z0-9._-]+', '<redacted>') -replace '\s+', ' ')) }
  "deployed: social-webhook, social-reply (503 stubs)"
} finally {
  Remove-Item $work -Recurse -Force
}
"verify now:  ./supabase/scripts/smoke-test.ps1 -Ref $Ref -Only social   (expect 3 / 3 PASS)"
