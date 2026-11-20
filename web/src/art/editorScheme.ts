import { archetypeForUnitType, type ArchetypeKey } from "./archetypeLayers";
import { LAYER_ORDER } from "./frameClips";
import type { PartCategory } from "./paperDoll";

/** One layer the sprite editor shows, bottom to top. `id` is the slot the rig stores. */
export interface EditorLayer {
  id: PartCategory;
  label: string;
}

export interface EditorScheme {
  /** Paint order, underneath first. A later layer covers an earlier one. */
  layers: readonly EditorLayer[];
  /** Where a loaded picture sits until it is peeled onto the other layers. */
  picture: PartCategory;
  /** Muzzle marks are stored on this layer and move with it. */
  muzzle: PartCategory;
}

function scheme(labels: readonly string[], picture: PartCategory, muzzle: PartCategory): EditorScheme {
  return {
    layers: labels.map((label, index) => ({ id: LAYER_ORDER[index] ?? "torso", label })),
    picture,
    muzzle,
  };
}

const INFANTRY = scheme(["Legs", "Torso", "Head", "Weapon"], "torso", "weapon");
const SHIP = scheme(["Hull", "Guns", "Top deck"], "legs", "torso");
const AIRCRAFT = scheme(["Chassis", "Propeller"], "legs", "legs");
const ARTILLERY = scheme(["Wheel", "Carriage", "Gun"], "torso", "head");
const VEHICLE = scheme(["Tracks", "Hull", "Gun"], "torso", "head");

export function editorSchemeForArchetype(archetype: ArchetypeKey | null): EditorScheme {
  if (archetype === "ship") return SHIP;
  if (archetype === "aircraft") return AIRCRAFT;
  if (archetype === "artillery") return ARTILLERY;
  if (archetype === "tank" || archetype === "mech_infantry") return VEHICLE;
  return INFANTRY;
}

export function editorSchemeForUnitType(unitTypeId: string): EditorScheme {
  return editorSchemeForArchetype(archetypeForUnitType(unitTypeId));
}

/** `ger_battleship_seed1` is a battleship. The Japanese walk is infantry. */
export function unitTypeFromRigId(unitId: string): string {
  if (unitId === "jap_infantry" || unitId.endsWith("_infantry")) return "infantry";
  const seeded = /^[a-z0-9]+_(.+)_seed\d+$/.exec(unitId);
  return seeded?.[1] ?? "infantry";
}

export function editorSchemeForRig(unitId: string): EditorScheme {
  return editorSchemeForUnitType(unitTypeFromRigId(unitId));
}
