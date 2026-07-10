#!/usr/bin/env bash
# Download SDXL + ControlNet models with workflow-compatible filenames.
# Usage: ./download-models.sh [comfyui_dir] [--required-only] [--skip-civitai]
#
# Requires: curl or wget, python3 (for manifest parsing)
# Optional: huggingface-cli (hf download) for resumable downloads

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMFY_DIR="${1:-${COMFYUI_DIR:-$HOME/ComfyUI}}"
REQUIRED_ONLY=false
SKIP_CIVITAI=false

for arg in "$@"; do
  case "$arg" in
    --required-only) REQUIRED_ONLY=true ;;
    --skip-civitai) SKIP_CIVITAI=true ;;
  esac
done

# If first arg is a flag, reset COMFY_DIR
if [[ "${1:-}" == --* ]]; then
  COMFY_DIR="${COMFYUI_DIR:-$HOME/ComfyUI}"
fi

if [[ ! -d "$COMFY_DIR" ]]; then
  echo "ERROR: ComfyUI directory not found: $COMFY_DIR"
  exit 1
fi

download_file() {
  local url="$1"
  local dest="$2"
  local label="${3:-$(basename "$dest")}"

  if [[ -f "$dest" ]]; then
    local size
    size=$(du -h "$dest" | cut -f1)
    echo "  [skip] $label already exists ($size)"
    return 0
  fi

  mkdir -p "$(dirname "$dest")"
  echo "  [get]  $label"
  echo "         -> $dest"

  if command -v hf >/dev/null 2>&1; then
    # hf download works for HF URLs when given repo/file form; fall back to curl
    if [[ "$url" == *"huggingface.co"* ]]; then
      curl -fL --progress-bar -o "$dest" "$url" || {
        echo "  [fail] Download failed for $label"
        rm -f "$dest"
        return 1
      }
    else
      curl -fL --progress-bar -o "$dest" "$url" || return 1
    fi
  else
    curl -fL --progress-bar -o "$dest" "$url" || {
      echo "  [fail] Download failed for $label"
      rm -f "$dest"
      return 1
    }
  fi
}

process_manifest_section() {
  local section="$1"
  python3 - "$PACK_DIR/models-manifest.json" "$section" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
for m in data.get(sys.argv[2], []):
    print(f"{m['filename']}|{m['target_dir']}|{m['source_url']}|{m.get('purpose','')}")
PY
}

echo "==> Downloading models to: $COMFY_DIR"
echo

echo "--- Required models ---"
while IFS='|' read -r filename target_dir source_url purpose; do
  [[ -z "$filename" ]] && continue
  dest="$COMFY_DIR/$target_dir/$filename"
  download_file "$source_url" "$dest" "$filename" || true
done < <(process_manifest_section "required")

if [[ "$REQUIRED_ONLY" == false ]]; then
  echo
  echo "--- Recommended models ---"
  while IFS='|' read -r filename target_dir source_url purpose; do
    [[ -z "$filename" ]] && continue
    if [[ "$SKIP_CIVITAI" == true && "$source_url" == *"civitai"* ]]; then
      echo "  [skip] $filename (Civitai — download manually)"
      continue
    fi
    dest="$COMFY_DIR/$target_dir/$filename"
    download_file "$source_url" "$dest" "$filename" || true
  done < <(process_manifest_section "recommended")

  echo
  echo "--- Optional IP-Adapter (reference style lock) ---"
  while IFS='|' read -r filename target_dir source_url purpose; do
    [[ -z "$filename" ]] && continue
    dest="$COMFY_DIR/$target_dir/$filename"
    download_file "$source_url" "$dest" "$filename" || true
  done < <(python3 - "$PACK_DIR/models-manifest.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
for m in data.get("ipadapter_optional", []):
    print(f"{m['filename']}|{m['target_dir']}|{m['source_url']}|{m.get('purpose','')}")
PY
)
fi

echo
echo "============================================"
echo " Download complete"
echo "============================================"
echo
echo " Run verify: $PACK_DIR/scripts/verify-setup.sh $COMFY_DIR"
echo
echo " Note: tiled_vae is NOT a file — install via pull-packs.sh"
echo "       (ComfyUI-TiledDiffusion custom node)"
echo
