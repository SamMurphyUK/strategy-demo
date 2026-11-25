// The unit-transform presets in this browser (see unitTransforms.ts), and the people listening to them.
import {
  EMPTY_TRANSFORMS,
  parseTransforms,
  serializeTransforms,
  type UnitTransform,
  type UnitTransformSet,
  withPreset,
} from "./unitTransforms";

export const UNIT_TRANSFORMS_STORAGE_KEY = "strategy-demo.unit-transforms";

function load(): UnitTransformSet {
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(UNIT_TRANSFORMS_STORAGE_KEY);
    return raw ? parseTransforms(JSON.parse(raw)) : EMPTY_TRANSFORMS;
  } catch {
    return EMPTY_TRANSFORMS;
  }
}

let current: UnitTransformSet = load();
let rev = 0;
const listeners = new Set<() => void>();

export function getUnitTransforms(): UnitTransformSet {
  return current;
}

export function getUnitTransformRev(): number {
  return rev;
}

export function subscribeUnitTransforms(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function commit(next: UnitTransformSet): void {
  current = next;
  rev += 1;
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.setItem(UNIT_TRANSFORMS_STORAGE_KEY, JSON.stringify(serializeTransforms(next)));
  } catch {
    // The preset is a convenience. Not keeping it costs nothing.
  }
  for (const listener of listeners) {
    listener();
  }
}

export function setUnitPreset(key: string, transform: UnitTransform): void {
  commit(withPreset(current, key, transform));
}

export function resetUnitPresets(): void {
  commit(EMPTY_TRANSFORMS);
}
