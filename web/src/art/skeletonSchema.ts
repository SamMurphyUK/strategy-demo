import { MILITARY } from "../ui/theme/militaryPalette";

/**
 * One of the sixteen colours in militaryPalette.ts.
 * Outline ink is not a strip key. figureGround.ts paints #1A1614 after the blit.
 */
export type MilitaryStripKey = keyof typeof MILITARY;

/** The sixteen keys, in palette order. */
export const MILITARY_STRIP_KEYS = Object.keys(MILITARY) as MilitaryStripKey[];

export interface Vec2 {
  x: number;
  y: number;
}

/** Roster ids. The palette's neutral swatch is not a roster faction; minors use MINOR. */
export type RosterFactionId = "GER" | "USSR" | "UK" | "US" | "JAP" | "MINOR";

/** Same three buckets as UnitDefinition.category. Stats stay on UNIT_DEFINITIONS. */
export type UnitCategory = "land" | "air" | "sea";

/**
 * Recolour slots inside a frame. Each faction maps these onto a MilitaryStripKey.
 * There is no outline slot.
 */
export type PaletteSlotKey =
  | "primary_uniform_or_hull"
  | "secondary_trim_or_webbing"
  | "metallic_steel"
  | "metallic_brass_or_track"
  | "wood_or_leather"
  | "skin_stand_in"
  | "insignia_accent";

export type FactionMilitaryMapping = Record<PaletteSlotKey, MilitaryStripKey>;

/** Feet on the live 80×56 sheet. figureGround.ts uses the same point (SPRITE_BAKE). */
export const SHEET_FOOT_ANCHOR: Vec2 = { x: 40, y: 52 };

export const SPRITE_FRAME_KEYS = ["idle", "move_1", "move_2", "fire"] as const;

export type SpriteFrameKey = (typeof SPRITE_FRAME_KEYS)[number];

export type SpriteFrameGrid = (PaletteSlotKey | null)[][];

/**
 * One unit, four flat poses. Slots re-skin through FACTION_MILITARY_MAPPINGS.
 * unitTypeId is the UNIT_DEFINITIONS key and is not a filename.
 */
export interface UnitSpriteSheetBlueprint {
  blueprintId: string;
  unitTypeId: string;
  factionId: RosterFactionId;
  category: UnitCategory;
  canvasSize: { width: 48 | 64; height: 48 | 64 };
  groundOrigin: Vec2;
  sheetFootAnchor: Vec2;
  muzzlePoint?: Vec2;
  nativeFacing: "right" | "left";
  /** Whole-sprite kick, in canvas pixels, applied on the fire pose. */
  recoilOffsetPx: number;
  frames: Record<SpriteFrameKey, SpriteFrameGrid>;
  referencePlatePaths?: string[];
  historicalEraTag: string;
}

/** Older name for the sprite sheet. The node tree is gone. */
export type UnitSkeletonBlueprint = UnitSpriteSheetBlueprint;
