// The board's skins. Pure.
//
// A skin is a way of drawing the land and the sea: a set of shader chunks that answer the same
// questions (pixelSkin.ts, bakedSkin.ts), and a preset of the settings it owns. The land and water
// materials are the same for every skin and ask the chunks for colour. Only the define that picks
// the chunks differs, so adding a skin is a new chunk file, an entry here, and no change to the
// materials' own code.
//
// The baked skin is the default. Whenever the chosen skin cannot draw yet (the pixel chart's sheets
// are still being made, or the setting is off), the board draws the baked skin and is never blank.
import { DEFAULT_VISUALS, type MapVisualConfig, PIXEL_CHART_VISUALS, type VisualKey } from "../../map/mapVisualConfig";

export type BoardSkinId = "pixel" | "baked";

export interface BoardSkin {
  id: BoardSkinId;
  label: string;
  description: string;
  /** The shader define that selects this skin's chunks. The baked skin is what answers with no define. */
  define: "PIXIE" | null;
  /** The settings this skin starts from. */
  preset: Readonly<MapVisualConfig>;
  /** The settings only this skin reads. Sliders for them mean nothing under another skin. */
  owns: readonly VisualKey[];
}

export const BOARD_SKINS: Readonly<Record<BoardSkinId, BoardSkin>> = Object.freeze({
  baked: {
    id: "baked",
    label: "Baked sheet",
    description: "The land and the sea as the painted sheet the board is baked to, with grain, rivers, and roads.",
    define: null,
    preset: Object.freeze({ ...DEFAULT_VISUALS, enableFauxPixelMap: false }),
    owns: [],
  },
  pixel: {
    id: "pixel",
    label: "Pixel chart",
    description: "The land and the sea as square texels fixed to the board, with an ordered dither and a soft wash close in.",
    define: "PIXIE",
    preset: PIXEL_CHART_VISUALS,
    owns: [
      "pixelTexelDensity",
      "pixelHillshadeContrast",
      "pixelShadowSteps",
      "pixelDitherStrength",
      "pixelPaletteSaturation",
      "seaContourSteps",
      "coastRimIntensity",
      "enablePixelFoam",
      "pixelFoamReach",
      "pixelFoamBleed",
      "regionalPaletteDetail",
      "enableSoftLand",
      "softLandFrom",
      "softLandTo",
      "softLandDither",
      "softLandSaturation",
      "softLandValueBand",
      "softLandBrush",
      "dioramaPbrBlend",
      "dioramaTileScale",
      "dioramaNormalStrength",
    ],
  },
});

export const DEFAULT_SKIN: BoardSkinId = "baked";

/**
 * The skin to draw. `ready` is whether the chosen skin has what it needs (the pixel chart needs its
 * sheets and a map). When it does not, the default is drawn.
 */
export function skinFor(config: Readonly<MapVisualConfig>, ready: boolean): BoardSkinId {
  return config.enableFauxPixelMap && ready ? "pixel" : DEFAULT_SKIN;
}

/** Whether a setting belongs to the skin: a slider for one that does not has no effect on it. */
export function skinOwns(skin: BoardSkinId, key: VisualKey): boolean {
  return BOARD_SKINS[skin].owns.includes(key);
}

/** The skin a setting belongs to, or null for one every skin reads. */
export function skinOwner(key: VisualKey): BoardSkinId | null {
  for (const skin of Object.values(BOARD_SKINS)) {
    if (skin.owns.includes(key)) {
      return skin.id;
    }
  }
  return null;
}

/** Whether a setting belongs to a skin other than the active one, so it does nothing now. */
export function skinDisables(active: BoardSkinId, key: VisualKey): boolean {
  const owner = skinOwner(key);
  return owner !== null && owner !== active;
}

/** The define for a skin, as a material's defines say it: 1, or null for none. */
export function skinDefine(skin: BoardSkinId): { name: "PIXIE"; value: 1 | null } {
  return { name: "PIXIE", value: BOARD_SKINS[skin].define === "PIXIE" ? 1 : null };
}
