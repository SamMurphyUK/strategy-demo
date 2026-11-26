// The islands' own heights, a territory at a time. Kept in this browser; the board reads them every frame.
//
// A territory on an island can stand lower than the global island scale (`islandElevationScale`): 1 is as tall as the continents, lower
// leaves less of the cliff (see ../viewport3d/islandLowering.ts). A territory with no entry here takes the global scale.

const KEY = "strategy-demo.island-scales";
let scales: Record<string, number> = load();
const listeners = new Set<() => void>();
let revision = 0;

function load(): Record<string, number> {
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, number> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        out[id] = Math.min(1, Math.max(0.15, value));
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function getIslandScales(): Readonly<Record<string, number>> {
  return scales;
}

export function getIslandRevision(): number {
  return revision;
}

/** Sets a territory's own island scale, or clears it with null. */
export function setIslandScale(regionId: string, value: number | null): void {
  const next = { ...scales };
  if (value === null || !Number.isFinite(value)) {
    delete next[regionId];
  } else {
    next[regionId] = Math.min(1, Math.max(0.15, value));
  }
  scales = next;
  revision += 1;
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.setItem(KEY, JSON.stringify(scales));
  } catch {
    // Without storage the setting lasts for the session.
  }
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeIslandScales(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
