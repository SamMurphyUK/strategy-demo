#!/usr/bin/env bash
# Install ComfyUI + pixel art custom nodes on Linux/macOS.
# Usage: ./setup.sh [install_dir]
# Default install dir: ~/ComfyUI

set -euo pipefail

INSTALL_DIR="${1:-$HOME/ComfyUI}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> ComfyUI Pixel Art setup"
echo "    Install directory: $INSTALL_DIR"
echo "    Starter pack:      $SCRIPT_DIR"
echo

# --- ComfyUI core ---
if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  echo "==> Cloning ComfyUI..."
  git clone https://github.com/comfyanonymous/ComfyUI.git "$INSTALL_DIR"
else
  echo "==> ComfyUI already present, pulling latest..."
  git -C "$INSTALL_DIR" pull --ff-only || true
fi

cd "$INSTALL_DIR"

# --- Python venv ---
if [[ ! -d ".venv" ]]; then
  echo "==> Creating Python venv..."
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate

echo "==> Installing ComfyUI Python dependencies..."
pip install --upgrade pip wheel
pip install -r requirements.txt

# --- Custom nodes ---
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
    pip install -r "$dest/requirements.txt" || true
  fi
}

echo "==> Installing custom nodes..."
install_node "ComfyUI-Manager" "https://github.com/ltdrdata/ComfyUI-Manager"
install_node "ComfyUI-PixelArt-Detector" "https://github.com/dimtoneff/ComfyUI-PixelArt-Detector"
install_node "ComfyUI-TiledDiffusion" "https://github.com/shiimizu/ComfyUI-TiledDiffusion"
install_node "comfyui_controlnet_aux" "https://github.com/Fannovel16/comfyui_controlnet_aux"
install_node "ComfyUI-Advanced-ControlNet" "https://github.com/Kosinkadink/ComfyUI-Advanced-ControlNet"
install_node "ComfyUI_IPAdapter_plus" "https://github.com/cubiq/ComfyUI_IPAdapter_plus"
install_node "pixel_palette_art" "https://github.com/ranska/pixel_palette_art"
install_node "GlitchNodes" "https://github.com/pxl-pshr/GlitchNodes"
install_node "ComfyUI-AI-Pixel-Art-Enhancer" "https://github.com/HSDHCdev/ComfyUI-AI-Pixel-Art-Enhancer"
install_node "comfyui-vslinx-nodes" "https://github.com/vslinx/ComfyUI-vslinx-nodes.git"

mkdir -p models/{checkpoints,controlnet,loras,vae,ipadapter,clip_vision}

# --- Copy workflows ---
echo "==> Copying workflows..."
DEST_WF="user/default/workflows/pixel-art"
mkdir -p "$DEST_WF"
cp -r "$SCRIPT_DIR/workflows/." "$DEST_WF/"

# --- Copy bonus palettes into PixelArt-Detector ---
PAD_PALETTES="custom_nodes/ComfyUI-PixelArt-Detector/palettes/1x"
if [[ -d "$PAD_PALETTES" ]]; then
  echo "==> Copying starter palettes..."
  cp "$SCRIPT_DIR/palettes/"*.png "$PAD_PALETTES/" 2>/dev/null || true
fi

echo
echo "============================================"
echo " Setup complete!"
echo "============================================"
echo
echo " 1. Download models:"
echo "    $SCRIPT_DIR/scripts/download-models.sh $INSTALL_DIR"
echo "    (or see models.md / compatibility.md)"
echo
echo " 2. Start ComfyUI:"
echo "    cd $INSTALL_DIR"
echo "    source .venv/bin/activate"
echo "    python main.py"
echo
echo " 3. Open http://127.0.0.1:8188 and drag a workflow JSON from:"
echo "    $DEST_WF/"
echo
echo " Recommended first workflow: sdxl-tile-europe-map.json"
echo " (large canvas — needs tile ControlNet + TiledDiffusion)"
echo
echo " Already have ComfyUI elsewhere? Use pull-packs.sh instead of setup.sh"
echo
