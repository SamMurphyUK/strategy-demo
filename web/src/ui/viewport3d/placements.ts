// Where the board's 3D objects stand, and the edits the placement editor makes to them. Pure.
//
// Every object the board draws has a key: `pine:12` is the thirteenth pine of the plan, `landmark:paris`
// is the Paris landmark. The plan and the landmark defaults come from code and are repeatable, so an
// edit is stored as a change to the default and not as a position. Change the plan a little and the
// edits still land on the same trees.
import type { Vec2 } from "../map/geometry";
import { PROP_KINDS, type PropInstance, type PropKind, type PropPlan } from "./propPlan";

/** The edit to one object. All zero and unlocked is no edit. */
export interface Edit {
  /** Moves along the map, in world units. x runs east, y runs south, as the map does. */
  dx: number;
  dy: number;
  /** Lifts above the ground, in world units. */
  dz: number;
  /** Whole-object size, applied to the width and the height together so a model is never squashed. */
  mult: number;
  /** Turn about the vertical, in radians. */
  dturn: number;
  /** A locked object is kept as it is: the editor will not move, resize, or turn it. */
  locked: boolean;
}

export type Placements = Record<string, Edit>;

export const NO_EDIT: Readonly<Edit> = Object.freeze({ dx: 0, dy: 0, dz: 0, mult: 1, dturn: 0, locked: false });

export const SIZE_STEP = 1.1;
export const SIZE_MIN = 0.25;
export const SIZE_MAX = 6;
export const LIFT_MIN = -2;
export const LIFT_MAX = 24;
export const TURN_STEP = Math.PI / 12;

export type Axis = "x" | "y" | "z";

export function propKey(kind: PropKind, index: number): string {
  return `${kind}:${index}`;
}

export function landmarkKey(id: string): string {
  return `landmark:${id}`;
}

export function isEdit(edit: Edit | undefined): boolean {
  return (
    edit !== undefined &&
    (edit.dx !== 0 || edit.dy !== 0 || edit.dz !== 0 || edit.mult !== 1 || edit.dturn !== 0 || edit.locked)
  );
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Moves an object one step along an axis. A locked object does not move. */
export function nudge(edit: Edit | undefined, axis: Axis, amount: number): Edit {
  const base = edit ?? NO_EDIT;
  if (base.locked) {
    return { ...base };
  }
  if (axis === "x") {
    return { ...base, dx: round(base.dx + amount) };
  }
  if (axis === "y") {
    return { ...base, dy: round(base.dy + amount) };
  }
  return { ...base, dz: round(Math.min(LIFT_MAX, Math.max(LIFT_MIN, base.dz + amount))) };
}

/** Makes an object a step bigger (`direction` 1) or smaller (-1), by the same ratio on every side. */
export function resize(edit: Edit | undefined, direction: 1 | -1): Edit {
  const base = edit ?? NO_EDIT;
  if (base.locked) {
    return { ...base };
  }
  const next = direction > 0 ? base.mult * SIZE_STEP : base.mult / SIZE_STEP;
  return { ...base, mult: round(Math.min(SIZE_MAX, Math.max(SIZE_MIN, next))) };
}

export function turn(edit: Edit | undefined, direction: 1 | -1): Edit {
  const base = edit ?? NO_EDIT;
  if (base.locked) {
    return { ...base };
  }
  const next = (base.dturn + direction * TURN_STEP) % (Math.PI * 2);
  return { ...base, dturn: round(next) };
}

export function setLocked(edit: Edit | undefined, locked: boolean): Edit {
  return { ...(edit ?? NO_EDIT), locked };
}

/** The object as the edit leaves it. */
export function applyEdit(prop: PropInstance, edit: Edit | undefined): PropInstance {
  if (edit === undefined || !isEdit(edit)) {
    return prop;
  }
  return {
    ...prop,
    x: prop.x + edit.dx,
    y: prop.y + edit.dy,
    lift: (prop.lift ?? 0) + edit.dz,
    scale: prop.scale * edit.mult,
    height: prop.height * edit.mult,
    turn: prop.turn + edit.dturn,
  };
}

/** The plan with every edit applied. A kind with no edit keeps its own array, so its model is not rebuilt. */
export function applyPlacements(plan: PropPlan, placements: Placements): PropPlan {
  const props = { ...plan.props };
  for (const kind of PROP_KINDS) {
    const source = plan.props[kind];
    let touched = false;
    const next = source.map((prop, index) => {
      const edit = placements[propKey(kind, index)];
      if (!isEdit(edit)) {
        return prop;
      }
      touched = true;
      return applyEdit(prop, edit);
    });
    props[kind] = touched ? next : source;
  }
  return { ...plan, props };
}

// --- Landmarks ----------------------------------------------------------------------------------

export interface LandmarkSpec {
  id: string;
  label: string;
  /** The territory it stands in, by the map's name for it. */
  region: string;
}

/** The ten landmarks in assets/models/landmarks, each standing in its city's territory. */
export const LANDMARKS: readonly LandmarkSpec[] = [
  { id: "berlin", label: "Berlin", region: "Germany" },
  { id: "paris", label: "Paris", region: "France" },
  { id: "london", label: "London", region: "United Kingdom" },
  { id: "moscow", label: "Moscow", region: "Moscow" },
  { id: "leningrad", label: "Leningrad", region: "Petersburgh" },
  { id: "stalingrad", label: "Stalingrad", region: "Volgads" },
  { id: "washington", label: "Washington", region: "Eastern US" },
  { id: "ottawa", label: "Ottawa", region: "Canada" },
  { id: "cairo", label: "Cairo", region: "Egypt" },
  { id: "rome", label: "Rome", region: "Italy" },
];

/**
 * A landmark's width on the board, in world units, for a model about one unit wide. At the closest
 * zoom a unit token is about ten world units across and a factory under three, so a landmark is
 * most of a token wide: the city's one great building, big enough to name at a glance without
 * covering the stack beside it.
 */
export const LANDMARK_SCALE = 8;
/** How far north of the territory's unit anchor a landmark stands by default, in world units. */
export const LANDMARK_NORTH = 12;

export interface PlacedLandmark {
  id: string;
  key: string;
  spec: LandmarkSpec;
  instance: PropInstance;
}

/** Every landmark whose territory is on the map, with its edit applied. */
export function placeLandmarks(anchorOf: (region: string) => Vec2 | null, placements: Placements): PlacedLandmark[] {
  const placed: PlacedLandmark[] = [];
  for (const spec of LANDMARKS) {
    const anchor = anchorOf(spec.region);
    if (!anchor) {
      continue;
    }
    const base: PropInstance = {
      x: anchor.x,
      y: anchor.y - LANDMARK_NORTH,
      scale: LANDMARK_SCALE,
      height: LANDMARK_SCALE,
      turn: 0,
      tint: [1, 1, 1],
      snow: 0,
    };
    const key = landmarkKey(spec.id);
    placed.push({ id: spec.id, key, spec, instance: applyEdit(base, placements[key]) });
  }
  return placed;
}

// --- Saving -------------------------------------------------------------------------------------

export interface PlacementFile {
  version: 1;
  items: Placements;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Reads a saved file, dropping anything that is not an edit. Never throws. */
export function parsePlacements(json: unknown): Placements {
  const items = (json as { items?: unknown } | null)?.items;
  if (typeof items !== "object" || items === null || Array.isArray(items)) {
    return {};
  }
  const out: Placements = {};
  for (const [key, raw] of Object.entries(items as Record<string, unknown>)) {
    if (!/^[a-z]+:[A-Za-z0-9_-]+$/.test(key) || typeof raw !== "object" || raw === null) {
      continue;
    }
    const r = raw as Record<string, unknown>;
    const edit: Edit = {
      dx: finite(r.dx, 0),
      dy: finite(r.dy, 0),
      dz: Math.min(LIFT_MAX, Math.max(LIFT_MIN, finite(r.dz, 0))),
      mult: Math.min(SIZE_MAX, Math.max(SIZE_MIN, finite(r.mult, 1))),
      dturn: finite(r.dturn, 0),
      locked: r.locked === true,
    };
    if (isEdit(edit)) {
      out[key] = edit;
    }
  }
  return out;
}

/** The file to save: only objects that have an edit, in a stable order. */
export function serializePlacements(placements: Placements): PlacementFile {
  const items: Placements = {};
  for (const key of Object.keys(placements).sort()) {
    if (isEdit(placements[key])) {
      items[key] = placements[key];
    }
  }
  return { version: 1, items };
}

export const PLACEMENTS_STORAGE_KEY = "strategy-demo.placements";
export const PLACEMENTS_ROUTE = "/__dev/placements";
