# Tech AI monkey — opprett lokal PostgreSQL-rolle, database og tabeller (Windows)
#
# Krever at PostgreSQL er installert og at `psql` er tilgjengelig (EDB-installasjon
# legger den under "C:\Program Files\PostgreSQL\<versjon>\bin"). Skriptet:
#   1. oppretter/oppdaterer rollen og databasen
#   2. skriver DATABASE_URL inn i web/.env.local
#   3. oppretter tabellene med drizzle-kit push
#
# Bruk:  powershell -ExecutionPolicy Bypass -File deploy\setup-db.ps1
#        $env:PGPASSWORD="ditt-passord"; powershell -File deploy\setup-db.ps1
param(
    [string]$DbName        = "tech_ai_monkey",
    [string]$DbUser        = "tech_ai_monkey",
    [string]$DbHost        = "127.0.0.1",
    [int]   $DbPort        = 5432,
    [string]$PostgresUser  = "postgres"
)

$ErrorActionPreference = "Stop"
$Repo    = Split-Path -Parent $PSScriptRoot
$WebDir  = Join-Path $Repo "web"
$EnvFile = Join-Path $WebDir ".env.local"

# --- Auto-detekter PostgreSQL-porten hvis brukeren ikke oppga -DbPort -----------
if (-not $PSBoundParameters.ContainsKey('DbPort')) {
    $confDirs = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue
    foreach ($d in $confDirs) {
        $conf = Join-Path $d.FullName "data\postgresql.conf"
        if (Test-Path $conf) {
            $line = Select-String -Path $conf -Pattern '^\s*port\s*=\s*(\d+)' | Select-Object -First 1
            if ($line -and $line.Matches[0].Groups[1].Value) {
                $DbPort = [int]$line.Matches[0].Groups[1].Value
                break
            }
        }
    }
}
Write-Host "PostgreSQL-port: $DbPort" -ForegroundColor Cyan

# --- Finn psql -----------------------------------------------------------------
$psqlPath = $null
$cmd = Get-Command psql.exe -ErrorAction SilentlyContinue
if ($cmd) { $psqlPath = $cmd.Source } else {
    $found = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName "bin\psql.exe" } |
        Where-Object { Test-Path $_ } |
        Sort-Object -Descending |
        Select-Object -First 1
    if ($found) { $psqlPath = $found }
}
if (-not $psqlPath) { throw "Fant ikke psql.exe. Installer PostgreSQL for Windows først." }
Write-Host "psql: $psqlPath" -ForegroundColor Green

# --- Passord for postgres-superbrukeren ---------------------------------------
if (-not $env:PGPASSWORD) {
    $sec = Read-Host "Passord for postgres-superbrukeren" -AsSecureString
    $env:PGPASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringUni(
        [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}

# Generer et tilfeldig passord for app-rollen.
$DbPass = -join ((48..57) + (97..102) | Get-Random -Count 48 | ForEach-Object { [char]$_ })

function Invoke-Psql([string]$Sql, [string]$Database = "postgres") {
    $out = & $psqlPath -h $DbHost -p $DbPort -U $PostgresUser -d $Database -v ON_ERROR_STOP=1 -tAc $Sql 2>&1
    if ($LASTEXITCODE -ne 0) { throw "psql feilet: $out" }
    return ($out -join "`n")
}

# --- Rolle ---------------------------------------------------------------------
Write-Host "-> Oppretter/oppdaterer rollen '$DbUser'..." -ForegroundColor Cyan
$role = Invoke-Psql "SELECT 1 FROM pg_roles WHERE rolname='$DbUser'"
if ($role -match '1') {
    Invoke-Psql "ALTER ROLE $DbUser WITH LOGIN PASSWORD '$DbPass'" | Out-Null
} else {
    Invoke-Psql "CREATE ROLE $DbUser LOGIN PASSWORD '$DbPass'" | Out-Null
}

# --- Database ------------------------------------------------------------------
Write-Host "-> Oppretter databasen '$DbName' (hvis den ikke finnes)..." -ForegroundColor Cyan
$dbExists = Invoke-Psql "SELECT 1 FROM pg_database WHERE datname='$DbName'"
if (-not ($dbExists -match '1')) {
    Invoke-Psql "CREATE DATABASE $DbName OWNER $DbUser" | Out-Null
}

$NewUrl = "postgresql://${DbUser}:${DbPass}@${DbHost}:${DbPort}/${DbName}"

# --- Skriv DATABASE_URL til web/.env.local -------------------------------------
$content = ""
if (Test-Path $EnvFile) { $content = Get-Content -LiteralPath $EnvFile -Raw }
if ($content -match '(?m)^DATABASE_URL=.*$') {
    $content = $content -replace '(?m)^DATABASE_URL=.*$', "DATABASE_URL=$NewUrl"
} else {
    if ($content -and -not $content.EndsWith("`n")) { $content += "`n" }
    $content += "DATABASE_URL=$NewUrl`n"
}
Set-Content -LiteralPath $EnvFile -Value $content -Encoding UTF8 -NoNewline
Write-Host "-> Skrev DATABASE_URL til $EnvFile" -ForegroundColor Green

# --- Tabeller via drizzle-kit --------------------------------------------------
Write-Host "-> Oppretter tabellene med drizzle-kit push..." -ForegroundColor Cyan
Push-Location $WebDir
try {
    $env:DATABASE_URL = $NewUrl
    & npm.cmd exec drizzle-kit push
    if ($LASTEXITCODE -ne 0) { throw "drizzle-kit push feilet" }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "✓ Ferdig. Database: $DbName, rolle: $DbUser, port: $DbPort" -ForegroundColor Green
