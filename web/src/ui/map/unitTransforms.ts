// How the detailed unit figures are moved on their bases, by preset. Pure.
//
// A preset is a small move for a figure: along x and y, up off the ground (z), a tilt toward or away
// from the camera, and a turn. It is kept for a scope (all units, one faction, or one unit type) and
// for a stack size (one unit, two, or three and more), so a pair can stand a little apart and a
// crowd can spread. Of the presets that cover a stack, the most specific wins: the unit type, then
// the faction, then all units.

export type TransformScope = "all" | "faction" | "archetype";
/** 1 is one unit, 2 is a pair, 3 is three or more. */
export type StackBucket = 1 | 2 | 3;

export interface UnitTransform {
  /** Moves across the screen and down it, in CSS pixels. */
  dx: number;
  dy: number;
  /** Lifts off the ground, in CSS pixels. */
  dz: number;
  /** Leans the figure toward the camera (+) or away (-), in degrees. It shortens the figure, as a lean does. */
  tilt: number;
  /** Turns the figure about its feet, in degrees. */
  rot: number;
}

export const NO_TRANSFORM: Readonly<UnitTransform> = Object.freeze({ dx: 0, dy: 0, dz: 0, tilt: 0, rot: 0 });

export const TRANSFORM_RANGES: Readonly<Record<keyof UnitTransform, readonly [number, number]>> = Object.freeze({
  dx: [-40, 40],
  dy: [-40, 40],
  dz: [-40, 40],
  tilt: [-60, 60],
  rot: [-180, 180],
});

export interface UnitTransformSet {
  version: 1;
  /** Keyed `scope|id|bucket`: `all||1`, `faction|GER|2`, `archetype|tank|3`. */
  presets: Record<string, UnitTransform>;
}

export const EMPTY_TRANSFORMS: UnitTransformSet = Object.freeze({ version: 1, presets: {} }) as UnitTransformSet;

export function bucketOf(count: number): StackBucket {
  return count >= 3 ? 3 : count >= 2 ? 2 : 1;
}

export function presetKey(scope: TransformScope, id: string, bucket: StackBucket): string {
  return `${scope}|${scope === "all" ? "" : id}|${bucket}`;
}

export function isTransform(value: UnitTransform | undefined): boolean {
  return value !== undefined && (value.dx !== 0 || value.dy !== 0 || value.dz !== 0 || value.tilt !== 0 || value.rot !== 0);
}

/** The preset that covers a stack: the unit type's, else the faction's, else all units'. None is no move. */
export function resolveTransform(set: UnitTransformSet, factionId: string, unitType: string, count: number): Readonly<UnitTransform> {
  const bucket = bucketOf(count);
  return (
    set.presets[presetKey("archetype", unitType, bucket)] ??
    set.presets[presetKey("faction", factionId, bucket)] ??
    set.presets[presetKey("all", "", bucket)] ??
    NO_TRANSFORM
  );
}

function clamp(value: unknown, [low, high]: readonly [number, number]): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : 0;
}

/** Puts a preset in, or takes it out when it moves nothing. Returns a new set. */
export function withPreset(set: UnitTransformSet, key: string, transform: UnitTransform): UnitTransformSet {
  const presets = { ...set.presets };
  const clean: UnitTransform = {
    dx: clamp(transform.dx, TRANSFORM_RANGES.dx),
    dy: clamp(transform.dy, TRANSFORM_RANGES.dy),
    dz: clamp(transform.dz, TRANSFORM_RANGES.dz),
    tilt: clamp(transform.tilt, TRANSFORM_RANGES.tilt),
    rot: clamp(transform.rot, TRANSFORM_RANGES.rot),
  };
  if (isTransform(clean)) {
    presets[key] = clean;
  } else {
    delete presets[key];
  }
  return { version: 1, presets };
}

/** Reads a saved set, dropping anything that is not a preset. Never throws. */
export function parseTransforms(json: unknown): UnitTransformSet {
  const raw = (json as { presets?: unknown } | null)?.presets;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return EMPTY_TRANSFORMS;
  }
  let set: UnitTransformSet = EMPTY_TRANSFORMS;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^(all|faction|archetype)\|[A-Za-z0-9_-]*\|[123]$/.test(key) || typeof value !== "object" || value === null) {
      continue;
    }
    const v = value as Record<string, unknown>;
    set = withPreset(set, key, {
      dx: clamp(v.dx, TRANSFORM_RANGES.dx),
      dy: clamp(v.dy, TRANSFORM_RANGES.dy),
      dz: clamp(v.dz, TRANSFORM_RANGES.dz),
      tilt: clamp(v.tilt, TRANSFORM_RANGES.tilt),
      rot: clamp(v.rot, TRANSFORM_RANGES.rot),
    });
  }
  return set;
}

/** The file to save: presets in a stable order. */
export function serializeTransforms(set: UnitTransformSet): UnitTransformSet {
  const presets: Record<string, UnitTransform> = {};
  for (const key of Object.keys(set.presets).sort()) {
    presets[key] = set.presets[key];
  }
  return { version: 1, presets };
}
