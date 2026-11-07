# Builds the icons and logos from the brand source image, in two color variants.
# Uses the Windows Imaging Component (WebP decoding ships with Windows 10 1809+).
# Run: powershell -ExecutionPolicy Bypass -File scripts\make-icon.ps1
#
# Naming: "*-light" / "on-light" = for LIGHT backgrounds (dark ink),
#         "*-dark"  / "on-dark"  = for DARK backgrounds (white ink).
# Outputs:
#   host\synto.ico            exe file icon (Explorer): dark ink with a white halo, readable on both
#   host\synto-on-light.ico   window icon when Windows uses a light theme
#   host\synto-on-dark.ico    window icon when Windows uses a dark theme
#   app\assets\logo.png       in-app logo (the app UI is always light)
#   app\assets\logo-dark.png  logo for dark surfaces (README in GitHub dark mode)
#   app\assets\icon-light.png / icon-dark.png   browser tab icons for the web build
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore, WindowsBase

$root = Split-Path -Parent $PSScriptRoot
$src  = Join-Path $root 'brand\synto-logo.webp'

# Ink bounds measured on the 1254x1254 source: whole lockup and the mark alone.
$lockup = @{ X = 175; Y = 510; W = 905; H = 272 }
$mark   = @{ X = 175; Y = 510; W = 246; H = 272 }

$stream = [IO.File]::OpenRead($src)
try {
  $frame = [Windows.Media.Imaging.BitmapDecoder]::Create($stream, 'None', 'OnLoad').Frames[0]
} finally { $stream.Close() }

# Renders a region of the source into a WxH bitmap (centered, padded); the logo's luminance
# becomes alpha and every pixel gets the given ink color.
function Get-Ink($region, [int]$w, [int]$h, [double]$pad, [byte]$ink) {
  $crop = New-Object Windows.Media.Imaging.CroppedBitmap($frame, (New-Object Windows.Int32Rect($region.X, $region.Y, $region.W, $region.H)))
  $scale = [Math]::Min(($w - 2 * $pad) / $region.W, ($h - 2 * $pad) / $region.H)
  $dw = $region.W * $scale; $dh = $region.H * $scale
  $visual = New-Object Windows.Media.DrawingVisual
  [Windows.Media.RenderOptions]::SetBitmapScalingMode($visual, 'HighQuality')
  $dc = $visual.RenderOpen()
  $dc.DrawRectangle([Windows.Media.Brushes]::White, $null, (New-Object Windows.Rect(0, 0, $w, $h)))
  $dc.DrawImage($crop, (New-Object Windows.Rect((($w - $dw) / 2), (($h - $dh) / 2), $dw, $dh)))
  $dc.Close()
  $rtb = New-Object Windows.Media.Imaging.RenderTargetBitmap($w, $h, 96, 96, [Windows.Media.PixelFormats]::Pbgra32)
  $rtb.Render($visual)
  $stride = $w * 4
  $px = New-Object byte[] ($stride * $h)
  $rtb.CopyPixels($px, $stride, 0)
  for ($i = 0; $i -lt $px.Length; $i += 4) {
    $lum = ($px[$i] + $px[$i + 1] + $px[$i + 2]) / 3
    $px[$i] = $ink; $px[$i + 1] = $ink; $px[$i + 2] = $ink; $px[$i + 3] = [byte](255 - $lum)
  }
  return [Windows.Media.Imaging.BitmapSource]::Create($w, $h, 96, 96, [Windows.Media.PixelFormats]::Bgra32, $null, $px, $stride)
}

function To-Png($bitmap) {
  $enc = New-Object Windows.Media.Imaging.PngBitmapEncoder
  $enc.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
  $ms = New-Object IO.MemoryStream
  $enc.Save($ms)
  return ,$ms.ToArray()
}

# variant: 'light' (dark ink, for light backgrounds), 'dark' (white ink), 'halo' (dark ink + white outline)
function Render($region, [int]$w, [int]$h, [double]$pad, [string]$variant) {
  if ($variant -eq 'light') { return ,(To-Png (Get-Ink $region $w $h $pad 10)) }
  if ($variant -eq 'dark')  { return ,(To-Png (Get-Ink $region $w $h $pad 255)) }
  # Halo: stamp the white mark in a small ring, then draw the dark mark on top.
  $r = [Math]::Max(1.0, $w / 22.0)
  $inner = $pad + $r
  $white = Get-Ink $region $w $h $inner 255
  $black = Get-Ink $region $w $h $inner 10
  $visual = New-Object Windows.Media.DrawingVisual
  $dc = $visual.RenderOpen()
  for ($k = 0; $k -lt 16; $k++) {
    $a = $k * [Math]::PI / 8
    $dc.DrawImage($white, (New-Object Windows.Rect(($r * [Math]::Cos($a)), ($r * [Math]::Sin($a)), $w, $h)))
  }
  $dc.DrawImage($black, (New-Object Windows.Rect(0, 0, $w, $h)))
  $dc.Close()
  $rtb = New-Object Windows.Media.Imaging.RenderTargetBitmap($w, $h, 96, 96, [Windows.Media.PixelFormats]::Pbgra32)
  $rtb.Render($visual)
  return ,(To-Png $rtb)
}

# Icon file with PNG-compressed entries (supported since Windows Vista).
function Write-Ico([string]$path, [string]$variant) {
  $sizes = 16, 20, 24, 32, 40, 48, 64, 128, 256
  $images = foreach ($s in $sizes) { ,(Render $mark $s $s ([Math]::Round($s * 0.06)) $variant) }
  New-Item -ItemType Directory -Force (Split-Path -Parent $path) | Out-Null
  $bw = New-Object IO.BinaryWriter([IO.File]::Create($path))
  try {
    $bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$sizes.Count)
    $offset = 6 + 16 * $sizes.Count
    for ($i = 0; $i -lt $sizes.Count; $i++) {
      $s = $sizes[$i]; $len = $images[$i].Length
      $dim = if ($s -ge 256) { 0 } else { $s }
      $bw.Write([byte]$dim); $bw.Write([byte]$dim); $bw.Write([byte]0); $bw.Write([byte]0)
      $bw.Write([uint16]1); $bw.Write([uint16]32); $bw.Write([uint32]$len); $bw.Write([uint32]$offset)
      $offset += $len
    }
    foreach ($img in $images) { $bw.Write($img) }
  } finally { $bw.Close() }
  Write-Host "Icon: $path"
}

function Write-Png([string]$path, [byte[]]$bytes) {
  New-Item -ItemType Directory -Force (Split-Path -Parent $path) | Out-Null
  [IO.File]::WriteAllBytes($path, $bytes)
  Write-Host "PNG:  $path"
}

Write-Ico (Join-Path $root 'host\synto.ico') 'halo'
Write-Ico (Join-Path $root 'host\synto-on-light.ico') 'light'
Write-Ico (Join-Path $root 'host\synto-on-dark.ico') 'dark'
# Logos at 3x of the 28px display height for sharp HiDPI rendering.
Write-Png (Join-Path $root 'app\assets\logo.png') (Render $lockup 278 84 0 'light')
Write-Png (Join-Path $root 'app\assets\logo-dark.png') (Render $lockup 278 84 0 'dark')
Write-Png (Join-Path $root 'app\assets\icon-light.png') (Render $mark 64 64 4 'light')
Write-Png (Join-Path $root 'app\assets\icon-dark.png') (Render $mark 64 64 4 'dark')
