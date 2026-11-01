from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image, ImageDraw


CANVAS_SIZE = 128
SCHEMES = {
    "target": {
        "subject": [(55, 47, 58), (67, 59, 70), (88, 80, 91)],
        "fill": (211, 216, 217),
        "dither": (228, 233, 234),
        "outline": (88, 129, 131),
        "inner": (106, 147, 149),
    },
    # Every color below is taken exactly from pixel-1-24-1x.png.
    "germany": {
        "subject": [(0, 0, 0), (67, 52, 85), (110, 105, 98)],
        "fill": (197, 204, 184),
        "dither": (154, 154, 151),
        "outline": (93, 104, 114),
        "inner": (110, 105, 98),
    },
    "allies": {
        "subject": [(85, 112, 100), (110, 170, 120), (147, 161, 103)],
        "fill": (197, 204, 184),
        "dither": (154, 154, 151),
        "outline": (0, 0, 0),
        "inner": (56, 112, 128),
    },
}
PROFILE_BOXES = {
    "infantry": (66, 52, 77),
    "vehicle": (80, 46, 76),
    "artillery": (90, 38, 72),
}


def _tensor_to_rgb(image: torch.Tensor) -> np.ndarray:
    array = image.detach().cpu().numpy()
    return np.clip(np.rint(array[..., :3] * 255.0), 0, 255).astype(np.uint8)


def _mask_to_numpy(mask: torch.Tensor, batch_size: int) -> np.ndarray:
    array = mask.detach().cpu().numpy()
    if array.ndim == 2:
        array = array[None, ...]
    if len(array) < batch_size:
        array = np.repeat(array[-1:, ...], batch_size, axis=0)
    return np.clip(array[:batch_size], 0.0, 1.0)


def _pick_component(foreground: np.ndarray, component_percent: float) -> np.ndarray:
    count, labels, stats, _ = cv2.connectedComponentsWithStats(
        foreground.astype(np.uint8), connectivity=8
    )
    if count <= 1:
        return foreground

    image_height, image_width = foreground.shape
    candidates: list[tuple[float, int, int, bool]] = []
    for label in range(1, count):
        x, y, width, height, area = stats[label]
        if area <= 0:
            continue
        fill_ratio = area / max(width * height, 1)
        score = area * max(fill_ratio, 0.01) ** 0.5
        aspect = width / max(height, 1)
        center_y = min(y + height // 2, image_height - 1)
        center_x = min(x + width // 2, image_width - 1)
        ring_like = (
            area > 1000
            and 0.75 < aspect < 1.33
            and fill_ratio < 0.25
            and labels[center_y, center_x] != label
        )
        frame_like = ring_like
        candidates.append((score, area, label, frame_like))

    if not candidates:
        return foreground

    usable = [candidate for candidate in candidates if not candidate[3]]
    if not usable:
        usable = candidates
    _, largest_area, selected_label, _ = max(usable)
    selected = labels == selected_label

    # Retain significant detached weapon, smoke, mast, and wheel pieces while
    # excluding old circular frames and tiny background noise.
    for _, area, label, frame_like in usable:
        if not frame_like and area >= max(4, largest_area * component_percent):
            selected |= labels == label
    return selected


def _auto_profile(width: int, height: int) -> str:
    aspect = width / max(height, 1)
    if aspect >= 1.8:
        return "artillery"
    if aspect >= 1.15:
        return "vehicle"
    return "infantry"


def _make_template(faction_scheme: str = "target") -> Image.Image:
    scheme = SCHEMES.get(faction_scheme, SCHEMES["target"])
    image = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE))
    draw = ImageDraw.Draw(image)
    draw.ellipse(
        (18, 17, 108, 80),
        fill=(*scheme["fill"], 255),
        outline=(*scheme["outline"], 255),
        width=2,
    )
    draw.ellipse(
        (20, 19, 106, 78),
        outline=(*scheme["inner"], 255),
        width=1,
    )
    array = np.array(image)
    yy, xx = np.indices((CANVAS_SIZE, CANVAS_SIZE))
    interior = (
        (array[:, :, 3] == 255)
        & np.all(array[:, :, :3] == scheme["fill"], axis=2)
        & (xx > 22)
        & (xx < 104)
        & (yy > 22)
        & (yy < 76)
    )
    array[(xx % 2 == 0) & (yy % 2 == 0) & interior, :3] = scheme["dither"]
    return Image.fromarray(array, "RGBA")


def _load_template(faction_scheme: str = "target") -> np.ndarray:
    package_path = Path(__file__).resolve().parent / "assets" / "unit-icon-template-128.png"
    project_path = Path(__file__).resolve().parents[2] / "assets" / "unit-icon-template-128.png"
    if faction_scheme == "target":
        for path in (package_path, project_path):
            if path.is_file():
                return np.asarray(Image.open(path).convert("RGBA"), dtype=np.float32) / 255.0
    return np.asarray(_make_template(faction_scheme), dtype=np.float32) / 255.0


class UnitIconNormalize:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "source_mask": ("MASK",),
                "profile": (["auto", "infantry", "vehicle", "artillery"],),
                "faction_scheme": (["target", "germany", "allies"],),
                "subject_threshold": (
                    "FLOAT",
                    {"default": 0.38, "min": 0.05, "max": 0.9, "step": 0.01},
                ),
                "component_percent": (
                    "FLOAT",
                    {"default": 0.02, "min": 0.0, "max": 0.25, "step": 0.005},
                ),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING", "STRING")
    RETURN_NAMES = ("subject", "transparency_mask", "profile_used", "faction_scheme")
    FUNCTION = "normalize"
    CATEGORY = "image/unit icons"

    def normalize(
        self,
        image: torch.Tensor,
        source_mask: torch.Tensor,
        profile: str,
        faction_scheme: str,
        subject_threshold: float,
        component_percent: float,
    ):
        rgb_batch = _tensor_to_rgb(image)
        mask_batch = _mask_to_numpy(source_mask, len(rgb_batch))
        output_images = []
        output_masks = []
        profiles = []
        template_support = _load_template(faction_scheme)[:, :, 3] > 0.5
        subject_colors = np.asarray(SCHEMES[faction_scheme]["subject"], dtype=np.uint8)

        for rgb, source_transparency in zip(rgb_batch, mask_batch):
            luminance = (
                rgb[:, :, 0] * 0.2126
                + rgb[:, :, 1] * 0.7152
                + rgb[:, :, 2] * 0.0722
            ) / 255.0
            visible = source_transparency < 0.5
            foreground = visible & (luminance < subject_threshold)
            # Two-tone / illustrated references are mid-tone greens on real alpha,
            # so luminance cutoff can empty the mask. Fall back to opaque pixels.
            if not foreground.any() and visible.any() and source_transparency.max() >= 0.5:
                foreground = visible
            foreground = _pick_component(foreground, component_percent)

            ys, xs = np.where(foreground)
            if len(xs) == 0:
                raise ValueError(
                    "No subject detected. Raise subject_threshold or check the source alpha."
                )

            left, top, right, bottom = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
            crop_mask = foreground[top:bottom, left:right]
            crop_rgb = rgb[top:bottom, left:right]
            crop_height, crop_width = crop_mask.shape
            selected_profile = profile if profile != "auto" else _auto_profile(crop_width, crop_height)
            max_width, max_height, baseline = PROFILE_BOXES[selected_profile]

            scale = min(max_width / crop_width, max_height / crop_height)
            width = max(1, int(round(crop_width * scale)))
            height = max(1, int(round(crop_height * scale)))

            mask_image = Image.fromarray((crop_mask * 255).astype(np.uint8), "L")
            for _ in range(24):
                resized_mask = mask_image.resize((width, height), Image.Resampling.LANCZOS)
                alpha = np.asarray(resized_mask, dtype=np.float32) / 255.0
                x = (CANVAS_SIZE - width) // 2
                preferred_y = baseline - height
                best_outside = None
                y = preferred_y
                for shift in range(-10, 3):
                    candidate_y = int(np.clip(preferred_y + shift, 0, CANVAS_SIZE - height))
                    support = template_support[
                        candidate_y : candidate_y + height, x : x + width
                    ]
                    outside = np.count_nonzero((alpha > 0.2) & ~support)
                    score = (outside, abs(shift))
                    if best_outside is None or score < best_outside:
                        best_outside = score
                        y = candidate_y
                if best_outside[0] == 0 or width <= 8 or height <= 8:
                    break
                width = max(1, int(round(width * 0.95)))
                height = max(1, int(round(height * 0.95)))
            alpha = (alpha >= 0.5).astype(np.float32)

            crop_luma = (
                crop_rgb[:, :, 0] * 0.2126
                + crop_rgb[:, :, 1] * 0.7152
                + crop_rgb[:, :, 2] * 0.0722
            ).astype(np.uint8)
            resized_luma = np.asarray(
                Image.fromarray(crop_luma, "L").resize((width, height), Image.Resampling.LANCZOS)
            )
            levels = np.zeros_like(resized_luma, dtype=np.uint8)
            levels[resized_luma > 75] = 1
            levels[resized_luma > 145] = 2
            subject_rgb = subject_colors[levels]

            canvas_rgb = np.zeros((CANVAS_SIZE, CANVAS_SIZE, 3), dtype=np.float32)
            canvas_alpha = np.zeros((CANVAS_SIZE, CANVAS_SIZE), dtype=np.float32)
            canvas_rgb[y : y + height, x : x + width] = subject_rgb / 255.0
            canvas_alpha[y : y + height, x : x + width] = alpha

            output_images.append(canvas_rgb)
            output_masks.append(1.0 - canvas_alpha)
            profiles.append(selected_profile)

        return (
            torch.from_numpy(np.stack(output_images)).float(),
            torch.from_numpy(np.stack(output_masks)).float(),
            ", ".join(profiles),
            faction_scheme,
        )


class UnitIconCompose:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "subject": ("IMAGE",),
                "transparency_mask": ("MASK",),
                "faction_scheme": ("STRING", {"forceInput": True}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "compose"
    CATEGORY = "image/unit icons"

    def compose(
        self,
        subject: torch.Tensor,
        transparency_mask: torch.Tensor,
        faction_scheme: str,
    ):
        subject_np = np.clip(subject.detach().cpu().numpy()[..., :3], 0.0, 1.0)
        masks = _mask_to_numpy(transparency_mask, len(subject_np))
        template = _load_template(faction_scheme)
        template_rgb = template[:, :, :3]
        template_alpha = template[:, :, 3]
        outputs = []

        for subject_rgb, mask in zip(subject_np, masks):
            subject_alpha = (1.0 - mask) * (template_alpha > 0.0)
            output_alpha = subject_alpha + template_alpha * (1.0 - subject_alpha)
            premultiplied = (
                subject_rgb * subject_alpha[:, :, None]
                + template_rgb
                * template_alpha[:, :, None]
                * (1.0 - subject_alpha[:, :, None])
            )
            output_rgb = np.divide(
                premultiplied,
                np.maximum(output_alpha[:, :, None], 1e-8),
                out=np.zeros_like(premultiplied),
                where=output_alpha[:, :, None] > 0,
            )
            outputs.append(np.dstack((output_rgb, output_alpha)))

        return (torch.from_numpy(np.stack(outputs)).float(),)


NODE_CLASS_MAPPINGS = {
    "UnitIconNormalize": UnitIconNormalize,
    "UnitIconCompose": UnitIconCompose,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "UnitIconNormalize": "Unit Icon - Normalize Vector",
    "UnitIconCompose": "Unit Icon - Compose Target Token",
}
