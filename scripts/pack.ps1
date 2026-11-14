# Builds dist/zarpa-party-<version>.zip with only the files the extension needs at runtime.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/pack.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$include = @('manifest.json', 'config.js', 'background.js', 'content', 'popup', 'icons', '_locales')
$version = (Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json).version
$dist = Join-Path $root 'dist'
$zipPath = Join-Path $dist "zarpa-party-$version.zip"

New-Item -ItemType Directory -Force $dist | Out-Null
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$files = foreach ($item in $include) {
  $path = Join-Path $root $item
  if (-not (Test-Path $path)) { throw "Missing $item" }
  if ((Get-Item $path).PSIsContainer) { Get-ChildItem $path -Recurse -File } else { Get-Item $path }
}

# Entries are written by hand so paths always use forward slashes (Compress-Archive on Windows
# PowerShell 5.1 writes backslashes, which the Chrome Web Store rejects).
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
  foreach ($file in $files) {
    $entry = $file.FullName.Substring($root.Length + 1).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entry, 'Optimal') | Out-Null
  }
} finally {
  $zip.Dispose()
}

$size = [math]::Round((Get-Item $zipPath).Length / 1KB, 1)
Write-Host "Packed $($files.Count) files -> $zipPath ($size KB)"
