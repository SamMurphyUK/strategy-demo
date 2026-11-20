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
 * The slots a country recolours. Each faction maps these onto a MilitaryStripKey.
 * There is no outline slot.
 */
export type BrushSlotKey =
  | "primary_uniform_or_hull"
  | "secondary_trim_or_webbing"
  | "metallic_steel"
  | "metallic_brass_or_track"
  | "wood_or_leather"
  | "skin_stand_in"
  | "insignia_accent";

/** Every value a pixel can hold: a recolour slot or a fixed emblem colour. */
export type PaletteSlotKey = BrushSlotKey | EmblemSlotKey;

/**
 * Fixed colours for national emblems. They are not in the faction mappings: every country gets the
 * same strip key from EMBLEM_STRIP, so a red star stays red and a roundel stays blue whichever
 * country the sprite is filed under. The Stamp tool writes them. See emblems.ts.
 */
export type EmblemSlotKey =
  | "emblem_dark"
  | "emblem_red"
  | "emblem_red_light"
  | "emblem_white"
  | "emblem_white_shade"
  | "emblem_blue"
  | "emblem_grey"
  | "emblem_moss";

export const EMBLEM_SLOT_KEYS: readonly EmblemSlotKey[] = [
  "emblem_dark",
  "emblem_red",
  "emblem_red_light",
  "emblem_white",
  "emblem_white_shade",
  "emblem_blue",
  "emblem_grey",
  "emblem_moss",
];

/** The strip key each emblem slot always resolves to. */
export const EMBLEM_STRIP: Record<EmblemSlotKey, MilitaryStripKey> = {
  emblem_dark: "charcoal",
  emblem_red: "crimson",
  emblem_red_light: "terracotta",
  emblem_white: "cream",
  emblem_white_shade: "bone",
  emblem_blue: "steel",
  /** The grey of a German cross edge and of chipped paint. Bone, above, is the light grey. */
  emblem_grey: "feldgrau",
  emblem_moss: "spruce",
};

export type FactionMilitaryMapping = Record<BrushSlotKey, MilitaryStripKey>;

/** The strip key a slot paints with. An emblem slot ignores the country. */
export function stripKeyOfSlot(mapping: FactionMilitaryMapping, slot: PaletteSlotKey): MilitaryStripKey {
  return slot in EMBLEM_STRIP ? EMBLEM_STRIP[slot as EmblemSlotKey] : mapping[slot as BrushSlotKey];
}

/** Feet on the live 80×56 sheet. figureGround.ts uses the same point (SPRITE_BAKE). */
export const SHEET_FOOT_ANCHOR: Vec2 = { x: 40, y: 52 };

export const SPRITE_FRAME_KEYS = ["idle", "move_1", "move_2", "fire"] as const;

export type SpriteFrameKey = (typeof SPRITE_FRAME_KEYS)[number];

export type SpriteFrameGrid = (PaletteSlotKey | null)[][];

/** How far Build Animation moves the layers, in plate pixels. */
export interface MotionShifts {
  /** The rise or drop of the body on the second step, on the swell, and under a shot. */
  bobPx: number;
  /** The gun's full kick. A turret, a carriage, and an airframe take half of it. */
  recoilPx: number;
  /** How far the steel links and the propeller dashes step. */
  treadStride: number;
}

/**
 * One unit, four flat poses. Slots re-skin through FACTION_MILITARY_MAPPINGS.
 * unitTypeId is the UNIT_DEFINITIONS key and is not a filename.
 */
export interface UnitSpriteSheetBlueprint {
  blueprintId: string;
  unitTypeId: string;
  factionId: RosterFactionId;
  category: UnitCategory;
  /** The size the unit is drawn at. A baked plate keeps its own size. The first starters are 48 square. */
  canvasSize: { width: number; height: number };
  /**
   * Plate pixels to one card pixel. A plate that carries it is scaled onto the 80×56 card by this whole number.
   * A blueprint without it is copied onto the card at its own size.
   */
  displayDivisor?: number;
  /** A blueprint without it moves by the 48-pixel amounts: bob 1, recoil 2, stride 1. */
  motion?: MotionShifts;
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
