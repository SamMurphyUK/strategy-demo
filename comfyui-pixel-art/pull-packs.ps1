# Pull custom nodes + workflows into an EXISTING ComfyUI install.
# Usage: .\pull-packs.ps1 [-ComfyDir "C:\ComfyUI"]

param(
    [string]$ComfyDir = $(if ($env:COMFYUI_DIR) { $env:COMFYUI_DIR } else { "$env:USERPROFILE\ComfyUI" })
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Test-Path (Join-Path $ComfyDir "main.py"))) {
    Write-Error "Not a ComfyUI directory: $ComfyDir"
}

Write-Host "==> Pulling pixel-art packs into: $ComfyDir"

function Install-Node {
    param([string]$Name, [string]$Url)
    $dest = Join-Path $ComfyDir "custom_nodes\$Name"
    if (Test-Path (Join-Path $dest ".git")) {
        Write-Host "    updating $Name"
        git -C $dest pull --ff-only 2>$null
    } else {
        Write-Host "    cloning $Name"
        git clone $Url $dest
    }
    $req = Join-Path $dest "requirements.txt"
    if (Test-Path $req) { pip install -r $req 2>$null }
}

$nodes = @(
    @("ComfyUI-Manager", "https://github.com/ltdrdata/ComfyUI-Manager"),
    @("ComfyUI-PixelArt-Detector", "https://github.com/dimtoneff/ComfyUI-PixelArt-Detector"),
    @("ComfyUI-TiledDiffusion", "https://github.com/shiimizu/ComfyUI-TiledDiffusion"),
    @("comfyui_controlnet_aux", "https://github.com/Fannovel16/comfyui_controlnet_aux"),
    @("ComfyUI-Advanced-ControlNet", "https://github.com/Kosinkadink/ComfyUI-Advanced-ControlNet"),
    @("ComfyUI_IPAdapter_plus", "https://github.com/cubiq/ComfyUI_IPAdapter_plus"),
    @("GlitchNodes", "https://github.com/pxl-pshr/GlitchNodes"),
    @("pixel_palette_art", "https://github.com/ranska/pixel_palette_art"),
    @("ComfyUI-AI-Pixel-Art-Enhancer", "https://github.com/HSDHCdev/ComfyUI-AI-Pixel-Art-Enhancer"),
    @("comfyui-vslinx-nodes", "https://github.com/vslinx/ComfyUI-vslinx-nodes.git")
)

foreach ($n in $nodes) { Install-Node $n[0] $n[1] }

$destWf = Join-Path $ComfyDir "user\default\workflows\pixel-art"
New-Item -ItemType Directory -Force -Path $destWf | Out-Null
Copy-Item -Recurse -Force (Join-Path $ScriptDir "workflows\*") $destWf

$padPalettes = Join-Path $ComfyDir "custom_nodes\ComfyUI-PixelArt-Detector\palettes\1x"
if (Test-Path $padPalettes) {
    Copy-Item -Force (Join-Path $ScriptDir "palettes\*.png") $padPalettes -ErrorAction SilentlyContinue
}

@("checkpoints","controlnet","loras","vae","ipadapter","clip_vision") | ForEach-Object {
    New-Item -ItemType Directory -Force -Path (Join-Path $ComfyDir "models\$_") | Out-Null
}

Write-Host ""
Write-Host "Done! Next:"
Write-Host "  .\scripts\download-models.ps1 -ComfyDir `"$ComfyDir`""
Write-Host "  .\scripts\verify-setup.ps1 -ComfyDir `"$ComfyDir`""
Write-Host "Restart ComfyUI."
