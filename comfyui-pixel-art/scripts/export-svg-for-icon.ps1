# Rasterize SVG to PNG for the vector→circle icon ComfyUI workflow.
# Usage: .\export-svg-for-icon.ps1 C:\path\to\unit.svg
# Output: ComfyUI\input\vector_export.png (1024x1024, transparent)

param(
    [Parameter(Mandatory = $true)]
    [string]$SvgPath,
    [string]$ComfyDir = "C:\ComfyUI_windows_portable_nvidia\ComfyUI_windows_portable\ComfyUI",
    [int]$Size = 1024
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path $SvgPath)) { throw "SVG not found: $SvgPath" }

$inputDir = Join-Path $ComfyDir "input"
New-Item -ItemType Directory -Force -Path $inputDir | Out-Null
$outPng = Join-Path $inputDir "vector_export.png"

$inkscape = @(
    "${env:ProgramFiles}\Inkscape\bin\inkscape.exe",
    "${env:ProgramFiles(x86)}\Inkscape\bin\inkscape.exe",
    "$env:LOCALAPPDATA\Programs\Inkscape\bin\inkscape.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($inkscape) {
    Write-Host "Rasterizing with Inkscape..."
    & $inkscape $SvgPath --export-type=png --export-filename=$outPng -w $Size -h $Size --export-background-opacity=0
} else {
    $magick = Get-Command magick -ErrorAction SilentlyContinue
    if ($magick) {
        Write-Host "Rasterizing with ImageMagick..."
        & magick -background none -density 300 $SvgPath -resize "${Size}x${Size}" $outPng
    } else {
        throw @"
No SVG rasterizer found. Install Inkscape (https://inkscape.org) or ImageMagick,
or export manually: open SVG → export 1024x1024 PNG with transparent background
→ save as: $outPng
"@
    }
}

Write-Host "Wrote: $outPng"
Write-Host "Now load pixel-icon-vector2circle.json in ComfyUI and run."
