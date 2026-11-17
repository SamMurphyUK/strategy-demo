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
 * Recolour slots inside a part. Each faction maps these onto a MilitaryStripKey.
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

export type PartSlotType =
  | "head"
  | "torso"
  | "arms"
  | "weapon"
  | "legs"
  | "hull"
  | "turret"
  | "barrel"
  | "chassis"
  | "fuselage"
  | "wings"
  | "superstructure";

/** Feet on the live 80×56 sheet. figureGround.ts uses the same point (SPRITE_BAKE). */
export const SHEET_FOOT_ANCHOR: Vec2 = { x: 40, y: 52 };

/**
 * Rest-pose motion for a live drawer. A promoted flat PNG cannot elevate or recoil;
 * it can only flip and flash at muzzlePoint.
 */
export interface NodeArticulation {
  role: "turret" | "barrel";
  pivotOffset: Vec2;
  minDeg: number;
  maxDeg: number;
  recoilPx: number;
}

export interface PartAsset {
  partId: string;
  slotType: PartSlotType;
  label: string;
  width: number;
  height: number;
  localPivot: Vec2;
  pixelGrid: (PaletteSlotKey | null)[][];
  promptFragment: string;
}

export interface SkeletonNode {
  nodeId: string;
  partId: string;
  parentId: string | null;
  anchorInParent: Vec2;
  rotationDeg: number;
  zIndex: number;
  articulation?: NodeArticulation;
  slotOverrides?: Partial<Record<PaletteSlotKey, PaletteSlotKey>>;
}

/**
 * Authored unit art. blueprintId is unique per drawing.
 * unitTypeId is the UNIT_DEFINITIONS key and is not a filename.
 */
export interface UnitSkeletonBlueprint {
  blueprintId: string;
  unitTypeId: string;
  factionId: RosterFactionId;
  category: UnitCategory;
  canvasSize: { width: 48 | 64; height: 48 | 64 };
  groundOrigin: Vec2;
  sheetFootAnchor: Vec2;
  /** Static muzzle flash once a flat PNG is promoted. */
  muzzlePoint?: Vec2;
  nativeFacing: "right" | "left";
  nodes: SkeletonNode[];
  referencePlatePaths?: string[];
  historicalEraTag: string;
}
