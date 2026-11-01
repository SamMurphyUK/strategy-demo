# Input image spec for `pixel-icon-vector2circle.json`

## Files (ready to use)

| File | Purpose |
|------|---------|
| `assets/vector_export.png` | Sample unit silhouette — load this in ComfyUI node 1 |
| `assets/vector_export_with_guide.png` | Same art + red safe-circle overlay (for layout reference only) |
| `assets/circle-mask-128.png` | 128×128 circular alpha mask (auto-loaded in workflow) |

These are copied to your ComfyUI `input/` folder when you run the deploy script or manually copy.

## Image requirements (your own SVG/art)

Export or save as **`vector_export.png`** in ComfyUI's `input/` folder:

| Rule | Value |
|------|--------|
| Size | **1024 × 1024** px |
| Background | **Transparent** |
| Content | **Centered** on canvas |
| Safe area | Keep all art **inside a circle ~800px diameter** (center of canvas) |
| Format | PNG with alpha |

If art touches the square corners, the circle mask will clip it.

## Quick test

1. Load `pixel-icon-vector2circle.json` in ComfyUI
2. Node 1 should already point to `vector_export.png`
3. Run → output `unit-icon-128-circle_*.png`

## Your own vector

```powershell
.\comfyui-pixel-art\scripts\export-svg-for-icon.ps1 C:\path\to\unit.svg
```

Or in Inkscape: Export PNG 1024×1024, transparent background, fit page to selection centered on square canvas.
