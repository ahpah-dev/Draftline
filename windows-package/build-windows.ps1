# Build script for Draftline Windows Desktop Application
$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $here
Set-Location $projectRoot

Write-Host "Building frontend..." -ForegroundColor Cyan
npm run build

Write-Host "Generating icon..." -ForegroundColor Cyan
Add-Type -AssemblyName System.Drawing

function Create-DraftlineBitmap($size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $radius = [float]($size * 0.26)
    $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 37, 35, 33))

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc($size - $d - 1, 0, $d, $d, 270, 90)
    $path.AddArc($size - $d - 1, $size - $d - 1, $d, $d, 0, 90)
    $path.AddArc(0, $size - $d - 1, $d, $d, 90, 90)
    $path.CloseFigure()
    $g.FillPath($bgBrush, $path)

    $scale = $size / 48.0
    $penWhite = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 250, 248, 245), [float](3.2 * $scale))
    $penWhite.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $penWhite.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

    $penAccent = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 232, 161, 124), [float](3.0 * $scale))
    $penAccent.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $penAccent.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

    $dPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $x = 13 * $scale
    $y = 11 * $scale
    $w = 10 * $scale
    $h = 26 * $scale
    $arcW = 14 * $scale
    $dPath.AddLine($x, $y + $h, $x, $y)
    $dPath.AddLine($x, $y, $x + $w, $y)
    $dPath.AddArc($x + $w - $arcW, $y, $arcW * 2, $h, 270, 180)
    $dPath.AddLine($x + $w, $y + $h, $x, $y + $h)
    $g.DrawPath($penWhite, $dPath)

    $iPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $ix = 20 * $scale
    $iy = 18 * $scale
    $iw = 4 * $scale
    $ih = 12 * $scale
    $iArcW = 7 * $scale
    $iPath.AddLine($ix, $iy + $ih, $ix, $iy)
    $iPath.AddLine($ix, $iy, $ix + $iw, $iy)
    $iPath.AddArc($ix + $iw - $iArcW, $iy, $iArcW * 2, $ih, 270, 180)
    $g.DrawPath($penAccent, $iPath)

    $g.Dispose()
    return $bmp
}

$sizes = @(16, 32, 48, 64)
$bitmaps = $sizes | ForEach-Object { Create-DraftlineBitmap $_ }

$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([uint16]0)
$bw.Write([uint16]1)
$bw.Write([uint16]$sizes.Count)
$offset = 6 + (16 * $sizes.Count)
$pngDataList = @()

foreach ($b in $bitmaps) {
    $pngMs = New-Object System.IO.MemoryStream
    $b.Save($pngMs, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngData = $pngMs.ToArray()
    $pngDataList += ,$pngData

    $w = if ($b.Width -ge 256) { [byte]0 } else { [byte]$b.Width }
    $h = if ($b.Height -ge 256) { [byte]0 } else { [byte]$b.Height }
    $bw.Write($w)
    $bw.Write($h)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]32)
    $bw.Write([uint32]$pngData.Length)
    $bw.Write([uint32]$offset)
    $offset += $pngData.Length
}

foreach ($png in $pngDataList) { $bw.Write($png) }
$icoPath = "$here\Draftline.ico"
[System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())

Write-Host "Compiling native Windows launcher (Draftline.exe)..." -ForegroundColor Cyan
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
& $csc /nologo /target:winexe /win32icon:"$icoPath" /out:"$here\Draftline.exe" /reference:System.dll,System.Drawing.dll,System.Windows.Forms.dll "$here\DraftlineLauncher.cs"

Write-Host "Assembling bundle..." -ForegroundColor Cyan
$dest = "$here\Draftline"
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
New-Item -ItemType Directory -Force -Path $dest | Out-Null

Copy-Item "$here\Draftline.exe" "$dest\Draftline.exe"
Copy-Item "$icoPath" "$dest\Draftline.ico"
$nodePath = (Get-Command node).Source
Copy-Item $nodePath "$dest\node.exe"
Copy-Item -Recurse "dist" "$dest\dist"
Copy-Item "package.json" "$dest\package.json"
Copy-Item "LICENSE" "$dest\LICENSE"

New-Item -ItemType Directory -Force -Path "$dest\server" | Out-Null
Get-ChildItem "server" -Exclude "*.test.mjs" | Copy-Item -Destination "$dest\server" -Recurse

Write-Host "Creating zip package..." -ForegroundColor Cyan
$pkg = Get-Content "package.json" -Raw | ConvertFrom-Json
$zipPath = "$here\Draftline-v$($pkg.version)-windows-x64.zip"
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Compress-Archive -Path $dest -DestinationPath $zipPath -Force

Write-Host "Done! Package created at: $zipPath" -ForegroundColor Green
