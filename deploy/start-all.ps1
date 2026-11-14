# Tech AI monkey — start alt lokalt (Windows): Ollama -> agent -> web
# Bruk:  powershell -ExecutionPolicy Bypass -File deploy\start-all.ps1
$ErrorActionPreference = "Continue"
$Repo = Split-Path -Parent $PSScriptRoot

# Sjekk at appene er bygget først
if (-not ((Test-Path (Join-Path $Repo ".output\server\index.mjs")) -and (Test-Path (Join-Path $Repo "web\.next\BUILD_ID")))) {
    Write-Host "Appene er ikke bygget ennå. Kjør først:" -ForegroundColor Yellow
    Write-Host "  powershell -ExecutionPolicy Bypass -File deploy\build.ps1" -ForegroundColor Cyan
    exit 1
}

Write-Host "== Tech AI monkey — starter lokalt ==" -ForegroundColor Cyan

# 1. Ollama (port 11434)
$ollama = Get-Command ollama.exe -ErrorAction SilentlyContinue
if (-not $ollama) {
    $local = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
    if (Test-Path $local) { $ollama = Get-Item $local }
}
if ($ollama) {
    $ollamaPath = $ollama.Source
    $alive = $false
    try { Invoke-RestMethod "http://127.0.0.1:11434/api/tags" -TimeoutSec 3 | Out-Null; $alive = $true } catch {}
    if (-not $alive) {
        Write-Host "-> Starter Ollama..." -ForegroundColor Yellow
        Start-Process -FilePath $ollamaPath -ArgumentList "serve" -WindowStyle Hidden
        Start-Sleep -Seconds 3
    } else {
        Write-Host "-> Ollama kjører allerede" -ForegroundColor Green
    }
} else {
    Write-Warning "Ollama ikke funnet. Installer fra https://ollama.com/download/windows"
}

# 2. Agenten (port 2000)
Write-Host "-> Starter agenten (port 2000)..." -ForegroundColor Yellow
$env:PORT = "2000"
Start-Process -FilePath "cmd.exe" -ArgumentList "/c","npm.cmd run start" -WorkingDirectory $Repo

# 3. Web-appen (port 3100)
Write-Host "-> Starter web-appen (port 3100)..." -ForegroundColor Yellow
$env:PORT = "3100"
Start-Process -FilePath "cmd.exe" -ArgumentList "/c","npm.cmd run start" -WorkingDirectory (Join-Path $Repo "web")

Write-Host ""
Write-Host "Agent:  http://127.0.0.1:2000" -ForegroundColor Cyan
Write-Host "Web:    http://127.0.0.1:3100" -ForegroundColor Cyan
Write-Host "Stopp:  powershell -ExecutionPolicy Bypass -File deploy\stop-all.ps1" -ForegroundColor DarkGray
