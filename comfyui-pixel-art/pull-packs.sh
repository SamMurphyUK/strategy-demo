#!/usr/bin/env bash
# Pull custom nodes + workflows into an EXISTING ComfyUI install.
# Usage: COMFYUI_DIR=/path/to/ComfyUI ./pull-packs.sh
#    or: ./pull-packs.sh /path/to/ComfyUI

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${1:-${COMFYUI_DIR:-$HOME/ComfyUI}}"

if [[ ! -d "$INSTALL_DIR" ]]; then
  echo "ERROR: ComfyUI directory not found: $INSTALL_DIR"
  echo "Set COMFYUI_DIR or pass path as first argument."
  exit 1
fi

if [[ ! -f "$INSTALL_DIR/main.py" ]]; then
  echo "ERROR: $INSTALL_DIR does not look like a ComfyUI root (missing main.py)"
  exit 1
fi

echo "==> Pulling pixel-art packs into existing ComfyUI"
echo "    Target: $INSTALL_DIR"
echo

cd "$INSTALL_DIR"

# Activate venv if present
if [[ -f ".venv/bin/activate" ]]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
elif [[ -f "venv/bin/activate" ]]; then
  # shellcheck disable=SC1091
  source venv/bin/activate
fi

install_node() {
  local name="$1"
  local url="$2"
  local dest="custom_nodes/$name"
  if [[ -d "$dest/.git" ]]; then
    echo "    updating $name"
    git -C "$dest" pull --ff-only || true
  else
    echo "    cloning $name"
    git clone "$url" "$dest"
  fi
  if [[ -f "$dest/requirements.txt" ]]; then
    pip install -r "$dest/requirements.txt" 2>/dev/null || true
  fi
}

echo "==> Core pixel-art nodes..."
install_node "ComfyUI-Manager" "https://github.com/ltdrdata/ComfyUI-Manager"
install_node "ComfyUI-PixelArt-Detector" "https://github.com/dimtoneff/ComfyUI-PixelArt-Detector"
install_node "pixel_palette_art" "https://github.com/ranska/pixel_palette_art"

echo "==> ControlNet + large-canvas nodes (required for tile workflow)..."
install_node "ComfyUI-TiledDiffusion" "https://github.com/shiimizu/ComfyUI-TiledDiffusion"
install_node "comfyui_controlnet_aux" "https://github.com/Fannovel16/comfyui_controlnet_aux"
install_node "ComfyUI-Advanced-ControlNet" "https://github.com/Kosinkadink/ComfyUI-Advanced-ControlNet"

echo "==> Optional enhancement nodes..."
install_node "GlitchNodes" "https://github.com/pxl-pshr/GlitchNodes"
install_node "ComfyUI-AI-Pixel-Art-Enhancer" "https://github.com/HSDHCdev/ComfyUI-AI-Pixel-Art-Enhancer"
install_node "comfyui-vslinx-nodes" "https://github.com/vslinx/ComfyUI-vslinx-nodes.git"
install_node "ComfyUI_IPAdapter_plus" "https://github.com/cubiq/ComfyUI_IPAdapter_plus"

echo "==> Copying workflows..."
DEST_WF="user/default/workflows/pixel-art"
mkdir -p "$DEST_WF"
cp -r "$SCRIPT_DIR/workflows/." "$DEST_WF/"

echo "==> Copying palettes..."
PAD_PALETTES="custom_nodes/ComfyUI-PixelArt-Detector/palettes/1x"
if [[ -d "$PAD_PALETTES" ]]; then
  cp "$SCRIPT_DIR/palettes/"*.png "$PAD_PALETTES/" 2>/dev/null || true
fi

echo "==> Creating model directories..."
mkdir -p models/{checkpoints,controlnet,loras,vae,ipadapter,clip_vision}

echo
echo "============================================"
echo " Packs installed!"
echo "============================================"
echo
echo " Next: download models"
echo "   cd $SCRIPT_DIR"
echo "   ./scripts/download-models.sh $INSTALL_DIR"
echo
echo " Then verify:"
echo "   ./scripts/verify-setup.sh $INSTALL_DIR"
echo
echo " Restart ComfyUI after installing nodes."
echo
