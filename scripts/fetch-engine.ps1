# Fetches the bundled llama.cpp engine (Vulkan, Windows x64) into
# frontend/src-tauri/bin/llama. Those binaries are gitignored (~89 MB), so run
# this once after a fresh clone, before building the app:
#
#   powershell -ExecutionPolicy Bypass -File scripts\fetch-engine.ps1
#   (or:  cd frontend ; npm run fetch-engine)
#
$ErrorActionPreference = 'Stop'

$tag = 'b9829' # pinned llama.cpp release for reproducible builds
$asset = "llama-$tag-bin-win-vulkan-x64.zip"
$url = "https://github.com/ggml-org/llama.cpp/releases/download/$tag/$asset"
$dest = Join-Path $PSScriptRoot '..\frontend\src-tauri\bin\llama'
$zip = Join-Path $env:TEMP $asset

if (Test-Path (Join-Path $dest 'llama-server.exe')) {
  Write-Host "Engine already present at $dest — nothing to do."
  exit 0
}

New-Item -ItemType Directory -Force -Path $dest | Out-Null
Write-Host "Downloading $asset ..."
& curl.exe -L --fail --no-progress-meter -o $zip $url
if ($LASTEXITCODE -ne 0) { throw "Download failed (curl exit $LASTEXITCODE)" }

Write-Host "Extracting to $dest ..."
Expand-Archive -Path $zip -DestinationPath $dest -Force
Remove-Item $zip -ErrorAction SilentlyContinue

if (Test-Path (Join-Path $dest 'llama-server.exe')) {
  Write-Host "Engine ready at $dest"
} else {
  throw 'llama-server.exe missing after extraction'
}
