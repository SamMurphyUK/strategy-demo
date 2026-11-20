import { INFANTRY_LAYER_KEYS, LAYER_LABEL, buildMarch, type InfantryLayerFrames } from "./infantryMarch";
import type { MotionShifts, PaletteSlotKey, SpriteFrameGrid, SpriteFrameKey, UnitCategory, Vec2 } from "./skeletonSchema";

/**
 * Every unit is drawn on one of six skeletons. A skeleton is an ordered stack of layers.
 * The editor paints the layers. The game, the motion test, and the 80×56 sheet only ever see
 * the four flat poses those layers composite into.
 */
export const ARCHETYPE_KEYS = ["infantry", "tank", "mech_infantry", "artillery", "aircraft", "ship"] as const;

export type ArchetypeKey = (typeof ARCHETYPE_KEYS)[number];

export type LayerStack = Record<string, SpriteFrameGrid>;

export type LayerFrames = Record<SpriteFrameKey, LayerStack>;

export type MovePose = Exclude<SpriteFrameKey, "idle">;

export interface LayerInfo {
  key: string;
  label: string;
  hint: string;
}

export interface ArchetypeDefinition {
  key: ArchetypeKey;
  label: string;
  category: UnitCategory;
  /** Paint order, bottom first. */
  layers: readonly LayerInfo[];
  /** UNIT_DEFINITIONS keys drawn on this skeleton. */
  unitTypes: readonly string[];
  /**
   * The most ink a unit of this class carries on the 48×48 canvas, beside the 26-pixel rifleman.
   * Ships stop at 46 wide so bow and stern foam still fit the canvas and the sheet's ink margin.
   */
  footprint: { width: number; height: number };
  /** What Build Animation writes, in one line, for the editor. */
  motion: string;
}

const TREAD_HINT = "Steel pixels on this layer are the tread and hub highlights. Build Animation steps them one pixel along for Move 1.";

export const ARCHETYPES: Record<ArchetypeKey, ArchetypeDefinition> = {
  infantry: {
    key: "infantry",
    label: "Infantry",
    category: "land",
    layers: [
      { key: "legs", label: LAYER_LABEL.legs, hint: "Hips and boots, under the tunic. Arrow keys move them on this pose." },
      {
        key: "torso",
        label: LAYER_LABEL.torso,
        hint: "The body, above the legs and under the head and the rifle. Move the rifle aside, then paint the tunic into the gap so a later pose has no hole.",
      },
      { key: "head", label: LAYER_LABEL.head, hint: "Helmet and face, above the tunic and under the rifle." },
      {
        key: "hands_weapon",
        label: LAYER_LABEL.hands_weapon,
        hint: "Hands and the rifle, above every other layer. Arrow keys move it on this pose. Paint the tunic into the gap it leaves.",
      },
    ],
    unitTypes: ["infantry"],
    footprint: { width: 22, height: 26 },
    motion: "Move 1 reaches, Move 2 drops a pixel, and Fire pulls the rifle back. Leg drawings already on those poses stay.",
  },
  tank: {
    key: "tank",
    label: "Tank",
    category: "land",
    layers: [
      { key: "tracks", label: "Tracks", hint: `Tread, road wheels, and links, under the hull. ${TREAD_HINT}` },
      { key: "hull", label: "Hull", hint: "The armoured body, above the tracks. It drops a pixel on Move 2 and on Fire." },
      { key: "turret", label: "Turret", hint: "Turret and cupola, above the hull. It kicks back a pixel on Fire." },
      {
        key: "barrel",
        label: "Barrel",
        hint: "The gun, above the turret. It kicks back two pixels on Fire. Put the muzzle mark on its tip.",
      },
    ],
    unitTypes: ["tank", "armor"],
    footprint: { width: 44, height: 24 },
    motion: "Move 1 steps the tread. Move 2 drops the hull, turret, and barrel a pixel. Fire kicks the turret back one and the barrel two.",
  },
  mech_infantry: {
    key: "mech_infantry",
    label: "Mechanised infantry",
    category: "land",
    layers: [
      { key: "wheels_tracks", label: "Wheels and tracks", hint: `Front wheel and rear track, under the body. ${TREAD_HINT}` },
      { key: "chassis", label: "Chassis", hint: "The armoured body, above the running gear. It rises a pixel on Move 2." },
      { key: "crew_gun", label: "Crew and gun", hint: "Crew and the mounted gun, above the body. The gun kicks back a pixel on Fire." },
    ],
    unitTypes: ["mech_infantry"],
    footprint: { width: 44, height: 24 },
    motion: "Move 1 steps the wheels and tread. Move 2 lifts the body and crew a pixel. Fire kicks the gun back one.",
  },
  artillery: {
    key: "artillery",
    label: "Artillery",
    category: "land",
    layers: [
      {
        key: "carriage_wheels",
        label: "Carriage and wheels",
        hint: "Wheels, axle, and trail, under the gun. It rolls back a pixel on Fire.",
      },
      { key: "gun_shield", label: "Gun shield", hint: "Shield and cradle, above the carriage. It settles a pixel on Move 2." },
      {
        key: "barrel_breech",
        label: "Barrel and breech",
        hint: "The gun, above the shield. A field gun slides back two pixels on Fire. A flak gun slides one back and one down.",
      },
    ],
    unitTypes: ["artillery", "aaa", "aa"],
    footprint: { width: 44, height: 36 },
    motion:
      "Move 1 is the idle. Move 2 settles the shield and barrel a pixel. Fire rolls the carriage back one and the barrel two, or one back and one down for a flak gun.",
  },
  aircraft: {
    key: "aircraft",
    label: "Aircraft",
    category: "air",
    layers: [
      {
        key: "fuselage_wings",
        label: "Fuselage and wings",
        hint: "The airframe from above, nose to the right. Everything else sits on it.",
      },
      {
        key: "engines_props",
        label: "Engines and propellers",
        hint: "Cowlings and the propeller blur, above the airframe. Steel pixels on this layer are the blur. Paint them as dashes. Build Animation steps them one pixel for Move 1.",
      },
      { key: "tail_markings", label: "Tail and markings", hint: "Fin, crosses, roundels, and bands, above everything." },
    ],
    unitTypes: ["fighter", "tactical_bomber", "strategic_bomber"],
    footprint: { width: 44, height: 44 },
    motion:
      "Move 1 steps the propeller blur. Move 2 slides the engines a pixel toward one wingtip. Fire pulls the whole airframe back one and flashes the nose and wing guns.",
  },
  ship: {
    key: "ship",
    label: "Ship",
    category: "sea",
    layers: [
      {
        key: "hull_waterline",
        label: "Hull and waterline",
        hint: "The hull in side profile, bow to the right, no wider than 46 pixels. Its bottom row is the waterline, where the foam is drawn.",
      },
      { key: "superstructure", label: "Superstructure", hint: "Bridge, funnels, and deckhouses, above the hull." },
      {
        key: "turrets_masts",
        label: "Turrets and masts",
        hint: "Guns, masts, and flags, above everything. Put the muzzle mark on the main battery.",
      },
    ],
    unitTypes: ["submarine", "transport", "destroyer", "cruiser", "carrier", "battleship"],
    footprint: { width: 46, height: 28 },
    motion:
      "Move 1 adds foam at the bow and stern. Move 2 lifts the ship a pixel on the swell and changes the foam. Fire rolls it down a pixel and flashes the main battery.",
  },
};

export const ARCHETYPE_LAYERS: Record<ArchetypeKey, readonly string[]> = {
  infantry: INFANTRY_LAYER_KEYS,
  tank: ARCHETYPES.tank.layers.map((layer) => layer.key),
  mech_infantry: ARCHETYPES.mech_infantry.layers.map((layer) => layer.key),
  artillery: ARCHETYPES.artillery.layers.map((layer) => layer.key),
  aircraft: ARCHETYPES.aircraft.layers.map((layer) => layer.key),
  ship: ARCHETYPES.ship.layers.map((layer) => layer.key),
};

/**
 * The fourteen unit types a sprite can be, in roster order, with the name the editor shows.
 * UNIT_DEFINITIONS also lists "aa" and "armor". They are a second flak gun and a second name for the tank,
 * so they map to a skeleton above but are not offered twice here.
 */
export const UNIT_TYPE_LABEL: Record<string, string> = {
  infantry: "Infantry",
  mech_infantry: "Mechanised infantry",
  artillery: "Artillery",
  aaa: "Anti-aircraft gun",
  tank: "Tank",
  fighter: "Fighter",
  tactical_bomber: "Tactical bomber",
  strategic_bomber: "Strategic bomber",
  submarine: "Submarine",
  transport: "Transport",
  destroyer: "Destroyer",
  cruiser: "Cruiser",
  carrier: "Aircraft carrier",
  battleship: "Battleship",
};

/** Shorter names for the two bombers, as they are written in the art notes. */
const UNIT_TYPE_ALIAS: Record<string, ArchetypeKey> = {
  tac_bomber: "aircraft",
  bomber: "aircraft",
};

const UNIT_TYPE_FULL_NAME: Record<string, string> = {
  tac_bomber: "tactical_bomber",
  bomber: "strategic_bomber",
};

/** The UNIT_DEFINITIONS key for a name from the art notes. A name that is already a key comes back as it is. */
export function rosterUnitType(unitTypeId: string): string {
  return UNIT_TYPE_FULL_NAME[unitTypeId] ?? unitTypeId;
}

export function archetypeForUnitType(unitTypeId: string): ArchetypeKey | null {
  for (const key of ARCHETYPE_KEYS) {
    if (ARCHETYPES[key].unitTypes.includes(unitTypeId)) {
      return key;
    }
  }
  return UNIT_TYPE_ALIAS[unitTypeId] ?? null;
}

/** Which steel control a loaded sprite should show. Ships and guns have none. */
export type SteelTool = "tread" | "propeller" | "soldier";

/** Tanks, guns, planes, and ships. Infantry keeps the walk sheet. */
export function isVehicleUnitType(unitTypeId: string): boolean {
  const archetype = archetypeForUnitType(unitTypeId);
  return archetype !== null && archetype !== "infantry";
}

export function steelToolFor(unitTypeId: string): SteelTool | null {
  const archetype = archetypeForUnitType(unitTypeId);
  if (archetype === "tank" || archetype === "mech_infantry") {
    return "tread";
  }
  if (archetype === "aircraft") {
    return "propeller";
  }
  if (archetype === "infantry") {
    return "soldier";
  }
  return null;
}

export function isArchetype(value: unknown): value is ArchetypeKey {
  return typeof value === "string" && (ARCHETYPE_KEYS as readonly string[]).includes(value);
}

export function layerInfo(archetype: ArchetypeKey, layer: string): LayerInfo | null {
  return ARCHETYPES[archetype].layers.find((item) => item.key === layer) ?? null;
}

export function layerLabel(archetype: ArchetypeKey, layer: string): string {
  return layerInfo(archetype, layer)?.label ?? layer;
}

export function emptyGrid(width: number, height: number): SpriteFrameGrid {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => null));
}

export function cloneGrid(grid: SpriteFrameGrid): SpriteFrameGrid {
  return grid.map((row) => row.slice());
}

export function emptyStack(archetype: ArchetypeKey, width: number, height: number): LayerStack {
  const stack: LayerStack = {};
  for (const layer of ARCHETYPE_LAYERS[archetype]) {
    stack[layer] = emptyGrid(width, height);
  }
  return stack;
}

export function emptyFrames(archetype: ArchetypeKey, width: number, height: number): LayerFrames {
  return {
    idle: emptyStack(archetype, width, height),
    move_1: emptyStack(archetype, width, height),
    move_2: emptyStack(archetype, width, height),
    fire: emptyStack(archetype, width, height),
  };
}

/** Copy the skeleton's layers. A layer the stack lacks comes back empty, the size of its neighbours. */
export function cloneStack(archetype: ArchetypeKey, stack: LayerStack): LayerStack {
  const { width, height } = stackSize(archetype, stack);
  const next: LayerStack = {};
  for (const layer of ARCHETYPE_LAYERS[archetype]) {
    const grid = stack[layer];
    next[layer] = grid ? cloneGrid(grid) : emptyGrid(width, height);
  }
  return next;
}

export function cloneFrames(archetype: ArchetypeKey, frames: LayerFrames): LayerFrames {
  return {
    idle: cloneStack(archetype, frames.idle),
    move_1: cloneStack(archetype, frames.move_1),
    move_2: cloneStack(archetype, frames.move_2),
    fire: cloneStack(archetype, frames.fire),
  };
}

/** The flat pose: each layer painted over the one before it. */
export function compositeStack(archetype: ArchetypeKey, stack: LayerStack): SpriteFrameGrid {
  const { width, height } = stackSize(archetype, stack);
  const grid = emptyGrid(width, height);
  for (const layer of ARCHETYPE_LAYERS[archetype]) {
    const source = stack[layer];
    if (!source) {
      continue;
    }
    for (let y = 0; y < height; y += 1) {
      const row = grid[y];
      for (let x = 0; x < width; x += 1) {
        const slot = source[y]?.[x];
        if (slot != null && row) {
          row[x] = slot;
        }
      }
    }
  }
  return grid;
}

/** The four flat poses the game plays. */
export function flattenFrames(archetype: ArchetypeKey, frames: LayerFrames): Record<SpriteFrameKey, SpriteFrameGrid> {
  return {
    idle: compositeStack(archetype, frames.idle),
    move_1: compositeStack(archetype, frames.move_1),
    move_2: compositeStack(archetype, frames.move_2),
    fire: compositeStack(archetype, frames.fire),
  };
}

/** The layer whose pixel shows at this cell, or null where the pose is empty. */
export function topLayerOf(archetype: ArchetypeKey, stack: LayerStack, x: number, y: number): string | null {
  const layers = ARCHETYPE_LAYERS[archetype];
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index];
    if (layer && stack[layer]?.[y]?.[x] != null) {
      return layer;
    }
  }
  return null;
}

export function shiftGrid(source: SpriteFrameGrid, dx: number, dy: number): SpriteFrameGrid {
  const height = source.length;
  const width = source[0]?.length ?? 0;
  const next = emptyGrid(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const slot = source[y]?.[x];
      const row = next[y + dy];
      if (slot == null || !row || x + dx < 0 || x + dx >= width) {
        continue;
      }
      row[x + dx] = slot;
    }
  }
  return next;
}

const SLOT_ORDER: readonly PaletteSlotKey[] = [
  "primary_uniform_or_hull",
  "secondary_trim_or_webbing",
  "metallic_steel",
  "metallic_brass_or_track",
  "wood_or_leather",
  "skin_stand_in",
  "insignia_accent",
];

/**
 * Steel is the moving detail on running gear and propellers: tread links, hub glints, and blur dashes.
 * Every other colour on those layers holds still.
 */
export const MOVING_DETAIL_SLOT: PaletteSlotKey = "metallic_steel";

/** The colour a layer uses most, leaving out one slot. Ties go to the earlier slot. */
export function mostUsedSlot(grid: SpriteFrameGrid, except?: PaletteSlotKey): PaletteSlotKey | null {
  const counts = new Map<PaletteSlotKey, number>();
  for (const row of grid) {
    for (const slot of row) {
      if (slot != null && slot !== except) {
        counts.set(slot, (counts.get(slot) ?? 0) + 1);
      }
    }
  }
  let best: PaletteSlotKey | null = null;
  let most = 0;
  for (const slot of SLOT_ORDER) {
    const count = counts.get(slot) ?? 0;
    if (count > most) {
      most = count;
      best = slot;
    }
  }
  return best;
}

/**
 * The alternate phase of a tread or a wheel. Each run of steel steps `stride` pixels to the right and
 * the colours it covers drop in behind it, in their order. Steel that would leave the layer, or cross
 * a gap in it, is lost instead, so the outline never changes.
 */
export function stepHighlights(grid: SpriteFrameGrid, stride = 1): SpriteFrameGrid {
  const step = Math.max(1, Math.floor(stride));
  const body = mostUsedSlot(grid, MOVING_DETAIL_SLOT);
  return grid.map((row) => {
    const next = row.slice();
    let start = 0;
    while (start < row.length) {
      if (row[start] == null) {
        start += 1;
        continue;
      }
      let end = start;
      while (row[end + 1] != null) {
        end += 1;
      }
      stepSegment(row, next, start, end, step, body);
      start = end + 1;
    }
    return next;
  });
}

/** One unbroken stretch of ink on a row: the steel moves along it and the other colours close up behind. */
function stepSegment(
  row: readonly (PaletteSlotKey | null)[],
  next: (PaletteSlotKey | null)[],
  start: number,
  end: number,
  step: number,
  body: PaletteSlotKey | null,
): void {
  const colours: PaletteSlotKey[] = [];
  let steel = false;
  for (let x = start; x <= end; x += 1) {
    const slot = row[x];
    if (slot === MOVING_DETAIL_SLOT) {
      steel = true;
    } else if (slot != null) {
      colours.push(slot);
    }
  }
  if (!steel) {
    return;
  }
  let used = 0;
  let last: PaletteSlotKey | null = null;
  for (let x = start; x <= end; x += 1) {
    if (x - step >= start && row[x - step] === MOVING_DETAIL_SLOT) {
      next[x] = MOVING_DETAIL_SLOT;
      continue;
    }
    const colour: PaletteSlotKey = colours[used] ?? last ?? body ?? MOVING_DETAIL_SLOT;
    used += 1;
    last = colour;
    next[x] = colour;
  }
}

/**
 * The alternate phase of a propeller. Each steel dash steps `stride` pixels toward the lower wingtip.
 * Dashes cross empty canvas, so the cell a dash leaves goes empty.
 */
export function stepBlur(grid: SpriteFrameGrid, stride = 1): SpriteFrameGrid {
  const step = Math.max(1, Math.floor(stride));
  const next = grid.map((row) => row.map((slot) => (slot === MOVING_DETAIL_SLOT ? null : slot)));
  for (let y = 0; y < grid.length; y += 1) {
    const row = grid[y];
    const below = next[y + step];
    if (!row || !below) {
      continue;
    }
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === MOVING_DETAIL_SLOT) {
        below[x] = MOVING_DETAIL_SLOT;
      }
    }
  }
  return next;
}

const FOAM: PaletteSlotKey = "skin_stand_in";

/**
 * Foam on the waterline, which is the hull's bottom edge. Phase 0 throws a dash ahead of the bow and
 * behind the stern. Phase 1 pulls the dashes onto the hull's ends.
 * `unit` is the side of one dash. A plate drawn larger than the card passes its display divisor, so
 * each dash is one card pixel.
 */
export function waterlineFoam(hull: SpriteFrameGrid, phase: 0 | 1, unit = 1): SpriteFrameGrid {
  const side = Math.max(1, Math.floor(unit));
  const next = cloneGrid(hull);
  let waterline = -1;
  for (let y = hull.length - 1; y >= 0; y -= 1) {
    if (hull[y]?.some((slot) => slot != null)) {
      waterline = y;
      break;
    }
  }
  if (waterline < 0) {
    return next;
  }
  const top = Math.max(0, waterline - side + 1);
  let stern = Number.POSITIVE_INFINITY;
  let bow = -1;
  for (let y = top; y <= waterline; y += 1) {
    const row = hull[y] ?? [];
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] != null) {
        stern = Math.min(stern, x);
        bow = Math.max(bow, x);
      }
    }
  }
  const offsets = phase === 0 ? { bow: [1, -1], stern: [-1, 1] } : { bow: [0, -2], stern: [0, 2] };
  for (const offset of offsets.bow) {
    fillBlock(next, bow + (offset - 1) * side + 1, top, side, waterline - top + 1, FOAM);
  }
  for (const offset of offsets.stern) {
    fillBlock(next, stern + offset * side, top, side, waterline - top + 1, FOAM);
  }
  return next;
}

function fillBlock(grid: SpriteFrameGrid, left: number, top: number, width: number, height: number, slot: PaletteSlotKey): void {
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      paintCell(grid, x, y, slot);
    }
  }
}

/** What a blueprint without `motion` moves by. These are the amounts the 48-pixel starters were drawn for. */
export const LEGACY_SHIFTS: MotionShifts = { bobPx: 1, recoilPx: 2, treadStride: 1 };

/** One card pixel of bob and tread, two of recoil, for a plate scaled down by this divisor. */
export function shiftsForDivisor(divisor: number): MotionShifts {
  const unit = Math.max(1, Math.floor(divisor));
  return { bobPx: unit, recoilPx: unit * 2, treadStride: unit };
}

/**
 * Why these shifts would smear on the card. A shift has to be a whole number of card pixels.
 * The recoil has to be an even number of them, because the windup and the recovery use half of it.
 */
export function shiftProblems(shifts: MotionShifts, divisor: number): string[] {
  const unit = Math.max(1, Math.floor(divisor));
  const problems: string[] = [];
  const whole = (value: number) => Number.isInteger(value) && value >= 0;
  if (!whole(shifts.bobPx) || shifts.bobPx % unit !== 0) {
    problems.push(`Bob ${shifts.bobPx} is not a multiple of ${unit}.`);
  }
  if (!whole(shifts.recoilPx) || shifts.recoilPx % (unit * 2) !== 0) {
    problems.push(`Recoil ${shifts.recoilPx} is not a multiple of ${unit * 2}.`);
  }
  if (!whole(shifts.treadStride) || shifts.treadStride % unit !== 0) {
    problems.push(`Tread stride ${shifts.treadStride} is not a multiple of ${unit}.`);
  }
  return problems;
}

type Shift = readonly [number, number];

export interface PoseRule {
  /** Whole-pixel offsets from the idle layer. A layer not named stays where it is. */
  shift: Record<string, Shift>;
  /** The layer drawn in its alternate phase. */
  alternate?: string;
  /** Which foam pattern the hull carries. */
  foam?: 0 | 1;
  /** The layer that takes the muzzle flash. */
  flash?: string;
}

const ALTERNATE: Record<string, (grid: SpriteFrameGrid, stride: number) => SpriteFrameGrid> = {
  tracks: stepHighlights,
  wheels_tracks: stepHighlights,
  engines_props: stepBlur,
};

/** A flak gun's barrel points up the diagonal, so its recoil slides back and down by the same amount. */
const FLAK_UNIT_TYPES: readonly string[] = ["aaa", "aa"];

/**
 * The offsets Build Animation applies, by pose. Nothing rotates.
 * Infantry is not here: it keeps the march in infantryMarch.ts.
 * The gun takes the whole recoil. Whatever carries the gun takes half.
 */
export function motionRules(
  archetype: Exclude<ArchetypeKey, "infantry">,
  unitTypeId: string,
  shifts: MotionShifts = LEGACY_SHIFTS,
): Record<MovePose, PoseRule> {
  const bob = shifts.bobPx;
  const kick = shifts.recoilPx;
  const half = Math.round(kick / 2);
  switch (archetype) {
    case "tank":
      return {
        move_1: { shift: {}, alternate: "tracks" },
        move_2: { shift: { hull: [0, bob], turret: [0, bob], barrel: [0, bob] } },
        fire: { shift: { hull: [0, bob], turret: [0 - half, bob], barrel: [0 - kick, bob] }, flash: "barrel" },
      };
    case "mech_infantry":
      return {
        move_1: { shift: {}, alternate: "wheels_tracks" },
        move_2: { shift: { chassis: [0, 0 - bob], crew_gun: [0, 0 - bob] } },
        fire: { shift: { crew_gun: [0 - half, 0] } },
      };
    case "artillery":
      return {
        move_1: { shift: {} },
        move_2: { shift: { gun_shield: [0, bob], barrel_breech: [0, bob] } },
        fire: {
          shift: {
            carriage_wheels: [0 - half, 0],
            gun_shield: [0 - half, 0],
            barrel_breech: FLAK_UNIT_TYPES.includes(unitTypeId) ? [0 - half, half] : [0 - kick, 0],
          },
        },
      };
    case "aircraft":
      return {
        move_1: { shift: {}, alternate: "engines_props" },
        move_2: { shift: { engines_props: [0, bob] } },
        fire: { shift: { fuselage_wings: [0 - half, 0], engines_props: [0 - half, 0], tail_markings: [0 - half, 0] }, flash: "engines_props" },
      };
    case "ship":
      return {
        move_1: { shift: {}, foam: 0 },
        move_2: { shift: { hull_waterline: [0, 0 - bob], superstructure: [0, 0 - bob], turrets_masts: [0, 0 - bob] }, foam: 1 },
        fire: { shift: { hull_waterline: [0, bob], superstructure: [0, bob], turrets_masts: [0, bob] }, flash: "turrets_masts" },
      };
  }
}

export interface BuildAnimationOptions {
  /** The UNIT_DEFINITIONS key. A flak gun recoils differently from a field gun. */
  unitTypeId: string;
  /** Where the feet stand. Infantry splits the boots here on the shot. */
  groundX: number;
  /** The gun's tip on the idle pose. No mark, no painted flash. */
  muzzlePoint?: Vec2 | null;
  /** How far the layers move. Left out, they move by the 48-pixel amounts. */
  shifts?: MotionShifts;
  /**
   * The side of one flash or foam block, in plate pixels. A plate passes its display divisor so each
   * block is one card pixel. Left out, a block is one pixel.
   */
  unit?: number;
}

/**
 * Write Move 1, Move 2, and Fire from the idle layers, using whole-pixel shifts and alternate phases.
 * Infantry keeps its march, including a leg drawing already on a step. Every other skeleton is
 * rewritten from idle each time.
 */
export function buildAnimation(archetype: ArchetypeKey, source: LayerFrames, options: BuildAnimationOptions): LayerFrames {
  if (archetype === "infantry") {
    return buildMarch(source as unknown as InfantryLayerFrames, options.groundX);
  }
  const idle = cloneStack(archetype, source.idle);
  const rules = motionRules(archetype, options.unitTypeId, options.shifts);
  return {
    idle,
    move_1: poseFromIdle(archetype, idle, rules.move_1, options),
    move_2: poseFromIdle(archetype, idle, rules.move_2, options),
    fire: poseFromIdle(archetype, idle, rules.fire, options),
  };
}

/**
 * The shot at part of its recoil, built from the idle layers. Half is the windup and the recovery.
 * Each offset is cut back to a whole number of blocks, so a part that only moves one block waits for
 * the peak. The flash is on the peak alone.
 */
export function buildFirePose(
  archetype: Exclude<ArchetypeKey, "infantry">,
  idle: LayerStack,
  options: BuildAnimationOptions,
  fraction: number,
): LayerStack {
  const rule = motionRules(archetype, options.unitTypeId, options.shifts).fire;
  if (fraction >= 1) {
    return poseFromIdle(archetype, idle, rule, options);
  }
  const unit = Math.max(1, Math.floor(options.unit ?? 1));
  const part = (value: number) => Math.trunc((value * Math.max(0, fraction)) / unit) * unit;
  const shift: Record<string, Shift> = {};
  for (const [layer, [dx, dy]] of Object.entries(rule.shift)) {
    shift[layer] = [part(dx), part(dy)];
  }
  return poseFromIdle(archetype, idle, { shift }, options);
}

/**
 * The layers one playback beat shows. The stored poses cover the whole beats. A half-recoil beat is
 * built here from the idle layers, so no fifth pose is kept. A rifleman has no half recoil and shows
 * the beat's flat pose.
 */
export function beatStack(
  archetype: ArchetypeKey,
  frames: LayerFrames,
  beat: { pose: SpriteFrameKey; recoil: number; flat: SpriteFrameKey },
  options: BuildAnimationOptions,
): LayerStack {
  if (archetype === "infantry") {
    return frames[beat.flat];
  }
  if (beat.recoil > 0 && beat.recoil < 1) {
    return buildFirePose(archetype, frames.idle, options, beat.recoil);
  }
  return frames[beat.pose];
}

function poseFromIdle(archetype: ArchetypeKey, idle: LayerStack, rule: PoseRule, options: BuildAnimationOptions): LayerStack {
  const { width, height } = stackSize(archetype, idle);
  const unit = Math.max(1, Math.floor(options.unit ?? 1));
  const stride = options.shifts?.treadStride ?? LEGACY_SHIFTS.treadStride;
  const stack: LayerStack = {};
  for (const layer of ARCHETYPE_LAYERS[archetype]) {
    let grid = idle[layer] ?? emptyGrid(width, height);
    const phase = ALTERNATE[layer];
    if (rule.alternate === layer && phase) {
      grid = phase(grid, stride);
    }
    if (rule.foam !== undefined && layer === "hull_waterline") {
      grid = waterlineFoam(grid, rule.foam, unit);
    }
    const [dx, dy] = rule.shift[layer] ?? [0, 0];
    stack[layer] = dx !== 0 || dy !== 0 ? shiftGrid(grid, dx, dy) : cloneGrid(grid);
  }
  const target = rule.flash ? stack[rule.flash] : undefined;
  if (rule.flash && target && options.muzzlePoint) {
    const [dx, dy] = rule.shift[rule.flash] ?? [0, 0];
    paintFlash(target, { x: options.muzzlePoint.x + dx, y: options.muzzlePoint.y + dy }, unit);
    if (archetype === "aircraft") {
      for (const gun of wingGuns(idle.fuselage_wings, options.muzzlePoint)) {
        const [wx, wy] = rule.shift.fuselage_wings ?? [0, 0];
        flashBlock(target, { x: gun.x + wx, y: gun.y + wy }, 1, 0, unit, "skin_stand_in");
        flashBlock(target, { x: gun.x + wx, y: gun.y + wy }, 2, 0, unit, "insignia_accent");
      }
    }
  }
  return stack;
}

/** Two light blocks ahead of the gun's tip, with the faction's accent above and below the first. */
function paintFlash(grid: SpriteFrameGrid, tip: Vec2, unit: number): void {
  flashBlock(grid, tip, 1, 0, unit, "skin_stand_in");
  flashBlock(grid, tip, 2, 0, unit, "skin_stand_in");
  flashBlock(grid, tip, 1, -1, unit, "insignia_accent");
  flashBlock(grid, tip, 1, 1, unit, "insignia_accent");
}

/** One block of the flash, `across` blocks ahead of the tip and `down` blocks below it. The middle row is centred on the tip. */
function flashBlock(grid: SpriteFrameGrid, tip: Vec2, across: number, down: number, unit: number, slot: PaletteSlotKey): void {
  const left = tip.x + 1 + (across - 1) * unit;
  const top = tip.y - Math.floor((unit - 1) / 2) + down * unit;
  fillBlock(grid, left, top, unit, unit, slot);
}

/** A gun on each wing, halfway from the fuselage to the tip, on the leading edge. */
function wingGuns(wings: SpriteFrameGrid | undefined, nose: Vec2): Vec2[] {
  if (!wings) {
    return [];
  }
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < wings.length; y += 1) {
    if (wings[y]?.some((slot) => slot != null)) {
      if (top < 0) {
        top = y;
      }
      bottom = y;
    }
  }
  const reach = Math.round((bottom - top) / 4);
  if (top < 0 || reach < 2) {
    return [];
  }
  const guns: Vec2[] = [];
  for (const y of [nose.y - reach, nose.y + reach]) {
    const row = wings[y];
    if (!row) {
      continue;
    }
    for (let x = row.length - 1; x >= 0; x -= 1) {
      if (row[x] != null) {
        guns.push({ x, y });
        break;
      }
    }
  }
  return guns;
}

function paintCell(grid: SpriteFrameGrid, x: number, y: number, slot: PaletteSlotKey): void {
  const row = grid[y];
  if (row && x >= 0 && x < row.length) {
    row[x] = slot;
  }
}

function stackSize(archetype: ArchetypeKey, stack: LayerStack): { width: number; height: number } {
  for (const layer of ARCHETYPE_LAYERS[archetype]) {
    const grid = stack[layer];
    if (grid && grid.length > 0) {
      return { width: grid[0]?.length ?? 0, height: grid.length };
    }
  }
  return { width: 0, height: 0 };
}
