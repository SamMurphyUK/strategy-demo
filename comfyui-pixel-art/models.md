# Models for pixel art workflows

Models are **not** bundled (multi-GB). Use the download script or grab manually.

## One-command download

```bash
# Required models only (~15 GB)
./scripts/download-models.sh /path/to/ComfyUI --required-only

# Required + recommended (reference, style, LoRA)
./scripts/download-models.sh /path/to/ComfyUI
```

See `models-manifest.json` for machine-readable URLs.

---

## Required models

| File | Put in | Purpose |
|------|--------|---------|
| `sd_xl_base_1.0.safetensors` | `models/checkpoints/` | SDXL base generation |
| `sd_xl_refiner_1.0.safetensors` | `models/checkpoints/` | SDXL refiner pass for detail |
| `controlnet-tile-sdxl.safetensors` | `models/controlnet/` | **Key model** — tile detail on large canvases without blur |

**Sources:**
- Base: [stabilityai/stable-diffusion-xl-base-1.0](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0)
- Refiner: [stabilityai/stable-diffusion-xl-refiner-1.0](https://huggingface.co/stabilityai/stable-diffusion-xl-refiner-1.0)
- Tile CN: [xinsir/controlnet-tile-sdxl-1.0](https://huggingface.co/xinsir/controlnet-tile-sdxl-1.0) (saved as `controlnet-tile-sdxl.safetensors`)

---

## Recommended (Europe map workflow)

| File | Put in | Purpose |
|------|--------|---------|
| `controlnet-reference-sdxl.safetensors` | `models/controlnet/` | Lock style/composition to your Europe map reference |
| `controlnet-style-sdxl.safetensors` | `models/controlnet/` | Keep palette + shading consistent across tiles |
| `pixel-art-xl.safetensors` | `models/loras/` | Pixel art style LoRA |

**Sources:**
- Reference: [xinsir/controlnet-union-sdxl-1.0 ProMax](https://huggingface.co/xinsir/controlnet-union-sdxl-1.0) → `diffusion_pytorch_model_promax.safetensors`
- Style: [kohya_controllllite_xl_blur](https://huggingface.co/lllyasviel/sd_control_collection/resolve/main/kohya_controllllite_xl_blur.safetensors)
- LoRA: [Civitai Pixel Art XL](https://civitai.com/models/120096/pixel-art-xl)

See **[compatibility.md](compatibility.md)** for how these names map to upstream repos.

---

## tiled_vae — not a file

`tiled_vae.safetensors` does **not** exist as a downloadable weight. Install the custom node instead:

```bash
./pull-packs.sh /path/to/ComfyUI   # installs ComfyUI-TiledDiffusion
```

Or use ComfyUI's built-in **VAE Encode/Decode (Tiled)** nodes.

---

## Optional: IP-Adapter (alternative reference lock)

| File | Put in |
|------|--------|
| `ip-adapter-plus_sdxl_vit-h.safetensors` | `models/ipadapter/` |
| `clip_vision_g.safetensors` | `models/clip_vision/` |

Better for pure "match this reference image" style transfer. Downloaded automatically by `download-models.sh` (non `--required-only`).

---

## VRAM guide

| Setup | Approx VRAM |
|-------|-------------|
| SDXL txt2img @ 1024 | 8–12 GB |
| Tile workflow @ 2048 | 12–16 GB |
| Tile + refiner @ 2048 | 16–24 GB |
| Img2pixel post-process only | 2–4 GB |

```bash
python main.py --lowvram
```

## Prompt tips

**Positive:** `pixel art, top-down strategy map, europe, crisp pixels, limited palette, game board`

**Negative:** `blurry, anti-aliased, photorealistic, smooth gradients, watermark`

Always use **nearest-exact** for final pixel upscale — never bilinear.
