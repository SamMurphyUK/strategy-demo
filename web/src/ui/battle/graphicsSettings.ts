/** Picture switches shared by the editor, the battle map, and a real battle. */

export interface GraphicsSettings {
  /** Soft band on the horizon. */
  mist: boolean;
  /** Stars twinkle and clouds drift. Off, the sky holds still until the light changes. */
  liveSky: boolean;
  /** Keep a unit picture sharp at the screen's own size. Off, one picture is scaled. */
  crispPictures: boolean;
  /** The sea tile scrolls. Off, the water keeps its shape and does not move. */
  animatedSea: boolean;
}

export const GRAPHICS_DEFAULTS: GraphicsSettings = {
  mist: true,
  liveSky: true,
  crispPictures: true,
  animatedSea: true,
};

const STORAGE_KEY = "strategy-demo.graphics";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function graphicsFromJson(raw: string | null): GraphicsSettings {
  if (!raw) return {...GRAPHICS_DEFAULTS};
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof GraphicsSettings, unknown>>;
    const on = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
    return {
      mist: on(parsed.mist, GRAPHICS_DEFAULTS.mist),
      liveSky: on(parsed.liveSky, GRAPHICS_DEFAULTS.liveSky),
      crispPictures: on(parsed.crispPictures, GRAPHICS_DEFAULTS.crispPictures),
      animatedSea: on(parsed.animatedSea, GRAPHICS_DEFAULTS.animatedSea),
    };
  } catch {
    return {...GRAPHICS_DEFAULTS};
  }
}

let current: GraphicsSettings = graphicsFromJson(storage()?.getItem(STORAGE_KEY) ?? null);
const listeners = new Set<() => void>();

export function graphicsSettings(): GraphicsSettings {
  return current;
}

export function setGraphicsSettings(patch: Partial<GraphicsSettings>): void {
  const next: GraphicsSettings = {...current, ...patch};
  if (
    next.mist === current.mist &&
    next.liveSky === current.liveSky &&
    next.crispPictures === current.crispPictures &&
    next.animatedSea === current.animatedSea
  ) {
    return;
  }
  current = next;
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // A private window can refuse the save. The switch still applies for this visit.
  }
  for (const listener of listeners) listener();
}

export function subscribeGraphics(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
