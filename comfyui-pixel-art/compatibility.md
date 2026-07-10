# Model & node compatibility guide

This documents how the cloud workflow model names map to local ComfyUI, and which custom nodes are required for each piece.

## Your model list → local setup

| Cloud / workflow name | Type | Local path | Source |
|----------------------|------|------------|--------|
| `sd_xl_base_1.0.safetensors` | Checkpoint | `models/checkpoints/` | [stabilityai/stable-diffusion-xl-base-1.0](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0) |
| `sd_xl_refiner_1.0.safetensors` | Checkpoint | `models/checkpoints/` | [stabilityai/stable-diffusion-xl-refiner-1.0](https://huggingface.co/stabilityai/stable-diffusion-xl-refiner-1.0) |
| `controlnet-tile-sdxl.safetensors` | ControlNet | `models/controlnet/` | [xinsir/controlnet-tile-sdxl-1.0](https://huggingface.co/xinsir/controlnet-tile-sdxl-1.0) |
| `controlnet-reference-sdxl.safetensors` | ControlNet | `models/controlnet/` | [xinsir/controlnet-union-sdxl-1.0 ProMax](https://huggingface.co/xinsir/controlnet-union-sdxl-1.0) |
| `controlnet-style-sdxl.safetensors` | ControlNet | `models/controlnet/` | [kohya blur LLLite](https://huggingface.co/lllyasviel/sd_control_collection/resolve/main/kohya_controllllite_xl_blur.safetensors) |
| `tiled_vae.safetensors` | **Not a file** | Custom node | See below |

## tiled_vae — important

`tiled_vae` is **not** a downloadable `.safetensors` weight. It is a **processing method** implemented as custom nodes:

| Option | Install | Nodes |
|--------|---------|-------|
| **Recommended** | `ComfyUI-TiledDiffusion` (via `pull-packs.sh`) | `VAEEncodeTiled_TiledDiffusion`, `VAEDecodeTiled_TiledDiffusion`, `TiledDiffusion` |
| **Built-in fallback** | Already in ComfyUI core | `VAE Encode (Tiled)`, `VAE Decode (Tiled)` |

Use tiled VAE whenever your canvas exceeds ~1024×1024 or you hit OOM during decode.

## controlnet-reference-sdxl

Cloud workflows use this name to lock generation to a reference image (e.g. your Europe strategy map).

**Mapped to:** `xinsir/controlnet-union-sdxl-1.0` **ProMax** (`diffusion_pytorch_model_promax.safetensors`), saved as `controlnet-reference-sdxl.safetensors`.

This is a union ControlNet supporting multiple control types in one weight file. Requires:

- `ComfyUI-Advanced-ControlNet` custom node
- Feed your Europe map as the control image

**Alternative for pure style matching:** IP-Adapter Plus (also installed by `pull-packs.sh`):

| File | Path |
|------|------|
| `ip-adapter-plus_sdxl_vit-h.safetensors` | `models/ipadapter/` |
| `clip_vision_g.safetensors` | `models/clip_vision/` |

Use `IPAdapter Apply` nodes instead of `ControlNetLoader` for reference-style locking.

## controlnet-style-sdxl

Keeps palette and shading consistent across tiled passes.

**Mapped to:** `kohya_controllllite_xl_blur.safetensors` from lllyasviel's collection, saved as `controlnet-style-sdxl.safetensors`.

This is a lightweight Control-LLLite model (~370 MB). It pairs with the tile ControlNet: tile adds detail per region, blur/style control maintains cohesive color and tone.

## Required custom nodes for full stack

| Node pack | Why |
|-----------|-----|
| `ComfyUI-TiledDiffusion` | tiled_vae + tiled diffusion on large maps |
| `comfyui_controlnet_aux` | `TilePreprocessor` for tile controlnet input |
| `ComfyUI-Advanced-ControlNet` | Union/reference multi-controlnet |
| `ComfyUI-PixelArt-Detector` | Final palette lock + pixel-perfect output |
| `ComfyUI_IPAdapter_plus` | Optional: reference style from Europe map |

## Compatibility matrix

| Component | SDXL 1.0 base | SDXL refiner | Tile CN | Works together |
|-----------|---------------|--------------|---------|----------------|
| Base + refiner | ✓ | ✓ (switch at 0.6–0.8) | ✓ | Standard SDXL two-pass |
| Tile ControlNet | ✓ | ✓ | — | Use strength 0.5–0.8 |
| Union/reference CN | ✓ | ✓ | ✓ | Stack via Advanced ControlNet |
| Style blur LLLite | ✓ | ✓ | ✓ | Lower strength (0.3–0.5) |
| Tiled VAE | ✓ | ✓ | — | Required for large output |
| Pixel-art LoRA | ✓ | optional | ✓ | Apply on base pass only |

## VRAM estimates (tile workflow, 2048×2048)

| GPU VRAM | Settings |
|----------|----------|
| 12 GB | tile_size 512, batch 1, `--lowvram` |
| 16 GB | tile_size 768, refiner at 0.7 |
| 24 GB+ | tile_size 1024, full refiner pass |

## Quick commands (existing ComfyUI)

```bash
# 1. Pull all node packs + workflows
COMFYUI_DIR=/path/to/your/ComfyUI ./pull-packs.sh

# 2. Download models (required only)
./scripts/download-models.sh /path/to/your/ComfyUI --required-only

# 3. Download recommended too (reference, style, LoRA)
./scripts/download-models.sh /path/to/your/ComfyUI

# 4. Verify everything
./scripts/verify-setup.sh /path/to/your/ComfyUI
```

Restart ComfyUI after step 1.
