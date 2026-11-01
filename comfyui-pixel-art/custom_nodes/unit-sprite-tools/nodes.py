import numpy as np
import torch
import cv2


KEY_BACKGROUND = np.array([255, 0, 255], dtype=np.uint8)
TWO_TONE_PALETTES = {
    "allies": ((85, 112, 100), (110, 170, 120)),
    "germany": ((67, 52, 85), (110, 105, 98)),
    "neutral": ((93, 104, 114), (197, 204, 184)),
}


def _mask_to_numpy(mask: torch.Tensor, batch_size: int) -> np.ndarray:
    array = mask.detach().cpu().numpy()
    if array.ndim == 2:
        array = array[None, ...]
    if array.ndim == 4:
        array = array[..., 0]
    if len(array) == 1 and batch_size > 1:
        array = np.repeat(array, batch_size, axis=0)
    return np.clip(array, 0.0, 1.0)


class UnitSpriteKeyBackground:
    """Place a normalized unit on an exact, collision-safe chroma key."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "subject": ("IMAGE",),
                "transparency_mask": ("MASK",),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("keyed_sprite",)
    FUNCTION = "compose"
    CATEGORY = "image/unit sprite"

    def compose(self, subject: torch.Tensor, transparency_mask: torch.Tensor):
        subject_np = np.clip(subject.detach().cpu().numpy()[..., :3], 0.0, 1.0)
        masks = _mask_to_numpy(transparency_mask, len(subject_np))
        key_rgb = KEY_BACKGROUND.astype(np.float32) / 255.0
        outputs = []

        for source, mask in zip(subject_np, masks):
            subject_pixels = (1.0 - mask) >= 0.5
            output = np.broadcast_to(key_rgb, source.shape).copy()
            output[subject_pixels] = source[subject_pixels]
            outputs.append(output)

        return (torch.from_numpy(np.stack(outputs)).float(),)


class UnitReferenceTwoTone:
    """Posterize generated reference art to two exact Pixel1 colors."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "foreground_mask": ("MASK",),
                "palette": (["allies", "germany", "neutral"],),
                "shadow_percent": (
                    "FLOAT",
                    {"default": 0.45, "min": 0.1, "max": 0.9, "step": 0.01},
                ),
                "outline_width": (
                    "INT",
                    {"default": 8, "min": 0, "max": 32, "step": 1},
                ),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("transparent_reference", "foreground_mask")
    FUNCTION = "posterize"
    CATEGORY = "image/unit sprite"

    def posterize(
        self,
        image: torch.Tensor,
        foreground_mask: torch.Tensor,
        palette: str,
        shadow_percent: float,
        outline_width: int,
    ):
        images = np.clip(image.detach().cpu().numpy()[..., :3], 0.0, 1.0)
        masks = _mask_to_numpy(foreground_mask, len(images))
        shadow_rgb, base_rgb = (
            np.asarray(color, dtype=np.float32) / 255.0
            for color in TWO_TONE_PALETTES[palette]
        )
        rgba_outputs = []
        mask_outputs = []

        for source, mask in zip(images, masks):
            alpha = np.clip(mask, 0.0, 1.0).astype(np.float32)
            hard = alpha >= 0.5
            rgba = np.zeros((*source.shape[:2], 4), dtype=np.float32)

            if hard.any():
                luminance = (
                    source[:, :, 0] * 0.2126
                    + source[:, :, 1] * 0.7152
                    + source[:, :, 2] * 0.0722
                )
                threshold = float(
                    np.quantile(luminance[hard], np.clip(shadow_percent, 0.1, 0.9))
                )
                shadow = hard & (luminance <= threshold)

                if outline_width > 0:
                    kernel_size = outline_width * 2 + 1
                    kernel = np.ones((kernel_size, kernel_size), dtype=np.uint8)
                    eroded = cv2.erode(hard.astype(np.uint8), kernel) > 0
                    shadow |= hard & ~eroded

                rgba[hard, :3] = base_rgb
                rgba[shadow, :3] = shadow_rgb
                rgba[:, :, 3] = hard.astype(np.float32)

            rgba_outputs.append(rgba)
            mask_outputs.append(alpha)

        return (
            torch.from_numpy(np.stack(rgba_outputs)).float(),
            torch.from_numpy(np.stack(mask_outputs)).float(),
        )


NODE_CLASS_MAPPINGS = {
    "UnitSpriteKeyBackground": UnitSpriteKeyBackground,
    "UnitReferenceTwoTone": UnitReferenceTwoTone,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "UnitSpriteKeyBackground": "Unit Sprite - Flat Key Background",
    "UnitReferenceTwoTone": "Unit Reference - Pixel1 Two Tone",
}
