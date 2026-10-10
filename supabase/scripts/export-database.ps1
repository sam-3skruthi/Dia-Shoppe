# READ-ONLY logical export of a Supabase project's public data + the definitions a rollout will replace. Only SELECTs through the Management
# API; writes files into -OutDir and changes nothing in the database. Run it against PRODUCTION immediately before a rollout (with a credential
# that can only read), keep the folder off this machine, and verify one table by re-reading it.
#   ./supabase/scripts/export-database.ps1 -Ref <project-ref> -OutDir C:\backups\dia-2026-10-05
# Output: <table>.jsonl (one JSON row per line), definitions\functions.sql, triggers.sql, constraints.sql, policies.json, manifest.json (row counts + SHA-256).
# Limits (be honest about them): this is a DATA SAFETY NET, not a one-command restore. It does not include auth.users, storage objects, Vault secret
# VALUES or Edge Function source. A true restore point is a pg_dump taken with the database password:
#   pg_dump "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" --schema=public --schema=private --format=custom --file=dia-<date>.dump
# and `supabase functions download <slug> --project-ref <ref>` for each function (or keep the git tag of what is deployed).
param([Parameter(Mandatory = $true)][string]$Ref, [Parameter(Mandatory = $true)][string]$OutDir, [int]$PageSize = 2000)
$ErrorActionPreference = "Stop"
$pat = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", "User"); if (-not $pat) { $pat = $env:SUPABASE_ACCESS_TOKEN }
if (-not $pat) { throw "SUPABASE_ACCESS_TOKEN is not set." }
$h = @{ Authorization = "Bearer $pat"; "User-Agent" = "Mozilla/5.0"; "Content-Type" = "application/json" }
function Q([string]$sql) { Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" -Headers $h -Body ([Text.Encoding]::UTF8.GetBytes((@{ query = $sql } | ConvertTo-Json -Depth 3))) }
if (Test-Path $OutDir) { if (@(Get-ChildItem $OutDir).Count) { throw "$OutDir is not empty; choose a new folder (an export is never overwritten)." } } else { New-Item -ItemType Directory $OutDir | Out-Null }
New-Item -ItemType Directory (Join-Path $OutDir "definitions") | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)
$manifest = [ordered]@{ project = $Ref; at = (Get-Date).ToUniversalTime().ToString("o"); tables = [ordered]@{}; files = [ordered]@{} }
$tables = @((Q "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and table_name not like 'zz\_%' order by 1") | ForEach-Object { $_.table_name })
foreach ($t in $tables) {
  $n = [int](Q "select count(*) c from public.""$t""")[0].c; $file = Join-Path $OutDir "$t.jsonl"; $sw = New-Object System.IO.StreamWriter($file, $false, $utf8); $written = 0
  for ($off = 0; $off -lt $n; $off += $PageSize) {
    $page = Q "select to_jsonb(x) j from (select * from public.""$t"" order by ctid limit $PageSize offset $off) x"
    foreach ($r in @($page)) { $sw.WriteLine(($r.j | ConvertTo-Json -Depth 20 -Compress)); $written++ }
  }
  $sw.Close(); $manifest.tables[$t] = @{ rows_in_db = $n; rows_written = $written }
  if ($written -ne $n) { Write-Host "WARN $t : wrote $written of $n rows (rows changed during the export or the page size cut a result)" -ForegroundColor Yellow }
  Write-Host ("{0,-28} {1,8} rows" -f $t, $written)
}
function Dump([string]$name, [string]$sql, [string]$col) { $rows = @((Q $sql) | ForEach-Object { $_.$col }); [IO.File]::WriteAllText((Join-Path $OutDir "definitions\$name"), (($rows -join "`n;`n") + "`n"), $utf8) }
Dump "functions.sql" "select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' order by n.nspname, p.proname" "d"
Dump "triggers.sql" "select pg_get_triggerdef(t.oid) d from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname='public' order by 1" "d"
Dump "constraints.sql" "select 'ALTER TABLE ' || conrelid::regclass || ' ADD CONSTRAINT ' || quote_ident(conname) || ' ' || pg_get_constraintdef(oid) d from pg_constraint where connamespace='public'::regnamespace order by 1" "d"
[IO.File]::WriteAllText((Join-Path $OutDir "definitions\policies.json"), ((Q "select schemaname, tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname='public' order by 1,2,3") | ConvertTo-Json -Depth 5), $utf8)
foreach ($f in Get-ChildItem $OutDir -Recurse -File) { $manifest.files[$f.FullName.Substring($OutDir.Length).TrimStart('\')] = (Get-FileHash $f.FullName -Algorithm SHA256).Hash }
[IO.File]::WriteAllText((Join-Path $OutDir "manifest.json"), ($manifest | ConvertTo-Json -Depth 6), $utf8)
$total = ($manifest.tables.Values | ForEach-Object { $_.rows_written } | Measure-Object -Sum).Sum
Write-Host "Export complete: $($tables.Count) tables, $total rows -> $OutDir (manifest.json has SHA-256 per file). Copy it OFF this machine and re-read one table before relying on it." -ForegroundColor Green
