<#
    start-studio.ps1 — launcher for the Roleplay Studio frontend.

    Ensures Ollama is running, starts the Vite dev server, and opens the browser.
    Run via start-studio.bat (double-click) or:
        powershell -ExecutionPolicy Bypass -File D:\LocalLLM\start-studio.ps1
#>

$ErrorActionPreference = 'SilentlyContinue'
$frontend = Join-Path $PSScriptRoot 'frontend'
$port = 5173
$url = "http://localhost:$port"

# Make sure npm / ollama resolve even on a fresh shell.
$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path', 'User')

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js / npm not found on PATH. Install Node 18+ and retry.' -ForegroundColor Red
  Read-Host 'Press Enter to exit'
  exit 1
}

# First run: install dependencies.
if (-not (Test-Path (Join-Path $frontend 'node_modules'))) {
  Write-Host 'First run — installing dependencies (~1 minute)...' -ForegroundColor Cyan
  Push-Location $frontend
  npm install
  Pop-Location
}

# Make sure Ollama is up (the app needs it to generate).
function Test-Ollama {
  try { Invoke-RestMethod 'http://localhost:11434/api/tags' -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}
if (-not (Test-Ollama)) {
  Write-Host 'Starting Ollama...' -ForegroundColor Cyan
  $app = "$env:LOCALAPPDATA\Programs\Ollama\ollama app.exe"
  if (Test-Path $app) { Start-Process -FilePath $app } else { Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden }
}

# Open the browser once the dev server answers (in a detached hidden shell).
Start-Process powershell -WindowStyle Hidden -ArgumentList @(
  '-NoProfile', '-Command',
  "for(`$i=0;`$i -lt 40;`$i++){ try{ Invoke-WebRequest '$url' -UseBasicParsing -TimeoutSec 1 | Out-Null; break }catch{ Start-Sleep -Milliseconds 700 } }; Start-Process '$url'"
)

Write-Host ''
Write-Host "  Roleplay Studio  ->  $url" -ForegroundColor Green
Write-Host '  (Close this window to stop the server.)' -ForegroundColor DarkGray
Write-Host ''

Set-Location $frontend
npm run dev
