# Renders the marketing screenshots in docs\marketing from the scenes in scripts\marketing.
# Each scene runs inside the real exe (--dev, throwaway profile), then the window's client
# area is captured at native resolution.
# Run: powershell -ExecutionPolicy Bypass -File scripts\make-screenshots.ps1 [-Only 02]
param([string]$Only = '')

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'dist\Synto.exe'
if (-not (Test-Path $exe)) { throw 'dist\Synto.exe is missing: run build.ps1 first.' }
$sceneDir = Join-Path $root 'scripts\marketing'
$outDir = Join-Path $root 'docs\marketing'
$work = Join-Path $root 'build\marketing'
New-Item -ItemType Directory -Force $outDir, $work | Out-Null

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class Shot {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
}
"@
[Shot]::SetProcessDPIAware() | Out-Null

$helpers = Get-Content -Raw -Encoding UTF8 (Join-Path $sceneDir 'helpers.js')
$scenes = Get-ChildItem $sceneDir -Filter '*.js' | Where-Object { $_.Name -ne 'helpers.js' -and $_.Name -like "$Only*" } | Sort-Object Name

Add-Type -AssemblyName System.Windows.Forms
foreach ($scene in $scenes) {
  # Park the real mouse outside the window so no hover state shows up in the shot.
  $wa = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  [System.Windows.Forms.Cursor]::Position = New-Object Drawing.Point(($wa.Right - 2), ($wa.Bottom - 2))
  $name = [IO.Path]::GetFileNameWithoutExtension($scene.Name)
  $run = Join-Path $work 'run.js'
  [IO.File]::WriteAllText($run, $helpers + "`n" + (Get-Content -Raw -Encoding UTF8 $scene.FullName), (New-Object Text.UTF8Encoding $false))
  $profile = Join-Path $work 'profile'
  if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }
  Get-Process Synto -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Stop-Process -Force
  $p = Start-Process $exe -ArgumentList '--dev', (Join-Path $root 'app'), '--script', $run, '--data', $profile -PassThru
  $h = [IntPtr]::Zero
  for ($i = 0; $i -lt 100 -and $h -eq [IntPtr]::Zero; $i++) { Start-Sleep -Milliseconds 100; $p.Refresh(); $h = $p.MainWindowHandle }
  if ($h -eq [IntPtr]::Zero) { throw "No window for $name" }
  # Phone scene: narrow window; others: a 16:10 desktop window.
  $size = if ($name -like '*dien-thoai*') { @(500, 1010) } else { @(1700, 1060) }
  [Shot]::ShowWindow($h, 9) | Out-Null
  [Shot]::SetWindowPos($h, [IntPtr]::Zero, 20, 10, $size[0], $size[1], 0x0040) | Out-Null
  $title = ''
  for ($i = 0; $i -lt 400 -and $title -ne 'READY'; $i++) {
    Start-Sleep -Milliseconds 100
    $sb = New-Object Text.StringBuilder 256
    [Shot]::GetWindowText($h, $sb, 256) | Out-Null
    $title = $sb.ToString()
  }
  if ($title -ne 'READY') { Write-Warning "$name did not signal READY (title: $title)" }
  $r = New-Object Shot+RECT
  [Shot]::GetClientRect($h, [ref]$r) | Out-Null
  $bmp = New-Object Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
  $g = [Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  [Shot]::PrintWindow($h, $hdc, 3) | Out-Null   # client area only, full GPU content
  $g.ReleaseHdc($hdc); $g.Dispose()
  $out = Join-Path $outDir "$name.png"
  $bmp.Save($out, [Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  Write-Host ("{0}  {1}x{2}" -f $out, ($r.R - $r.L), ($r.B - $r.T))
  Stop-Process -Id $p.Id -Force
  Start-Sleep -Milliseconds 400
}
if (Test-Path (Join-Path $work 'profile')) { Remove-Item -Recurse -Force (Join-Path $work 'profile') }
