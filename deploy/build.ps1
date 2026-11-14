# Tech AI monkey — installer avhengigheter og bygg begge appene (Windows)
# Bruk:  powershell -ExecutionPolicy Bypass -File deploy\build.ps1
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot

function Invoke-Npm([string]$Dir, [string[]]$NpmArgs) {
    Write-Host ("[npm {0}] {1}" -f $Dir, ($NpmArgs -join ' ')) -ForegroundColor Cyan
    Push-Location $Dir
    try {
        & npm.cmd @NpmArgs
        if ($LASTEXITCODE -ne 0) { throw "npm mislyktes i $Dir" }
    } finally {
        Pop-Location
    }
}

$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 24) {
    throw "Node $nodeMajor funnet — repoet krever Node 24 eller nyere. Installer Node 24 først."
}
Write-Host "Node $nodeMajor OK" -ForegroundColor Green

# --- Lag .env og web/.env.local hvis de mangler (ellers stopper web-bygget på DATABASE_URL) ---
$agentSecret = -join ((48..57)+(97..102) | Get-Random -Count 64 | ForEach-Object { [char]$_ })
$authSecret  = -join ((48..57)+(97..102) | Get-Random -Count 64 | ForEach-Object { [char]$_ })
$kek         = -join ((48..57)+(97..102) | Get-Random -Count 64 | ForEach-Object { [char]$_ })

$rootEnv = Join-Path $Repo ".env"
if (-not (Test-Path $rootEnv)) {
    Write-Warning "Lager .env (AGENT_API_KEY_SECRET er generert lokalt)."
    @"
AGENT_API_KEY_SECRET=$agentSecret
EVE_PUBLIC_URL=http://127.0.0.1:2000
OLLAMA_MODEL=tech-ai-monkey
OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
OLLAMA_API_KEY=auto-rotate
OLLAMA_CONTEXT_TOKENS=4096
OLLAMA_KEY_ROTATION_MS=600000
EVE_DEV=1
EVE_PERSIST_SANDBOX=1
"@ | Set-Content -LiteralPath $rootEnv -Encoding UTF8
}

$webEnv = Join-Path $Repo "web\.env.local"
if (-not (Test-Path $webEnv)) {
    Write-Warning "Lager web/.env.local med placeholder DATABASE_URL (kjør deploy\setup-db.ps1 for ekte DB)."
    @"
AUTH_SECRET=$authSecret
SECRET_KEK=$kek
AGENT_API_KEY_SECRET=$agentSecret
EVE_AGENT_URL=http://127.0.0.1:2000
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100
AUTH_URL=http://127.0.0.1:3100
DATABASE_URL=postgresql://tech_ai_monkey:placeholder@127.0.0.1:5432/tech_ai_monkey
"@ | Set-Content -LiteralPath $webEnv -Encoding UTF8
}

# Agenten (rot) bygges først — `npm run build` patcher eve (postbuild).
Invoke-Npm $Repo @("install")
Invoke-Npm $Repo @("run", "build")

# Web-appen. Bruk webpack på Windows — Turbopack krasjer i PostCSS-steget her.
Invoke-Npm (Join-Path $Repo "web") @("install")
Invoke-Npm (Join-Path $Repo "web") @("run", "build", "--", "--webpack")

Write-Host ""
Write-Host "Bygget ferdig. Start med:  powershell -ExecutionPolicy Bypass -File deploy\start-all.ps1" -ForegroundColor Green
