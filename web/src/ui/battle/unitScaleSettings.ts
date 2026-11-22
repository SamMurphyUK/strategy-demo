/** Per-class picture size for a battle. One percentage for every faction. */

import { UNIT_DEFINITIONS, type UnitType } from "./combatTypes";

export const UNIT_SCALE_MIN = 25;
export const UNIT_SCALE_MAX = 300;
export const UNIT_SCALE_DEFAULT = 100;

const STORAGE_KEY = "strategy-demo.unit-scale";

export const UNIT_TYPES = Object.keys(UNIT_DEFINITIONS) as UnitType[];

export interface UnitSizeRow {
  type: UnitType;
  label: string;
}

export interface UnitSizeGroup {
  title: string;
  types: UnitSizeRow[];
}

/** Every battle class, in the order the menu shows them. */
export const UNIT_SIZE_GROUPS: UnitSizeGroup[] = [
  {
    title: "Land",
    types: [
      { type: "infantry", label: "Infantry" },
      { type: "mech_infantry", label: "Mechanised" },
      { type: "artillery", label: "Artillery" },
      { type: "aaa", label: "Flak" },
      { type: "aa", label: "Anti-air" },
      { type: "tank", label: "Tank" },
      { type: "armor", label: "Armor" },
    ],
  },
  {
    title: "Air",
    types: [
      { type: "fighter", label: "Fighter" },
      { type: "tactical_bomber", label: "Tactical bomber" },
      { type: "strategic_bomber", label: "Strategic bomber" },
    ],
  },
  {
    title: "Sea",
    types: [
      { type: "submarine", label: "Submarine" },
      { type: "transport", label: "Transport" },
      { type: "destroyer", label: "Destroyer" },
      { type: "cruiser", label: "Cruiser" },
      { type: "carrier", label: "Carrier" },
      { type: "battleship", label: "Battleship" },
    ],
  },
];

export type UnitScaleSettings = Record<UnitType, number>;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function clampUnitPercent(percent: number): number {
  if (!Number.isFinite(percent)) return UNIT_SCALE_DEFAULT;
  return Math.min(UNIT_SCALE_MAX, Math.max(UNIT_SCALE_MIN, Math.round(percent)));
}

export function defaultUnitScales(): UnitScaleSettings {
  return Object.fromEntries(UNIT_TYPES.map((type) => [type, UNIT_SCALE_DEFAULT])) as UnitScaleSettings;
}

export function unitScalesFromJson(raw: string | null): UnitScaleSettings {
  const next = defaultUnitScales();
  if (!raw) return next;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const type of UNIT_TYPES) {
      const value = parsed[type];
      if (typeof value === "number") next[type] = clampUnitPercent(value);
    }
  } catch {
    return defaultUnitScales();
  }
  return next;
}

let current: UnitScaleSettings = unitScalesFromJson(storage()?.getItem(STORAGE_KEY) ?? null);
const listeners = new Set<() => void>();

export function unitScales(): UnitScaleSettings {
  return current;
}

/** 1 is the picture's normal battle size. */
export function unitClassFactor(type: UnitType): number {
  return current[type] / 100;
}

export function setUnitClassScale(type: UnitType, percent: number): void {
  const next = clampUnitPercent(percent);
  if (current[type] === next) return;
  current = { ...current, [type]: next };
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // A private window can refuse the save. The size still applies for this visit.
  }
  for (const listener of listeners) listener();
}

export function subscribeUnitScales(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
