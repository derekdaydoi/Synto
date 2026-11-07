# Builds dist\Synto.exe: a single portable executable that embeds the web app and WebView2 SDK.
# Requirements: Windows 10/11 with .NET Framework 4.8 (built in) and the WebView2 Runtime (built into Windows 11).
# Run: powershell -ExecutionPolicy Bypass -File build.ps1
[CmdletBinding()]
param([switch]$SkipFetch)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$cache = Join-Path $root 'build\cache'
$wv = Join-Path $cache 'webview2'
$dist = Join-Path $root 'dist'

if (-not $SkipFetch -or -not (Test-Path $wv) -or -not (Test-Path (Join-Path $root 'app\vendor\katex'))) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\fetch-deps.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'fetch-deps failed' }
}
if (-not (Test-Path (Join-Path $root 'host\synto-on-dark.ico'))) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\make-icon.ps1')
}

$csc = Get-ChildItem "$env:WINDIR\Microsoft.NET\Framework64\v4.*\csc.exe" -ErrorAction SilentlyContinue | Sort-Object FullName | Select-Object -Last 1
if (-not $csc) { $csc = Get-ChildItem "$env:WINDIR\Microsoft.NET\Framework\v4.*\csc.exe" | Sort-Object FullName | Select-Object -Last 1 }
if (-not $csc) { throw 'csc.exe (.NET Framework 4.x) not found' }
$fw = Split-Path -Parent $csc.FullName

# Pack the web app (tests and dev files are not part of it).
New-Item -ItemType Directory -Force $dist, (Join-Path $root 'build') | Out-Null
$zip = Join-Path $root 'build\app.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $root 'app'), $zip, [IO.Compression.CompressionLevel]::Optimal, $false)

$out = Join-Path $dist 'Synto.exe'
$cscArgs = @(
  '/nologo', '/target:winexe', '/platform:anycpu', '/optimize+', '/utf8output', '/codepage:65001',
  "/out:$out",
  "/win32icon:$(Join-Path $root 'host\synto.ico')",
  "/win32manifest:$(Join-Path $root 'host\app.manifest')",
  "/reference:$wv\Microsoft.Web.WebView2.Core.dll",
  "/reference:$wv\Microsoft.Web.WebView2.WinForms.dll",
  "/reference:$fw\System.Windows.Forms.dll",
  "/reference:$fw\System.Drawing.dll",
  "/reference:$fw\System.Web.Extensions.dll",
  "/reference:$fw\System.IO.Compression.dll",
  "/reference:$fw\System.IO.Compression.FileSystem.dll",
  "/resource:$zip,Synto.app.zip",
  "/resource:$(Join-Path $root 'host\synto-on-light.ico'),Synto.icon.on-light.ico",
  "/resource:$(Join-Path $root 'host\synto-on-dark.ico'),Synto.icon.on-dark.ico",
  "/resource:$wv\Microsoft.Web.WebView2.Core.dll,Synto.lib.Microsoft.Web.WebView2.Core.dll",
  "/resource:$wv\Microsoft.Web.WebView2.WinForms.dll,Synto.lib.Microsoft.Web.WebView2.WinForms.dll",
  "/resource:$wv\x64\WebView2Loader.dll,Synto.loader.x64.WebView2Loader.dll",
  "/resource:$wv\x86\WebView2Loader.dll,Synto.loader.x86.WebView2Loader.dll",
  "/resource:$wv\arm64\WebView2Loader.dll,Synto.loader.arm64.WebView2Loader.dll",
  (Join-Path $root 'host\Program.cs')
)
& $csc.FullName @cscArgs
if ($LASTEXITCODE -ne 0) { throw "Compile failed ($LASTEXITCODE)" }
$size = [math]::Round((Get-Item $out).Length / 1MB, 2)
Write-Host "Built $out ($size MB)"
