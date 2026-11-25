// The campaign board's live picture. localStorage keeps a refresh on the same sliders.
import { currentTune, type BoardTune } from "./boardTune";

export const BOARD_TUNE_STORAGE_KEY = "strategy-demo.board-tune";

let current: BoardTune = loadTune();
let rev = 0;
const listeners = new Set<() => void>();

function loadTune(): BoardTune {
  return readStored() ?? currentTune();
}

function readStored(): BoardTune | null {
  try {
    const storage = (globalThis as { localStorage?: { getItem(key: string): string | null } }).localStorage;
    const raw = storage?.getItem(BOARD_TUNE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return parseTune(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeStored(tune: BoardTune): void {
  try {
    const storage = (globalThis as { localStorage?: { setItem(key: string, value: string): void } }).localStorage;
    storage?.setItem(BOARD_TUNE_STORAGE_KEY, JSON.stringify(tune));
  } catch {
    // The slider still moves for this page.
  }
}

function clearStored(): void {
  try {
    const storage = (globalThis as { localStorage?: { removeItem(key: string): void } }).localStorage;
    storage?.removeItem(BOARD_TUNE_STORAGE_KEY);
  } catch {
    // The in-memory tune is what the map reads.
  }
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function knobOf(value: unknown, fallback: BoardTune["props"]): BoardTune["props"] {
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const raw = value as { on?: unknown; amount?: unknown };
  return {
    on: typeof raw.on === "boolean" ? raw.on : fallback.on,
    amount: num(raw.amount, fallback.amount),
  };
}

/** A stored tune with anything missing filled from the current picture. Null when it is not an object. */
export function parseTune(value: unknown): BoardTune | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<BoardTune>;
  const base = currentTune();
  const look = raw.look === "vanilla" || raw.look === "custom" || raw.look === "current" ? raw.look : base.look;
  const palette = raw.palette === "parchment" || raw.palette === "strip" ? raw.palette : base.palette;
  const borders = raw.borders === "previous" || raw.borders === "current" ? raw.borders : base.borders;
  const colors: BoardTune["colors"] = {};
  if (raw.colors && typeof raw.colors === "object") {
    for (const [key, color] of Object.entries(raw.colors)) {
      if (typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color)) {
        colors[key as keyof BoardTune["colors"]] = color;
      }
    }
  }
  return {
    look,
    tilt: {
      start: num(raw.tilt?.start, base.tilt.start),
      end: num(raw.tilt?.end, base.tilt.end),
      far: num(raw.tilt?.far, base.tilt.far),
      near: num(raw.tilt?.near, base.tilt.near),
    },
    unit: {
      start: num(raw.unit?.start, base.unit.start),
      end: num(raw.unit?.end, base.unit.end),
      far: num(raw.unit?.far, base.unit.far),
      near: num(raw.unit?.near, base.unit.near),
    },
    terrainFrom: num(raw.terrainFrom, base.terrainFrom),
    terrainTo: num(raw.terrainTo, base.terrainTo),
    props: knobOf(raw.props, base.props),
    relief: knobOf(raw.relief, base.relief),
    water: knobOf(raw.water, base.water),
    smoke: knobOf(raw.smoke, base.smoke),
    vignette: knobOf(raw.vignette, base.vignette),
    focus: knobOf(raw.focus, base.focus),
    gradeZoom: typeof raw.gradeZoom === "boolean" ? raw.gradeZoom : base.gradeZoom,
    saturation: num(raw.saturation, base.saturation),
    warmZoom: typeof raw.warmZoom === "boolean" ? raw.warmZoom : base.warmZoom,
    warm: num(raw.warm, base.warm),
    palette,
    colors,
    borders,
    territoryLines: typeof raw.territoryLines === "boolean" ? raw.territoryLines : false,
    enemyBand: typeof raw.enemyBand === "boolean" ? raw.enemyBand : false,
  };
}

function publish(): void {
  rev += 1;
  for (const listener of [...listeners]) {
    listener();
  }
}

export function getBoardTune(): BoardTune {
  return current;
}

export function getTiltCurve(): BoardTune["tilt"] {
  return current.tilt;
}

export function getBoardTuneRev(): number {
  return rev;
}

export function subscribeBoardTune(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setBoardTune(next: BoardTune): void {
  current = parseTune(next) ?? currentTune();
  writeStored(current);
  publish();
}

export function resetBoardTune(): void {
  current = currentTune();
  clearStored();
  publish();
}
