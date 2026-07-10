# Install ComfyUI + pixel art custom nodes on Windows (PowerShell).
# Usage: .\setup.ps1 [-InstallDir "C:\ComfyUI"]

param(
    [string]$InstallDir = "$env:USERPROFILE\ComfyUI"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "==> ComfyUI Pixel Art setup"
Write-Host "    Install directory: $InstallDir"
Write-Host "    Starter pack:      $ScriptDir"
Write-Host ""

function Install-Node {
    param([string]$Name, [string]$Url)
    $dest = Join-Path $InstallDir "custom_nodes\$Name"
    if (Test-Path (Join-Path $dest ".git")) {
        Write-Host "    updating $Name"
        git -C $dest pull --ff-only 2>$null
    } else {
        Write-Host "    cloning $Name"
        git clone $Url $dest
    }
    $req = Join-Path $dest "requirements.txt"
    if (Test-Path $req) {
        pip install -r $req 2>$null
    }
}

# ComfyUI core
if (-not (Test-Path (Join-Path $InstallDir ".git"))) {
    Write-Host "==> Cloning ComfyUI..."
    git clone https://github.com/comfyanonymous/ComfyUI.git $InstallDir
} else {
    Write-Host "==> ComfyUI already present, pulling latest..."
    git -C $InstallDir pull --ff-only 2>$null
}

Set-Location $InstallDir

# venv
if (-not (Test-Path ".venv")) {
    Write-Host "==> Creating Python venv..."
    python -m venv .venv
}
& .\.venv\Scripts\Activate.ps1

Write-Host "==> Installing ComfyUI Python dependencies..."
pip install --upgrade pip wheel
pip install -r requirements.txt

Write-Host "==> Installing custom nodes..."
Install-Node "ComfyUI-Manager" "https://github.com/ltdrdata/ComfyUI-Manager"
Install-Node "ComfyUI-PixelArt-Detector" "https://github.com/dimtoneff/ComfyUI-PixelArt-Detector"
Install-Node "pixel_palette_art" "https://github.com/ranska/pixel_palette_art"
Install-Node "GlitchNodes" "https://github.com/pxl-pshr/GlitchNodes"
Install-Node "ComfyUI-AI-Pixel-Art-Enhancer" "https://github.com/HSDHCdev/ComfyUI-AI-Pixel-Art-Enhancer"
Install-Node "comfyui-vslinx-nodes" "https://github.com/vslinx/ComfyUI-vslinx-nodes.git"

Write-Host "==> Copying workflows..."
$destWf = Join-Path $InstallDir "user\default\workflows\pixel-art"
New-Item -ItemType Directory -Force -Path $destWf | Out-Null
Copy-Item -Recurse -Force (Join-Path $ScriptDir "workflows\*") $destWf

$padPalettes = Join-Path $InstallDir "custom_nodes\ComfyUI-PixelArt-Detector\palettes\1x"
if (Test-Path $padPalettes) {
    Write-Host "==> Copying starter palettes..."
    Copy-Item -Force (Join-Path $ScriptDir "palettes\*.png") $padPalettes -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "============================================"
Write-Host " Setup complete!"
Write-Host "============================================"
Write-Host ""
Write-Host " 1. Download models (see models.md):"
Write-Host "    - SDXL checkpoint -> $InstallDir\models\checkpoints\"
Write-Host "    - pixel-art-xl LoRA -> $InstallDir\models\loras\"
Write-Host ""
Write-Host " 2. Start ComfyUI:"
Write-Host "    cd $InstallDir"
Write-Host "    .\.venv\Scripts\Activate.ps1"
Write-Host "    python main.py"
Write-Host ""
Write-Host " 3. Open http://127.0.0.1:8188 and load workflows from:"
Write-Host "    $destWf"
