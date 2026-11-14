# Tech AI monkey — stopp agenten og web-appen (Windows)
# Bruk:  powershell -ExecutionPolicy Bypass -File deploy\stop-all.ps1
$ErrorActionPreference = "Continue"

Write-Host "Stopper Tech AI monkey-prosessene..." -ForegroundColor Yellow

$killed = $false
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'eve start|next start|next-server|npm run start' } |
    ForEach-Object {
        Write-Host ("Stopper PID {0} ({1})" -f $_.ProcessId, $_.Name)
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        $killed = $true
    }

if (-not $killed) {
    Write-Host "Fant ingen kjørende Tech AI monkey-prosesser." -ForegroundColor DarkGray
} else {
    Write-Host "Ferdig." -ForegroundColor Green
}
