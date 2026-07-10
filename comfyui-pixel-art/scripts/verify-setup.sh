#!/usr/bin/env bash
# Verify custom nodes and model files are present.
# Usage: ./verify-setup.sh [comfyui_dir]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMFY_DIR="${1:-${COMFYUI_DIR:-$HOME/ComfyUI}}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok=0
warn=0
fail=0

check_node() {
  local name="$1"
  local required="${2:-true}"
  if [[ -d "$COMFY_DIR/custom_nodes/$name" ]]; then
    echo -e "  ${GREEN}OK${NC}   node: $name"
    ok=$((ok + 1))
  elif [[ "$required" == "true" ]]; then
    echo -e "  ${RED}MISS${NC} node: $name  (run pull-packs.sh)"
    fail=$((fail + 1))
  else
    echo -e "  ${YELLOW}SKIP${NC} node: $name (optional)"
    warn=$((warn + 1))
  fi
}

check_model() {
  local path="$1"
  local label="$2"
  local required="${3:-true}"
  if [[ -f "$COMFY_DIR/$path" ]]; then
    local size
    size=$(du -h "$COMFY_DIR/$path" | cut -f1)
    echo -e "  ${GREEN}OK${NC}   model: $label ($size)"
    ok=$((ok + 1))
  elif [[ "$required" == "true" ]]; then
    echo -e "  ${RED}MISS${NC} model: $label"
    echo "         expected: $COMFY_DIR/$path"
    fail=$((fail + 1))
  else
    echo -e "  ${YELLOW}SKIP${NC} model: $label (optional)"
    warn=$((warn + 1))
  fi
}

echo "==> Verifying ComfyUI pixel-art setup"
echo "    ComfyUI: $COMFY_DIR"
echo

if [[ ! -f "$COMFY_DIR/main.py" ]]; then
  echo -e "${RED}ERROR:${NC} Not a ComfyUI directory: $COMFY_DIR"
  exit 1
fi

echo "--- Required custom nodes ---"
check_node "ComfyUI-PixelArt-Detector" true
check_node "ComfyUI-TiledDiffusion" true
check_node "comfyui_controlnet_aux" true
check_node "ComfyUI-Advanced-ControlNet" true
check_node "ComfyUI-Manager" false

echo
echo "--- Optional custom nodes ---"
check_node "GlitchNodes" false
check_node "pixel_palette_art" false
check_node "ComfyUI_IPAdapter_plus" false
check_node "ComfyUI-AI-Pixel-Art-Enhancer" false

echo
echo "--- Required models ---"
check_model "models/checkpoints/sd_xl_base_1.0.safetensors" "sd_xl_base_1.0.safetensors" true
check_model "models/checkpoints/sd_xl_refiner_1.0.safetensors" "sd_xl_refiner_1.0.safetensors" true
check_model "models/controlnet/controlnet-tile-sdxl.safetensors" "controlnet-tile-sdxl.safetensors" true

echo
echo "--- Recommended models ---"
check_model "models/controlnet/controlnet-reference-sdxl.safetensors" "controlnet-reference-sdxl.safetensors" false
check_model "models/controlnet/controlnet-style-sdxl.safetensors" "controlnet-style-sdxl.safetensors" false
check_model "models/loras/pixel-art-xl.safetensors" "pixel-art-xl LoRA" false

echo
echo "--- tiled_vae (node, not file) ---"
if [[ -d "$COMFY_DIR/custom_nodes/ComfyUI-TiledDiffusion" ]]; then
  echo -e "  ${GREEN}OK${NC}   tiled_vae via ComfyUI-TiledDiffusion node"
  ok=$((ok + 1))
else
  echo -e "  ${RED}MISS${NC} tiled_vae — install ComfyUI-TiledDiffusion"
  echo "         (ComfyUI core also has built-in VAE Encode/Decode Tiled nodes)"
  fail=$((fail + 1))
fi

echo
echo "--- Workflows ---"
if [[ -d "$COMFY_DIR/user/default/workflows/pixel-art" ]]; then
  count=$(find "$COMFY_DIR/user/default/workflows/pixel-art" -name '*.json' | wc -l)
  echo -e "  ${GREEN}OK${NC}   $count workflow JSON files in user/default/workflows/pixel-art/"
  ok=$((ok + 1))
else
  echo -e "  ${YELLOW}WARN${NC} workflows not copied — run pull-packs.sh"
  warn=$((warn + 1))
fi

echo
echo "============================================"
if [[ $fail -eq 0 ]]; then
  echo -e " ${GREEN}Ready to run${NC} ($ok ok, $warn optional missing)"
  exit 0
else
  echo -e " ${RED}$fail required item(s) missing${NC} ($ok ok, $warn optional)"
  echo " Run: $PACK_DIR/pull-packs.sh $COMFY_DIR"
  echo " Then: $PACK_DIR/scripts/download-models.sh $COMFY_DIR"
  exit 1
fi
