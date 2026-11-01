---
name: pixel-icon
description: Turns a vector or source image into a fixed 128px circular pixel-art unit icon with nearest-neighbor filtering. Use when the user mentions ComfyUI, pixel icons, circular masks, vector-to-icon, unit sprites, or grey outpaint.
---

# Pixel icon

Do not rebuild this pipeline from scratch. The working graphs are already in the Godot repo and on the local ComfyUI install.

## Known-good files

Repo (start Comfy chats with this folder open: `C:\Users\sammu\Documents\Godot\strategy-demo`):

- `comfyui-pixel-art/workflows/pixel-icon-vector2circle.json` — vector to fixed-size circular pixel icon
- `comfyui-pixel-art/workflows/pixel-icon-img2icon.json` — image to icon
- `comfyui-pixel-art/workflows/pixel-icon-workflow.json` — prompt-generated icon

Local ComfyUI copies:

`C:\ComfyUI_windows_portable_nvidia\ComfyUI_windows_portable\ComfyUI\user\default\workflows\`

## Output contract

- 128px circular icon
- Nearest-neighbor filtering (no blur)
- Game displays around 48px with nearest filter
- Stop if the expanded area is grey, or if the new pixels do not match the source pixel-art style

## When a run looks wrong

1. Stop. Do not keep the same long chat.
2. New chat with three lines only: input file, this output contract, and `@` the last known-good JSON above.
3. Do not paste the same stack trace more than once until those three lines are in the prompt.
