# Models for pixel art workflows

These files are **not** bundled (they are multi-GB). Download manually and place in the paths shown.

## Required for SDXL text-to-image workflow

| File | Put in | Source |
|------|--------|--------|
| `sd_xl_base_1.0_0.9vae.safetensors` (or any SDXL 1.0 base) | `ComfyUI/models/checkpoints/` | [Hugging Face – stabilityai/stable-diffusion-xl-base-1.0](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0) |
| `pixel-art-xl.safetensors` | `ComfyUI/models/loras/` | [Civitai – Pixel Art XL LoRA](https://civitai.com/models/120096/pixel-art-xl) |

Any SDXL checkpoint works; rename in the workflow node if yours differs.

## Optional but useful

| File | Put in | Notes |
|------|--------|-------|
| `pixel-art-flux.safetensors` | `ComfyUI/models/loras/` | Flux pixel art LoRA if you use Flux checkpoints |
| `4x-UltraSharp.pth` | `ComfyUI/models/upscale_models/` | For non-pixel upscaling before quantize step |
| SD 1.5 pixel checkpoints | `ComfyUI/models/checkpoints/` | Smaller/faster; search Civitai for "pixel art" checkpoint |

## VRAM guide

| Setup | Approx VRAM |
|-------|-------------|
| SDXL txt2img @ 1024, batch 1 | 8–12 GB |
| Img2pixel post-process only | 2–4 GB |
| PixelArt Detector palette swap | 2–4 GB |

Use `--lowvram` or `--cpu` flags if needed:

```bash
python main.py --lowvram
```

## Prompt tips for pixel art

**Positive:** `pixel art, 16-bit, crisp pixels, limited palette, game sprite, top-down`

**Negative:** `blurry, anti-aliased, photorealistic, smooth gradients, depth of field, watermark`

Generate at native resolution (128–512 px), then upscale with **nearest-exact** — never bilinear/bicubic for final pixel output.
