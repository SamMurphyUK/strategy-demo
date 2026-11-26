// The battle stage's skins. Pure, and decoupled from combat: nothing here reads or writes a rule, a die, or a unit's
// hit points. A skin is a way of dressing the same stage: the rim of the diorama slice, the ground's palette for each
// kind of terrain, the grade of the light, which scatter goes where, and the camera presets. The European skin is the
// first; desert, Pacific and winter are each a new entry in `BATTLE_SKINS` and no change to the stage's own code.
//
// It mirrors skins/boardSkin.ts: a registry, a preset of the settings the skin starts from, an `owns` list of the settings
// only it reads, and the helpers that let the look panel dim a slider that means nothing under the active skin.
import { DEFAULT_BATTLE_VISUALS, type BattleVisualConfig, type BattleVisualKey } from "./battleVisualConfig";

export type BattleSkinId = "european";

/** What kind of ground the contested territory is, which decides how thickly and with what the scatter dresses it. */
export type BattleTerrain = "plains" | "bocage" | "urban" | "mountain";

/** The ten John Nash 20mm scatter sets (assets/terrain/scatter_manifest.json). */
export type ScatterSet =
  | "sandbag_bunker"
  | "trench_parapet"
  | "wire_obstacles"
  | "anti_tank_obstacles"
  | "hedgerow_segments"
  | "pastoral_trees"
  | "nash_shattered_trees"
  | "ruined_masonry"
  | "field_props"
  | "shell_craters";

/** Where on the stage a scatter piece may stand: the cover in front of each line, the mid-ground behind them, or the verge near the front lip. */
export type ScatterZone = "cover" | "midground" | "verge";

export interface ScatterRule {
  set: ScatterSet;
  zone: ScatterZone;
  /** How many at density 1. */
  count: number;
}

export interface TerrainPalette {
  /** The ground's two tints, from the fading-16 strip: low and high. The photographed luminance moves between them. */
  low: string;
  high: string;
  /** Dry earth and churned mud. */
  worn: string;
}

export interface CameraPreset {
  pitchDeg: number;
  fovDeg: number;
  /** Where the camera looks, in stage fractions: lookX from -1 (the attacker's edge) to 1, lookZ from 0 (the front lip) to 1 (the horizon). */
  lookX: number;
  lookZ: number;
  /** Fraction of the fitted distance. Below 1 is closer. */
  zoom: number;
}

export interface BattleSkin {
  id: BattleSkinId;
  label: string;
  description: string;
  /** The settings this skin starts from. */
  preset: Readonly<BattleVisualConfig>;
  /** The settings only this skin reads. A slider for one under another skin means nothing, so the panel dims it. */
  owns: readonly BattleVisualKey[];
  rim: {
    /** The smoked walnut and slate of the diorama's rim. */
    color: string;
    slate: string;
    /** Strata along the front lip, top to bottom. */
    strata: readonly string[];
    /** Thickness of the 20mm slice, in stage units. */
    thickness: number;
    bevel: number;
  };
  palettes: Readonly<Record<BattleTerrain, TerrainPalette>>;
  grade: {
    /** Brightest the ground may be. */
    groundLumaCeiling: number;
    /** Brightest the smoke may be. */
    smokeLumaCeiling: number;
    /** The valley-mist tint the rear lanes lean toward. */
    valleyMist: string;
    sunColor: string;
    /** Sun direction, from the ground to the sun: x across, y into the scene, z up. */
    sunDir: readonly [number, number, number];
    ambient: string;
    muzzleLight: string;
    /** How far the scatter sprites are pulled onto the fading-16 strip, 0 to 1. */
    scatterPull: number;
  };
  camera: Readonly<Record<"establishing" | "exchange" | "overhead", CameraPreset>>;
  /** The scatter mapping per terrain. */
  scatter: Readonly<Record<BattleTerrain, readonly ScatterRule[]>>;
  /** Sets that stand in towns and cities only. */
  urbanOnly: readonly ScatterSet[];
}

const OWNED: readonly BattleVisualKey[] = [
  "battleDepthScale",
  "battleDepthDesat",
  "battleScatterDensity",
  "battleSmokeStrength",
  "battleTiltShift",
  "battleValleyMist",
];

export const BATTLE_SKINS: Readonly<Record<BattleSkinId, BattleSkin>> = Object.freeze({
  european: {
    id: "european",
    label: "European",
    description: "A smoked-walnut and slate diorama slice of loam, grass and hedge, lit by a low northern sun.",
    preset: DEFAULT_BATTLE_VISUALS,
    owns: OWNED,
    rim: {
      color: "#1E1B18",
      slate: "#3A3D44",
      strata: ["#4B3D44", "#645355", "#846D59", "#645355", "#4B3D44"],
      thickness: 0.7,
      bevel: 0.09,
    },
    palettes: {
      plains: { low: "#7D7B62", high: "#AAA25D", worn: "#846D59" },
      bocage: { low: "#7D7B62", high: "#8E9F7D", worn: "#846D59" },
      urban: { low: "#645355", high: "#A99C8D", worn: "#4B3D44" },
      mountain: { low: "#7D7B62", high: "#A88A5E", worn: "#645355" },
    },
    grade: {
      groundLumaCeiling: 0.92,
      smokeLumaCeiling: 0.88,
      valleyMist: "#A9B4A8",
      sunColor: "#DDCF99",
      sunDir: [-0.45, 0.4, 0.8],
      ambient: "#8C7C79",
      muzzleLight: "#E7B766",
      scatterPull: 0.7,
    },
    camera: {
      establishing: { pitchDeg: 35, fovDeg: 35, lookX: 0, lookZ: 0.42, zoom: 1 },
      exchange: { pitchDeg: 35, fovDeg: 35, lookX: 0, lookZ: 0.38, zoom: 0.82 },
      overhead: { pitchDeg: 42, fovDeg: 35, lookX: 0, lookZ: 0.45, zoom: 1.08 },
    },
    scatter: {
      plains: [
        { set: "wire_obstacles", zone: "cover", count: 4 },
        { set: "trench_parapet", zone: "cover", count: 3 },
        { set: "sandbag_bunker", zone: "cover", count: 2 },
        { set: "anti_tank_obstacles", zone: "cover", count: 2 },
        { set: "hedgerow_segments", zone: "midground", count: 3 },
        { set: "pastoral_trees", zone: "midground", count: 4 },
        { set: "nash_shattered_trees", zone: "midground", count: 2 },
        { set: "field_props", zone: "midground", count: 5 },
        { set: "field_props", zone: "verge", count: 3 },
      ],
      bocage: [
        { set: "wire_obstacles", zone: "cover", count: 2 },
        { set: "trench_parapet", zone: "cover", count: 3 },
        { set: "sandbag_bunker", zone: "cover", count: 2 },
        { set: "anti_tank_obstacles", zone: "cover", count: 1 },
        { set: "hedgerow_segments", zone: "midground", count: 10 },
        { set: "pastoral_trees", zone: "midground", count: 9 },
        { set: "nash_shattered_trees", zone: "midground", count: 3 },
        { set: "field_props", zone: "midground", count: 3 },
        { set: "hedgerow_segments", zone: "verge", count: 3 },
      ],
      urban: [
        { set: "sandbag_bunker", zone: "cover", count: 3 },
        { set: "trench_parapet", zone: "cover", count: 1 },
        { set: "wire_obstacles", zone: "cover", count: 3 },
        { set: "anti_tank_obstacles", zone: "cover", count: 4 },
        { set: "ruined_masonry", zone: "midground", count: 8 },
        { set: "nash_shattered_trees", zone: "midground", count: 3 },
        { set: "field_props", zone: "midground", count: 3 },
        { set: "hedgerow_segments", zone: "midground", count: 1 },
        { set: "pastoral_trees", zone: "midground", count: 1 },
        { set: "ruined_masonry", zone: "verge", count: 2 },
      ],
      mountain: [
        { set: "sandbag_bunker", zone: "cover", count: 2 },
        { set: "trench_parapet", zone: "cover", count: 2 },
        { set: "anti_tank_obstacles", zone: "cover", count: 2 },
        { set: "nash_shattered_trees", zone: "midground", count: 5 },
        { set: "pastoral_trees", zone: "midground", count: 2 },
        { set: "field_props", zone: "midground", count: 3 },
        { set: "hedgerow_segments", zone: "midground", count: 1 },
        { set: "field_props", zone: "verge", count: 2 },
      ],
    },
    urbanOnly: ["ruined_masonry"],
  },
});

export const BATTLE_SKIN_IDS = Object.keys(BATTLE_SKINS) as BattleSkinId[];
export const DEFAULT_BATTLE_SKIN: BattleSkinId = "european";

/** The skin a battle is drawn in. Only the European skin exists; the others will answer from the theatre and the region. */
export function battleSkinFor(_theater?: string, _biome?: string): BattleSkinId {
  return DEFAULT_BATTLE_SKIN;
}

type Registry = Readonly<Record<string, { id: string; owns: readonly BattleVisualKey[] }>>;

/** Whether a setting belongs to the skin: a slider for one that does not has no effect on it. */
export function battleSkinOwns(skin: string, key: BattleVisualKey, registry: Registry = BATTLE_SKINS): boolean {
  return registry[skin]?.owns.includes(key) ?? false;
}

/** The skin a setting belongs to, or null for one every skin reads. */
export function battleSkinOwner(key: BattleVisualKey, registry: Registry = BATTLE_SKINS): string | null {
  for (const skin of Object.values(registry)) {
    if (skin.owns.includes(key)) {
      return skin.id;
    }
  }
  return null;
}

/** Whether a setting belongs to a skin other than the active one, so it does nothing now. */
export function battleSkinDisables(active: string, key: BattleVisualKey, registry: Registry = BATTLE_SKINS): boolean {
  const owner = battleSkinOwner(key, registry);
  return owner !== null && owner !== active;
}

// --- Colour helpers every part of the stage shares. Pure. ---

export type Rgb = readonly [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const v = hex.replace("#", "");
  return [Number.parseInt(v.slice(0, 2), 16) / 255, Number.parseInt(v.slice(2, 4), 16) / 255, Number.parseInt(v.slice(4, 6), 16) / 255];
}

export function lumaOf(c: Rgb): number {
  return c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
}

/** Scales a colour down, hue held, so its luminance is at most `ceiling`. */
export function clampLuma(c: Rgb, ceiling: number): Rgb {
  const l = lumaOf(c);
  if (l <= ceiling || l <= 1e-6) {
    return c;
  }
  const k = ceiling / l;
  return [c[0] * k, c[1] * k, c[2] * k];
}

/** The 16 colours of the fading-16 strip, the palette every battle sprite is snapped to. */
export const FADING_16: readonly string[] = [
  "#DDCF99", "#CCA87B", "#B97A60", "#9C524E", "#774251", "#4B3D44", "#4E5463", "#5B7D73",
  "#8E9F7D", "#645355", "#8C7C79", "#A99C8D", "#7D7B62", "#AAA25D", "#846D59", "#A88A5E",
];
const FADING_RGB: readonly (readonly [number, number, number])[] = FADING_16.map((h) => {
  const c = hexToRgb(h);
  return [c[0] * 255, c[1] * 255, c[2] * 255] as const;
});

/** The index of the fading-16 colour nearest an 8-bit colour. */
export function nearestFading(r: number, g: number, b: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < FADING_RGB.length; i++) {
    const p = FADING_RGB[i];
    const dr = p[0] - r;
    const dg = p[1] - g;
    const db = p[2] - b;
    const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Harmonizes RGBA pixels, in place, to the skin's palette: each opaque pixel is moved `pull` of the way toward its nearest fading-16
 * colour, then held under the ground's luminance ceiling. Transparent pixels are left alone. A pull of 1 is a hard snap.
 */
export function harmonizePixels(data: Uint8ClampedArray, pull: number, lumaCeiling: number): void {
  const ceiling = lumaCeiling * 255;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) {
      continue;
    }
    const p = FADING_RGB[nearestFading(data[i], data[i + 1], data[i + 2])];
    let r = data[i] + (p[0] - data[i]) * pull;
    let g = data[i + 1] + (p[1] - data[i + 1]) * pull;
    let b = data[i + 2] + (p[2] - data[i + 2]) * pull;
    const l = r * 0.299 + g * 0.587 + b * 0.114;
    if (l > ceiling) {
      const k = ceiling / l;
      r *= k;
      g *= k;
      b *= k;
    }
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}
