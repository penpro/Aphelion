<#
    setup.ps1 — reproducible setup for the Local Model sandbox (Phase 0 + 1).

    Idempotent: safe to re-run. Captures every step taken to stand up the
    inference layer so the box can be rebuilt or repaired from scratch.

    Run from anywhere:
        powershell -ExecutionPolicy Bypass -File D:\LocalLLM\setup\setup.ps1
#>

$ErrorActionPreference = 'Stop'
$ModelRepo = 'hf.co/Jiunsong/supergemma4-26b-uncensored-gguf-v2'
$ModelName = 'supergemma4-unc'
$ModelfilePath = Join-Path $PSScriptRoot '..\Modelfile' | Resolve-Path -ErrorAction SilentlyContinue
if (-not $ModelfilePath) { $ModelfilePath = 'D:\LocalLLM\Modelfile' }

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

function Update-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('Path', 'User')
}

function Test-Ollama {
    try { Invoke-RestMethod -Uri 'http://localhost:11434/api/tags' -TimeoutSec 3 -ErrorAction Stop | Out-Null; return $true }
    catch { return $false }
}

# 1. Ollama installed?
Write-Step 'Checking Ollama install'
Update-Path
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    Write-Host 'Ollama not found — installing via winget (user scope)...'
    winget install --id Ollama.Ollama -e --accept-source-agreements --accept-package-agreements --scope user --disable-interactivity
    Update-Path
}
Write-Host ('ollama: ' + (Get-Command ollama).Source)
ollama --version

# 2. Flash attention (KV-cache memory remedy; pure upside on a 24GB 4090).
#    Persisted at user scope so the server keeps it across restarts.
Write-Step 'Enabling OLLAMA_FLASH_ATTENTION'
[System.Environment]::SetEnvironmentVariable('OLLAMA_FLASH_ATTENTION', '1', 'User')
$env:OLLAMA_FLASH_ATTENTION = '1'
# To go tighter on VRAM at high context, also set (off by default — can affect quality):
#   [System.Environment]::SetEnvironmentVariable('OLLAMA_KV_CACHE_TYPE','q8_0','User')   # then q4_0 if still tight

# 3. Server running?
Write-Step 'Ensuring Ollama server is up'
if (-not (Test-Ollama)) {
    $app = "$env:LOCALAPPDATA\Programs\Ollama\ollama app.exe"
    if (Test-Path $app) { Start-Process -FilePath $app } else { Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden }
    for ($i = 0; $i -lt 30; $i++) { if (Test-Ollama) { break }; Start-Sleep -Seconds 2 }
}
if (-not (Test-Ollama)) { throw 'Ollama server did not come up on :11434' }
Write-Host 'Server UP on http://localhost:11434'

# 4. Pull the GGUF (resumable; ~16.8 GB).
Write-Step "Pulling $ModelRepo  (~16.8 GB, resumable)"
ollama pull $ModelRepo

# 5. Create the named model with num_ctx baked in (see ..\Modelfile).
Write-Step "Creating model '$ModelName' from Modelfile"
ollama create $ModelName -f $ModelfilePath
ollama list | Select-String $ModelName

# 6. Smoke test through the Phase 1 console client.
Write-Step 'Smoke test'
$py = Join-Path $PSScriptRoot '..\console\chat.py'
python $py --health
python $py "Reply with exactly: endpoint ok"

Write-Host "`nDone. Phase 0 + 1 ready." -ForegroundColor Green
Write-Host "  Interactive chat:  python D:\LocalLLM\console\chat.py"
