// Live coast tune for the campaign map. The locked file is the startup copy. localStorage
// wins when it is present, so a refresh before the file write still holds the sliders.
import fileTune from "./coastTune.json";
import { canonicalCoastTune, parseCoastTune, shippedCoastTune, type CoastTune } from "./coastTune";

export const COAST_TUNE_STORAGE_KEY = "strategy-demo.coast-tune";
export const COAST_TUNE_ROUTE = "/__dev/coast-tune";

let current: CoastTune = loadCoastTune();
let rev = 0;
const listeners = new Set<() => void>();

function loadCoastTune(): CoastTune {
  return readStored() ?? parseCoastTune(fileTune) ?? shippedCoastTune();
}

function readStored(): CoastTune | null {
  try {
    const storage = (globalThis as { localStorage?: { getItem(key: string): string | null } }).localStorage;
    if (!storage || typeof storage.getItem !== "function") {
      return null;
    }
    const raw = storage.getItem(COAST_TUNE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return parseCoastTune(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeStored(tune: CoastTune): void {
  try {
    const storage = (globalThis as { localStorage?: { setItem(key: string, value: string): void } }).localStorage;
    storage?.setItem(COAST_TUNE_STORAGE_KEY, JSON.stringify(tune));
  } catch {
    // The slider still moves. Lock in is what keeps the numbers in the file.
  }
}

function publish(): void {
  rev += 1;
  for (const listener of [...listeners]) {
    listener();
  }
}

export function getCoastTune(): CoastTune {
  return current;
}

export function getCoastTuneRev(): number {
  return rev;
}

export function subscribeCoastTune(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setCoastTune(next: CoastTune): void {
  current = canonicalCoastTune(next);
  writeStored(current);
  publish();
}

export function resetCoastTune(): void {
  setCoastTune(shippedCoastTune());
}

/** Writes the live tune into coastTune.json. Empty string on success, otherwise a short error. */
export async function lockCoastTune(): Promise<string> {
  const tune = canonicalCoastTune(current);
  writeStored(tune);
  try {
    const response = await fetch(COAST_TUNE_ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tune),
    });
    let body: { ok?: boolean; error?: string } = {};
    try {
      body = (await response.json()) as { ok?: boolean; error?: string };
    } catch {
      body = {};
    }
    if (!response.ok || body.ok !== true) {
      return body.error || "The coast tune was not written.";
    }
    return "";
  } catch {
    return "The dev server did not take the coast tune.";
  }
}
