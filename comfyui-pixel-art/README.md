# ComfyUI Pixel Art Starter Pack

Everything you need to build a **local pixel art workflow** in ComfyUI: install scripts, ready-made workflow JSONs, retro palettes, and model download links.

## Already have ComfyUI? Start here

```bash
git clone https://github.com/SamMurphyUK/strategy-demo.git
cd strategy-demo/comfyui-pixel-art

# 1. Pull all custom node packs + workflows (no ComfyUI reinstall)
COMFYUI_DIR=/path/to/your/ComfyUI ./pull-packs.sh

# 2. Download models (SDXL base/refiner + ControlNet tile + optional reference/style)
./scripts/download-models.sh /path/to/your/ComfyUI

# 3. Verify compatibility
./scripts/verify-setup.sh /path/to/your/ComfyUI
```

Restart ComfyUI, then load `workflows/sdxl-tile-europe-map.json`.

See **[compatibility.md](compatibility.md)** for how cloud model names map to local files.

## Quick start (fresh install)

### Option A — full setup (no existing ComfyUI)

On Windows: `.\setup.ps1`  
On Linux/macOS: `chmod +x setup.sh && ./setup.sh`

### Option B — copy workflows manually

Copy `workflows/` into your ComfyUI install:

```
ComfyUI/user/default/workflows/pixel-art/
```

Then drag any `.json` file into the ComfyUI browser.

---

## What's included

### Workflows (`workflows/`)

| File | What it does | Custom nodes needed |
|------|----------------|---------------------|
| `sdxl-pixel-art-txt2img.json` | Generate pixel art from a text prompt (SDXL + LoRA, nearest upscale) | Built-in only |
| `sdxl-tile-europe-map.json` | Large-canvas tile upscale with ControlNet tile + tiled VAE | TiledDiffusion, controlnet_aux, Advanced-ControlNet |
| `img2pixel-nearest-only.json` | Quick downscale/upscale pixelate on any image | Built-in only |
| `workflow.json` | Full PixelArt Detector pipeline (quantize, palette, save) | PixelArt-Detector |
| `palette_generator.json` | Extract a palette from a reference image | PixelArt-Detector |
| `grid.json` | Preview all loaded palettes in a grid | PixelArt-Detector |
| `img2img_webp.json` | Img2img + pixel post-process | PixelArt-Detector |
| `palette-art/*.json` | Palette build/mix/sort pipelines | pixel_palette_art |

### Palettes (`palettes/`)

8 classic 1-pixel-wide palette strips (DawnBringer 32, PICO-8, Sweetie 16, Endesga 32, Game Boy variants). Copy into:

```
ComfyUI/custom_nodes/ComfyUI-PixelArt-Detector/palettes/1x/
```

The setup script does this automatically.

### Custom nodes (installed by `pull-packs.sh` or `setup.sh`)

| Node pack | Purpose |
|-----------|---------|
| [ComfyUI-Manager](https://github.com/ltdrdata/ComfyUI-Manager) | Install/update nodes from the UI |
| [ComfyUI-PixelArt-Detector](https://github.com/dimtoneff/ComfyUI-PixelArt-Detector) | Palette swap, downscale, dither, pixel-perfect output |
| [ComfyUI-TiledDiffusion](https://github.com/shiimizu/ComfyUI-TiledDiffusion) | **tiled_vae** + tiled diffusion for large canvases |
| [comfyui_controlnet_aux](https://github.com/Fannovel16/comfyui_controlnet_aux) | TilePreprocessor for ControlNet tile |
| [ComfyUI-Advanced-ControlNet](https://github.com/Kosinkadink/ComfyUI-Advanced-ControlNet) | Union/reference ControlNet stacking |
| [ComfyUI_IPAdapter_plus](https://github.com/cubiq/ComfyUI_IPAdapter_plus) | Alternative reference style lock |
| [pixel_palette_art](https://github.com/ranska/pixel_palette_art) | Build and export palettes |
| [GlitchNodes](https://github.com/pxl-pshr/GlitchNodes) | Pixel8Bit + retro dithering |
| [ComfyUI-AI-Pixel-Art-Enhancer](https://github.com/HSDHCdev/ComfyUI-AI-Pixel-Art-Enhancer) | AI → pixel art conversion |
| [comfyui-vslinx-nodes](https://github.com/vslinx/ComfyUI-vslinx-nodes) | Image to Pixel Art with historical palettes |

See `manifest.json` for the full machine-readable list.

---

## Models you still need to download

Models are too large to bundle. Use the download script:

```bash
./scripts/download-models.sh /path/to/ComfyUI --required-only   # base + refiner + tile CN
./scripts/download-models.sh /path/to/ComfyUI                   # + reference, style, LoRA
```

Or see **[models.md](models.md)** and **[compatibility.md](compatibility.md)** for manual links.

**Your model stack:**

| Model | Required |
|-------|----------|
| `sd_xl_base_1.0.safetensors` | Yes |
| `sd_xl_refiner_1.0.safetensors` | Yes |
| `controlnet-tile-sdxl.safetensors` | Yes (key model) |
| `controlnet-reference-sdxl.safetensors` | Recommended |
| `controlnet-style-sdxl.safetensors` | Recommended |
| `tiled_vae` | Custom node, not a file |

---

## Recommended workflow order

```
1. setup.sh          → install ComfyUI + nodes
2. Download models   → see models.md
3. python main.py    → start server
4. Load sdxl-pixel-art-txt2img.json
5. Tweak prompt, run
6. Chain into workflow.json for palette lock + dither
```

### Typical pixel art pipeline

```mermaid
flowchart LR
    A[Text prompt] --> B[SDXL + Pixel LoRA]
    B --> C[Generate small latent]
    C --> D[VAE decode]
    D --> E[Nearest downscale]
    E --> F[Nearest upscale]
    F --> G[PixelArt Detector]
    G --> H[Palette converter]
    H --> I[Save PNG]
```

For **img2img** or **photo → pixel art**, start with `img2pixel-nearest-only.json` or the AI Pixel Art Enhancer node.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Red/missing nodes after load | Run `setup.sh` again; install missing node via ComfyUI Manager |
| Out of VRAM | `python main.py --lowvram` or use smaller resolution (512×512) |
| Blurry output | Ensure all scale nodes use `nearest-exact`, not bilinear |
| LoRA not found | Download `pixel-art-xl.safetensors` to `models/loras/` |
| Checkpoint not found | Pick your SDXL file in the CheckpointLoader node |

---

## File origins

Workflow JSONs are sourced from:

- [dimtoneff/ComfyUI-PixelArt-Detector](https://github.com/dimtoneff/ComfyUI-PixelArt-Detector) (MIT)
- [ranska/pixel_palette_art](https://github.com/ranska/pixel_palette_art)
- [appliedintelligencelab SDXL pixel art gist](https://gist.github.com/appliedintelligencelab/ca9a4e18dde220d394f10b3f22e9c2ba)

Palettes from ComfyUI-PixelArt-Detector's bundled set.

---

## Requirements

- Python 3.10+
- Git
- NVIDIA GPU with 8+ GB VRAM recommended (CPU works for post-process only)
- ~15 GB disk for ComfyUI + one SDXL checkpoint
