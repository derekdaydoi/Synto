# Downloads third-party libraries at pinned versions and verifies SHA-256.
# Run: powershell -ExecutionPolicy Bypass -File scripts\fetch-deps.ps1
# Output: app\vendor\* (web UI) and build\cache\webview2\* (exe host).
[CmdletBinding()]
param([switch]$Force)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root  = Split-Path -Parent $PSScriptRoot
$cache = Join-Path $root 'build\cache'
$vendor = Join-Path $root 'app\vendor'
New-Item -ItemType Directory -Force $cache, $vendor | Out-Null

$packages = @(
  @{ Name='katex';            Version='0.19.1';      Kind='npm';   Sha256='24da5a599eb2fcede2e270b99a6ff48bca816beecc95feeb84e8cccbd1bb34fd' },
  @{ Name='pdfjs-dist';       Version='6.4.299';     Kind='npm';   Sha256='86269b40170eb41740ea05ad2102d71d33de4f122b34eb2f478be0ea7779c415' },
  @{ Name='roughjs';          Version='4.6.6';       Kind='npm';   Sha256='373873b2c3f1b7ddba878525c774816057c5818029780c7fba081f06018ba78c' },
  @{ Name='perfect-freehand'; Version='1.2.3';       Kind='npm';   Sha256='060048047071b6ffb2170c8b867ba995f365ec811dc32435574d3d5f7625981f' },
  @{ Name='microsoft.web.webview2'; Version='1.0.4314.35'; Kind='nuget'; Sha256='90778deb1b77e36292828b4b5833c9255c27533f40e0ddd55891ae718944edc4' },
  @{ Name='patrickhand';      Version='google-fonts'; Kind='font'; Sha256='0f173b3e6cb6d1af25babf7f0057c5ac4ee11f9992b0469bb817e967ef4ad0fc' }
)

function Get-Url($p) {
  switch ($p.Kind) {
    'npm'   { $base = $p.Name.Split('/')[-1]; return "https://registry.npmjs.org/$($p.Name)/-/$base-$($p.Version).tgz" }
    'nuget' { return "https://api.nuget.org/v3-flatcontainer/$($p.Name)/$($p.Version)/$($p.Name).$($p.Version).nupkg" }
    'font'  { return 'https://raw.githubusercontent.com/google/fonts/main/ofl/patrickhand/PatrickHand-Regular.ttf' }
  }
}

function Get-Verified($p) {
  $url = Get-Url $p
  $file = Join-Path $cache ("{0}-{1}{2}" -f $p.Name, $p.Version, [IO.Path]::GetExtension($url))
  if ($Force -or -not (Test-Path $file)) {
    Write-Host "Downloading $($p.Name) $($p.Version)"
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $file -Headers @{ 'User-Agent' = 'synto-build' }
  }
  $hash = (Get-FileHash -Algorithm SHA256 $file).Hash.ToLowerInvariant()
  if ($p.Sha256 -and $hash -ne $p.Sha256) {
    Remove-Item $file -Force
    throw "SHA-256 mismatch for $($p.Name): $hash (expected $($p.Sha256))"
  }
  if (-not $p.Sha256) { Write-Warning "No pinned hash for $($p.Name): $hash" }
  return $file
}

function Expand-Tgz($file, $dest) {
  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
  New-Item -ItemType Directory -Force $dest | Out-Null
  & "$env:SystemRoot\System32\tar.exe" -xzf $file -C $dest
  if ($LASTEXITCODE -ne 0) { throw "Extract failed: $file" }
  return (Join-Path $dest 'package')
}

function Copy-Into($src, $dst) {
  New-Item -ItemType Directory -Force (Split-Path -Parent $dst) | Out-Null
  Copy-Item -Recurse -Force $src $dst
}

foreach ($p in $packages) {
  $file = Get-Verified $p
  $work = Join-Path $cache ("x-" + $p.Name)
  switch ($p.Name) {
    'katex' {
      $pkg = Expand-Tgz $file $work
      $out = Join-Path $vendor 'katex'
      if (Test-Path $out) { Remove-Item -Recurse -Force $out }
      Copy-Into "$pkg\dist\katex.min.js"  "$out\katex.min.js"
      Copy-Into "$pkg\dist\katex.min.css" "$out\katex.min.css"
      New-Item -ItemType Directory -Force "$out\fonts" | Out-Null
      Copy-Item "$pkg\dist\fonts\*.woff2" "$out\fonts\"
      Copy-Into "$pkg\LICENSE" "$out\LICENSE"
    }
    'pdfjs-dist' {
      $pkg = Expand-Tgz $file $work
      $out = Join-Path $vendor 'pdfjs'
      if (Test-Path $out) { Remove-Item -Recurse -Force $out }
      Copy-Into "$pkg\build\pdf.min.mjs"        "$out\pdf.min.mjs"
      Copy-Into "$pkg\build\pdf.worker.min.mjs" "$out\pdf.worker.min.mjs"
      Copy-Into "$pkg\cmaps"          "$out\cmaps"
      Copy-Into "$pkg\standard_fonts" "$out\standard_fonts"
      Copy-Into "$pkg\iccs" "$out\iccs"
      # Image decoders (JPEG2000, JBIG2) and color management; the JS eval sandbox is not needed.
      New-Item -ItemType Directory -Force "$out\wasm" | Out-Null
      Get-ChildItem "$pkg\wasm" -File | Where-Object { ($_.Extension -eq '.wasm' -or $_.Name -like 'LICENSE*') -and $_.Name -notlike 'quickjs*' } | Copy-Item -Destination "$out\wasm\"
      Copy-Into "$pkg\LICENSE" "$out\LICENSE"
    }
    'roughjs' {
      $pkg = Expand-Tgz $file $work
      $out = Join-Path $vendor 'roughjs'
      if (Test-Path $out) { Remove-Item -Recurse -Force $out }
      Copy-Into "$pkg\bundled\rough.esm.js" "$out\rough.esm.js"
      Copy-Into "$pkg\LICENSE" "$out\LICENSE"
    }
    'perfect-freehand' {
      $pkg = Expand-Tgz $file $work
      $out = Join-Path $vendor 'perfect-freehand'
      if (Test-Path $out) { Remove-Item -Recurse -Force $out }
      $esm = Get-ChildItem -Recurse "$pkg\dist" -Include 'index.mjs','index.esm.js','index.js' | Where-Object { $_.FullName -match 'esm|mjs' } | Select-Object -First 1
      if (-not $esm) { throw 'ESM build of perfect-freehand not found' }
      Copy-Into $esm.FullName "$out\index.mjs"
      $lic = Get-ChildItem $pkg -Filter 'LICENSE*' | Select-Object -First 1
      if ($lic) { Copy-Into $lic.FullName "$out\LICENSE" }
    }
    'microsoft.web.webview2' {
      if (Test-Path $work) { Remove-Item -Recurse -Force $work }
      $zip = "$file.zip"; Copy-Item -Force $file $zip
      Expand-Archive -Force $zip $work; Remove-Item $zip
      $out = Join-Path $cache 'webview2'
      if (Test-Path $out) { Remove-Item -Recurse -Force $out }
      New-Item -ItemType Directory -Force $out | Out-Null
      Copy-Item "$work\lib\net462\Microsoft.Web.WebView2.Core.dll"     $out
      Copy-Item "$work\lib\net462\Microsoft.Web.WebView2.WinForms.dll" $out
      foreach ($arch in 'x64','x86','arm64') {
        New-Item -ItemType Directory -Force "$out\$arch" | Out-Null
        Copy-Item "$work\runtimes\win-$arch\native\WebView2Loader.dll" "$out\$arch\"
      }
      Copy-Item "$work\LICENSE.txt" "$out\LICENSE.txt" -ErrorAction SilentlyContinue
    }
    'patrickhand' {
      $out = Join-Path $root 'app\fonts'
      New-Item -ItemType Directory -Force $out | Out-Null
      Copy-Item -Force $file "$out\PatrickHand-Regular.ttf"
    }
  }
}
Write-Host 'Done: dependencies are ready.'
