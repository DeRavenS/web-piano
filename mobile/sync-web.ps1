# Copies the web app from the repo root into assets/web so it gets bundled
# into the Android app. Run before every build (build-release.ps1 does it).
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$dest = Join-Path $PSScriptRoot 'assets\web'
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item (Join-Path $root '*') $dest -Include *.html, *.js, *.css
Copy-Item (Join-Path $root 'samples') $dest -Recurse
Write-Host "Synced web app into $dest"
