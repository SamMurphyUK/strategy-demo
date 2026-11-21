#!/usr/bin/env python3
"""Non-destructive German fighter 2.5D layer split.

Copies ger_fighter_seed1 → ger_fighter_seed1_25D, splits the airframe into
farWing / fuselage / nearWing / prop, fills wing-root stubs, writes frames,
and vectorizes the _25D variant only. Originals are never modified.
"""

from __future__ import annotations

import copy
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

WEB_ROOT = Path(__file__).resolve().parents[1]
UNITS = WEB_ROOT / "public" / "assets" / "units"
SRC_RIG = UNITS / "rigs" / "ger_fighter_seed1"
DST_RIG = UNITS / "rigs" / "ger_fighter_seed1_25D"
DST_FRAMES = UNITS / "frames" / "ger_fighter_seed1_25D"
DST_LAYER_SVGS = UNITS / "vector" / "frames" / "ger_fighter_seed1_25D"

WIDTH = 144
HEIGHT = 160
CENTER_Y = 77
WING_Y0 = 51
WING_Y1 = 103
ROOT_DILATE = 2

MILITARY_HEX = {
    "cream": "#DDCF99",
    "tan": "#CCA87B",
    "terracotta": "#B97A60",
    "crimson": "#9C524E",
    "plum": "#774251",
    "charcoal": "#4B3D44",
    "steel": "#4E5463",
    "spruce": "#5B7D73",
    "sage": "#8E9F7D",
    "taupe": "#645355",
    "feldgrau": "#8C7C79",
    "bone": "#A99C8D",
    "olive": "#7D7B62",
    "brass": "#AAA25D",
    "brown": "#846D59",
    "khaki": "#A88A5E",
}
MILITARY_RGB = {
    name: (int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16)) for name, h in MILITARY_HEX.items()
}
MILITARY_LIST = list(MILITARY_RGB.values())
CHARCOAL = MILITARY_RGB["charcoal"]
MAGENTA = (255, 0, 255)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def snapshot_tree(root: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        if path.is_file():
            out[path.relative_to(root).as_posix()] = sha256(path)
    return out


def assert_unchanged(root: Path, before: dict[str, str]) -> None:
    after = snapshot_tree(root)
    if after != before:
        raise SystemExit(f"Original assets changed under {root}")


def snap_rgb(rgb: tuple[int, int, int]) -> tuple[int, int, int]:
    best = MILITARY_LIST[0]
    best_d = 1 << 30
    for candidate in MILITARY_LIST:
        dr = int(rgb[0]) - candidate[0]
        dg = int(rgb[1]) - candidate[1]
        db = int(rgb[2]) - candidate[2]
        dist = dr * dr + dg * dg + db * db
        if dist < best_d:
            best_d = dist
            best = candidate
    return best


def load_rgba(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGBA"), dtype=np.uint8)


def save_rgba(path: Path, rgba: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(path)


def empty_rgba() -> np.ndarray:
    out = np.zeros((HEIGHT, WIDTH, 4), dtype=np.uint8)
    out[..., 0] = 255
    out[..., 1] = 0
    out[..., 2] = 255
    out[..., 3] = 255
    return out


def opaque_mask(rgba: np.ndarray) -> np.ndarray:
    return rgba[..., 3] > 128


def interpolate_body_spans(opaque: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    left = np.full(HEIGHT, -1, dtype=np.int32)
    right = np.full(HEIGHT, -1, dtype=np.int32)
    for y in list(range(0, WING_Y0)) + list(range(WING_Y1 + 1, HEIGHT)):
        xs = np.where(opaque[y])[0]
        if xs.size == 0:
            continue
        left[y] = int(xs[0])
        right[y] = int(xs[-1])
    known = np.where(left >= 0)[0]
    if known.size == 0:
        raise SystemExit("No fuselage rows found")
    for y in range(HEIGHT):
        if left[y] >= 0:
            continue
        above = known[known < y]
        below = known[known > y]
        if above.size and below.size:
            y0 = int(above[-1])
            y1 = int(below[0])
            t = (y - y0) / max(1, y1 - y0)
            left[y] = int(round(left[y0] * (1 - t) + left[y1] * t))
            right[y] = int(round(right[y0] * (1 - t) + right[y1] * t))
        elif above.size:
            left[y] = int(left[int(above[-1])])
            right[y] = int(right[int(above[-1])])
        else:
            left[y] = int(left[int(below[0])])
            right[y] = int(right[int(below[0])])
    return left, right


def dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    out = mask.copy()
    for _ in range(radius):
        padded = np.pad(out, 1, mode="constant", constant_values=False)
        grown = np.zeros_like(out)
        for dy in range(3):
            for dx in range(3):
                grown |= padded[dy : dy + HEIGHT, dx : dx + WIDTH]
        out = grown
    return out


def nearest_slot_fill(slots: np.ndarray, target: np.ndarray, source: np.ndarray) -> None:
    """Copy nearest non-zero source slot into target pixels that still need ink."""
    ys, xs = np.where(target & (slots == 0))
    src_ys, src_xs = np.where(source & (slots != 0))
    if src_ys.size == 0 or ys.size == 0:
        return
    for y, x in zip(ys.tolist(), xs.tolist(), strict=False):
        d2 = (src_ys - y) ** 2 + (src_xs - x) ** 2
        i = int(np.argmin(d2))
        slots[y, x] = slots[src_ys[i], src_xs[i]]


def nearest_rgb_fill(rgba: np.ndarray, target: np.ndarray, source: np.ndarray) -> None:
    ys, xs = np.where(target)
    src_ys, src_xs = np.where(source)
    if src_ys.size == 0 or ys.size == 0:
        return
    for y, x in zip(ys.tolist(), xs.tolist(), strict=False):
        d2 = (src_ys - y) ** 2 + (src_xs - x) ** 2
        i = int(np.argmin(d2))
        rgba[y, x] = rgba[src_ys[i], src_xs[i]]


def split_airframe(chassis_rgba: np.ndarray, chassis_slots: np.ndarray) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    opaque = opaque_mask(chassis_rgba)
    left, right = interpolate_body_spans(opaque)

    body = np.zeros((HEIGHT, WIDTH), dtype=bool)
    nose = np.zeros((HEIGHT, WIDTH), dtype=bool)
    for y in range(HEIGHT):
        body[y, left[y] : right[y] + 1] = opaque[y, left[y] : right[y] + 1]
        nose[y, right[y] + 1 :] = opaque[y, right[y] + 1 :]

    fuselage_mask = (body | nose) & opaque
    outer_wing = opaque & ~fuselage_mask
    # Keep a stub of each wing root on the fuselage so foreshortening never opens magenta.
    root_stub = dilate(fuselage_mask, ROOT_DILATE) & opaque & outer_wing
    fuselage_mask = fuselage_mask | root_stub
    outer_wing = opaque & ~fuselage_mask

    far_mask = outer_wing & (np.arange(HEIGHT)[:, None] < CENTER_Y)
    near_mask = outer_wing & (np.arange(HEIGHT)[:, None] > CENTER_Y)
    mid_mask = outer_wing & (np.arange(HEIGHT)[:, None] == CENTER_Y)
    near_mask |= mid_mask

    snapped = chassis_rgba.copy()
    for y in range(HEIGHT):
        for x in range(WIDTH):
            if not opaque[y, x]:
                snapped[y, x] = (*MAGENTA, 255)
                continue
            rgb = snap_rgb((int(snapped[y, x, 0]), int(snapped[y, x, 1]), int(snapped[y, x, 2])))
            snapped[y, x, 0:3] = rgb
            snapped[y, x, 3] = 255

    slots = chassis_slots.copy()
    # Fill root stubs that had wing ink: keep their slots; fill any zero holes from body.
    nearest_slot_fill(slots, root_stub & (slots == 0), fuselage_mask & ~root_stub)
    nearest_rgb_fill(snapped, root_stub & ~opaque_mask(chassis_rgba), fuselage_mask & ~root_stub)

    def layer(mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        rgba = empty_rgba()
        layer_slots = np.zeros((HEIGHT, WIDTH), dtype=np.int32)
        rgba[mask] = snapped[mask]
        layer_slots[mask] = slots[mask]
        # Transparent empty for part PNGs (sheets use magenta; part masks use alpha 0).
        rgba[~mask, 3] = 0
        return rgba, layer_slots

    far_rgba, far_slots = layer(far_mask)
    fuse_rgba, fuse_slots = layer(fuselage_mask)
    near_rgba, near_slots = layer(near_mask)
    return {
        "farWing": (far_rgba, far_slots),
        "fuselage": (fuse_rgba, fuse_slots),
        "nearWing": (near_rgba, near_slots),
    }


def slots_to_list(slots: np.ndarray) -> list[int]:
    return [int(v) for v in slots.reshape(-1).tolist()]


def write_part_json(path: Path, part_id: str, name: str, layer: str, drawings: list[list[int]]) -> None:
    document = {
        "kind": "rig-part",
        "version": 1,
        "id": part_id,
        "name": name,
        "layer": layer,
        "width": WIDTH,
        "height": HEIGHT,
        "drawings": drawings,
    }
    path.write_text(json.dumps(document, separators=(",", ":")) + "\n", encoding="utf-8")


def composite(layers: list[np.ndarray]) -> np.ndarray:
    out = empty_rgba()
    out[..., 3] = 0
    for layer in layers:
        mask = layer[..., 3] > 128
        out[mask] = layer[mask]
    return out


def charcoal_sil(rgba: np.ndarray) -> np.ndarray:
    out = empty_rgba()
    out[..., 3] = 0
    mask = rgba[..., 3] > 128
    out[mask, 0] = CHARCOAL[0]
    out[mask, 1] = CHARCOAL[1]
    out[mask, 2] = CHARCOAL[2]
    out[mask, 3] = 255
    return out


def copy_tree() -> None:
    if DST_RIG.exists():
        shutil.rmtree(DST_RIG)
    shutil.copytree(SRC_RIG, DST_RIG)


def rebuild_rig(layers: dict[str, tuple[np.ndarray, np.ndarray]], prop_rgba: np.ndarray, prop_drawings: list) -> dict:
    meta = {
        "wingRootX": 93,
        "wingRootY": CENTER_Y,
        "centerY": CENTER_Y,
        "variant": "25D",
    }
    (DST_RIG / "meta_25D.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

    save_rgba(DST_RIG / "part_legs_farWing.png", layers["farWing"][0])
    save_rgba(DST_RIG / "part_torso_fuselage.png", layers["fuselage"][0])
    save_rgba(DST_RIG / "part_head_propeller.png", prop_rgba)
    save_rgba(DST_RIG / "part_weapon_nearWing.png", layers["nearWing"][0])
    save_rgba(DST_RIG / "part_shadow_sil.png", charcoal_sil(composite([layers["farWing"][0], layers["fuselage"][0], prop_rgba, layers["nearWing"][0]])))

    write_part_json(
        DST_RIG / "part_legs_farWing.json",
        "legs_farWing",
        "Far wing",
        "legs",
        [slots_to_list(layers["farWing"][1])],
    )
    write_part_json(
        DST_RIG / "part_torso_fuselage.json",
        "torso_fuselage",
        "Fuselage",
        "torso",
        [slots_to_list(layers["fuselage"][1])],
    )
    write_part_json(
        DST_RIG / "part_head_propeller.json",
        "head_propeller",
        "Propeller",
        "head",
        prop_drawings,
    )
    write_part_json(
        DST_RIG / "part_weapon_nearWing.json",
        "weapon_nearWing",
        "Near wing",
        "weapon",
        [slots_to_list(layers["nearWing"][1])],
    )

    # Drop old part files that no longer belong to the 25D wearing set.
    for stale in (
        "part_legs_chassis.png",
        "part_legs_chassis.json",
        "part_torso_propeller.png",
        "part_torso_propeller.json",
        "part_head_empty.png",
        "part_head_empty.json",
        "part_weapon_empty.png",
        "part_weapon_empty.json",
    ):
        path = DST_RIG / stale
        if path.exists():
            path.unlink()

    rig = json.loads((DST_RIG / "rig.json").read_text(encoding="utf-8"))
    rig["unitId"] = "ger_fighter_seed1_25D"
    rig["parts"] = [
        {"id": "legs_farWing", "name": "Far wing", "layer": "legs"},
        {"id": "torso_fuselage", "name": "Fuselage", "layer": "torso"},
        {"id": "head_propeller", "name": "Propeller", "layer": "head"},
        {"id": "weapon_nearWing", "name": "Near wing", "layer": "weapon"},
    ]
    rig["wearing"] = {
        "legs": "legs_farWing",
        "torso": "torso_fuselage",
        "head": "head_propeller",
        "weapon": "weapon_nearWing",
    }
    # Keep clip structure; poses stay on drawing 0 (prop blur frames are identical today).
    (DST_RIG / "rig.json").write_text(json.dumps(rig, separators=(",", ":")) + "\n", encoding="utf-8")
    return rig


def write_frames(rig: dict, layers: dict[str, tuple[np.ndarray, np.ndarray]], prop_rgba: np.ndarray) -> None:
    if DST_FRAMES.exists():
        shutil.rmtree(DST_FRAMES)
    DST_FRAMES.mkdir(parents=True)

    stack = [
        layers["farWing"][0],
        layers["fuselage"][0],
        prop_rgba,
        layers["nearWing"][0],
    ]
    flat = composite(stack)
    # Magenta empty for sheet-style frame PNGs.
    sheet = empty_rgba()
    mask = flat[..., 3] > 128
    sheet[mask] = flat[mask]

    clips = {
        "kind": "sprite-clips",
        "version": 1,
        "unitId": "ger_fighter_seed1_25D",
        "factionId": "GER",
        "unitTypeId": "fighter",
        "width": WIDTH,
        "height": HEIGHT,
        "feet": rig.get("feet", {"x": 97, "y": 159}),
        "muzzle": {"x": 133, "y": 72},
        "variant": "25D",
        "wingRoot": {"x": 93, "y": CENTER_Y},
        "clips": {
            "idle": [f"idle_{i}" for i in range(4)],
            "walk": [f"walk_{i}" for i in range(8)],
            "fire": [f"fire_{i}" for i in range(2)],
            "damaged": [f"damaged_{i}" for i in range(2)],
        },
    }
    (DST_FRAMES / "clips.json").write_text(json.dumps(clips, indent=2) + "\n", encoding="utf-8")

    for name in clips["clips"]["idle"] + clips["clips"]["walk"] + clips["clips"]["fire"] + clips["clips"]["damaged"]:
        save_rgba(DST_FRAMES / f"{name}.png", sheet)

    layer_dir = DST_FRAMES / "layers"
    layer_dir.mkdir()
    save_rgba(layer_dir / "farWing.png", layers["farWing"][0])
    save_rgba(layer_dir / "fuselage.png", layers["fuselage"][0])
    save_rgba(layer_dir / "nearWing.png", layers["nearWing"][0])
    save_rgba(layer_dir / "prop.png", prop_rgba)
    save_rgba(layer_dir / "shadow.png", charcoal_sil(flat))
    (layer_dir / "meta.json").write_text(
        json.dumps(
            {
                "wingRootX": 93,
                "wingRootY": CENTER_Y,
                "zOrder": ["shadow", "farWing", "fuselage", "prop", "nearWing"],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def vectorize_25D() -> None:
    cmd = [
        sys.executable,
        str(WEB_ROOT / "scripts" / "vectorize_units.py"),
        "--clips",
        str(DST_FRAMES / "clips.json"),
    ]
    print("vectorize clips:", " ".join(cmd))
    subprocess.run(cmd, cwd=str(WEB_ROOT), check=True)

    # Trace each articulated layer into its own SVG beside the clip set.
    sys.path.insert(0, str(WEB_ROOT / "scripts"))
    import vectorize_units as vz  # noqa: WPS433

    palette = vz.read_palette(vz.DEFAULT_PALETTE)
    if len(palette) != vz.PALETTE_COUNT:
        raise SystemExit("Palette size mismatch")
    backing = min(palette, key=vz.luminance)
    DST_LAYER_SVGS.mkdir(parents=True, exist_ok=True)
    for name in ("farWing", "fuselage", "nearWing", "prop", "shadow"):
        source = DST_FRAMES / "layers" / f"{name}.png"
        # vectorize expects opaque art on transparent or magenta; convert magenta to clear.
        rgba = load_rgba(source).copy()
        magenta = (rgba[..., 0] == 255) & (rgba[..., 1] == 0) & (rgba[..., 2] == 255)
        rgba[magenta, 3] = 0
        tmp = DST_FRAMES / "layers" / f"_{name}_trace.png"
        save_rgba(tmp, rgba)
        svg, width, height = vz.vectorize(tmp, palette, backing)
        dest = DST_LAYER_SVGS / f"{name}.svg"
        dest.write_text(svg, encoding="utf-8", newline="\n")
        tmp.unlink(missing_ok=True)
        print(f"layer {name} -> {dest} ({width}x{height})")


def main() -> int:
    if not SRC_RIG.is_dir():
        raise SystemExit(f"Missing source rig {SRC_RIG}")
    before = snapshot_tree(SRC_RIG)

    chassis_rgba = load_rgba(SRC_RIG / "part_legs_chassis.png")
    chassis_json = json.loads((SRC_RIG / "part_legs_chassis.json").read_text(encoding="utf-8"))
    chassis_slots = np.asarray(chassis_json["drawings"][0], dtype=np.int32).reshape(HEIGHT, WIDTH)
    prop_rgba = load_rgba(SRC_RIG / "part_torso_propeller.png").copy()
    # Snap prop to military palette, keep alpha.
    for y in range(HEIGHT):
        for x in range(WIDTH):
            if prop_rgba[y, x, 3] <= 128:
                prop_rgba[y, x, 3] = 0
                continue
            rgb = snap_rgb((int(prop_rgba[y, x, 0]), int(prop_rgba[y, x, 1]), int(prop_rgba[y, x, 2])))
            prop_rgba[y, x, 0:3] = rgb
            prop_rgba[y, x, 3] = 255
    prop_json = json.loads((SRC_RIG / "part_torso_propeller.json").read_text(encoding="utf-8"))
    prop_drawings = copy.deepcopy(prop_json["drawings"])

    layers = split_airframe(chassis_rgba, chassis_slots)
    copy_tree()
    rig = rebuild_rig(layers, prop_rgba, prop_drawings)
    write_frames(rig, layers, prop_rgba)

    # Re-bake pose preview PNGs in the rig folder from the new layers.
    flat = composite([layers["farWing"][0], layers["fuselage"][0], prop_rgba, layers["nearWing"][0]])
    sheet = empty_rgba()
    mask = flat[..., 3] > 128
    sheet[mask] = flat[mask]
    for name in (
        "idle_0",
        "idle_1",
        "idle_2",
        "idle_3",
        "walk_0",
        "walk_1",
        "walk_2",
        "walk_3",
        "walk_4",
        "walk_5",
        "walk_6",
        "walk_7",
        "fire_0",
        "fire_1",
        "damaged_0",
        "damaged_1",
    ):
        save_rgba(DST_RIG / f"{name}.png", sheet)

    assert_unchanged(SRC_RIG, before)
    vectorize_25D()
    assert_unchanged(SRC_RIG, before)

    print(f"built {DST_RIG}")
    print(f"frames {DST_FRAMES}")
    print(f"layer svgs {DST_LAYER_SVGS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
