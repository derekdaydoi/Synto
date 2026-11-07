# Publishes the web build (app/ with its vendor libraries) to the gh-pages branch,
# which GitHub Pages serves at https://<user>.github.io/<repo>/.
# Run from the repo root after scripts\fetch-deps.ps1:
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-pages.ps1
[CmdletBinding()]
param([string]$Remote = 'origin')

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$git = (Get-Command git -ErrorAction SilentlyContinue).Source
if (-not $git) { $git = 'C:\Program Files\Git\cmd\git.exe' }
if (-not (Test-Path (Join-Path $root 'app\vendor\katex'))) { throw 'Run scripts\fetch-deps.ps1 first (app\vendor is missing).' }

$url = (& $git -C $root remote get-url $Remote).Trim()
$name = (& $git -C $root config user.name).Trim()
$email = (& $git -C $root config user.email).Trim()
$rev = (& $git -C $root rev-parse --short HEAD).Trim()

$site = Join-Path $root 'build\pages'
if (Test-Path $site) { Remove-Item -Recurse -Force $site }
New-Item -ItemType Directory -Force $site | Out-Null
Copy-Item -Recurse -Force (Join-Path $root 'app\*') $site
# The Windows download linked from the README: <site>/download/Synto.exe
$exe = Join-Path $root 'dist\Synto.exe'
if (-not (Test-Path $exe)) { throw 'dist\Synto.exe is missing: run build.ps1 first.' }
New-Item -ItemType Directory -Force (Join-Path $site 'download') | Out-Null
Copy-Item -Force $exe (Join-Path $site 'download\Synto.exe')
# No Jekyll processing: serve every file as-is.
New-Item -ItemType File -Force (Join-Path $site '.nojekyll') | Out-Null

& $git -C $site init -q -b gh-pages
& $git -C $site config user.name $name
& $git -C $site config user.email $email
& $git -C $site config core.autocrlf false
& $git -C $site add -A
& $git -C $site commit -q -m "Deploy web build from $rev"
& $git -C $site push -f $url gh-pages
if ($LASTEXITCODE -ne 0) { throw 'Push to gh-pages failed' }
Write-Host "Published gh-pages from $rev"
