# Runs every supabase/tests/*.sql against the project via the Management API.
# Each test is a DO block that ALWAYS ends with RAISE EXCEPTION, so the whole
# transaction rolls back and production data is never changed.
#   PASS marker : exception text starts with ALL_PASS
#   Anything else is a failure.
# Needs SUPABASE_ACCESS_TOKEN (user env var). Usage: ./run-sql-tests.ps1 [-Ref <project-ref>] [-Filter p0_*]
param([string]$Ref = "vkcwfwgxelmamuydwrow", [string]$Filter = "*.sql")
$t = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN","User"); if (-not $t) { $t = $env:SUPABASE_ACCESS_TOKEN }
$h = @{ Authorization = "Bearer $t"; "User-Agent" = "Mozilla/5.0"; "Content-Type" = "application/json" }
$ErrorActionPreference = "Stop"
$fail = 0
foreach ($f in Get-ChildItem $PSScriptRoot -Filter $Filter | Sort-Object Name) {
  $sql = [regex]::Replace((Get-Content $f.FullName -Raw), '[^\x00-\x7F]', '-')
  $body = [Text.Encoding]::UTF8.GetBytes((@{ query = $sql } | ConvertTo-Json))
  $msg = ""
  try { Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" -Headers $h -Body $body | Out-Null; $msg = "NO_EXCEPTION (test did not roll back!)" }
  catch { $msg = "$($_.ErrorDetails.Message)" }
  if ($msg -match 'ALL_PASS[^"]*?(?=\\n|"|$)') { "PASS  $($f.Name)  $($Matches[0])" } else { $fail++; "FAIL  $($f.Name)  $msg" }
}
if ($fail) { "$fail test file(s) failed"; exit 1 } else { "all test files passed" }
