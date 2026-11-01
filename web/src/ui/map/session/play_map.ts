// Which map New game boots. The demo file is the built-in board. Named versions live in this browser.
import { prepareSavedMap } from "../../../content/game_scene_session_builder";
import type { Dict } from "../../../engine/model/types";
import { parseVersionLibrary, VERSIONS_KEY, type MapVersion } from "../editor/mapVersions";
import { projectMapJson } from "../map_space";

export const DEMO_MAP_ID = "demo";
export const PLAY_MAP_KEY = "strategy-demo.play-map.v1";

export interface PlayChoice {
  id: string;
  name: string;
  /** World-space map JSON. Null means the built-in demo file, booted on its own path. */
  map: Dict | null;
}

export function demoPlayChoice(): PlayChoice {
  return { id: DEMO_MAP_ID, name: "Demo map", map: null };
}

export function playChoiceFromVersion(version: MapVersion): PlayChoice {
  return {
    id: version.id,
    name: version.name,
    map: projectMapJson(prepareSavedMap(version.map)),
  };
}

export function choiceForStoredId(versions: MapVersion[], id: string): PlayChoice {
  const version = versions.find((v) => v.id === id);
  return version ? playChoiceFromVersion(version) : demoPlayChoice();
}

interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): KeyValueStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredPlayId(storage: KeyValueStore | null = browserStorage()): string {
  if (!storage) {
    return DEMO_MAP_ID;
  }
  try {
    const id = storage.getItem(PLAY_MAP_KEY);
    return id && id.trim() !== "" ? id : DEMO_MAP_ID;
  } catch {
    return DEMO_MAP_ID;
  }
}

export function rememberPlayId(id: string, storage: KeyValueStore | null = browserStorage()): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(PLAY_MAP_KEY, id);
  } catch {
    // The game still starts. The next visit falls back to the demo map.
  }
}

/** The map to boot on a fresh page: the last one played, when that version is still saved. */
export function initialPlayChoice(storage: KeyValueStore | null = browserStorage()): PlayChoice {
  if (!storage) {
    return demoPlayChoice();
  }
  try {
    return choiceForStoredId(parseVersionLibrary(storage.getItem(VERSIONS_KEY)), readStoredPlayId(storage));
  } catch {
    return demoPlayChoice();
  }
}
