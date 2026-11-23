// A campaign in progress, kept in this browser or handed around as JSON.
import type { Dict } from "../../../engine/model/types";
import { isDict } from "../../../engine/model/types";
import type { StubStateSnapshot } from "../../../engine/session/game_session_stub";
import type { CampaignLaunchConfig } from "../../../engine/types/ruleset";
import { normalizeLaunch } from "../../../engine/types/ruleset";

export const CAMPAIGN_SAVES_KEY = "strategy-demo.campaign-saves.v1";
const SAVE_LIMIT = 12;

export interface CampaignSave {
  version: 1;
  savedAt: number;
  label: string;
  mapId: string;
  mapName: string;
  seed: number;
  /** World-space map. Null means the built-in demo file. */
  map: Dict | null;
  snapshot: StubStateSnapshot;
  /** Absent on saves from before the campaign gate. Those stay on 1942 Quick. */
  launch?: CampaignLaunchConfig;
}

function isSnapshot(value: unknown): value is StubStateSnapshot {
  if (!isDict(value)) {
    return false;
  }
  const turn = value.turn_info;
  return typeof value.game_round === "number" && isDict(turn) && typeof turn.current_faction_id === "string";
}

export function parseCampaignSave(raw: unknown): CampaignSave | null {
  if (!isDict(raw) || raw.version !== 1 || !isSnapshot(raw.snapshot)) {
    return null;
  }
  const savedAt = Number(raw.savedAt);
  const seed = Number(raw.seed);
  if (!Number.isFinite(savedAt) || !Number.isFinite(seed)) {
    return null;
  }
  const map = raw.map == null ? null : isDict(raw.map) ? raw.map : null;
  if (raw.map != null && map == null) {
    return null;
  }
  return {
    version: 1,
    savedAt,
    label: String(raw.label ?? "Saved game"),
    mapId: String(raw.mapId ?? "demo"),
    mapName: String(raw.mapName ?? "Demo map"),
    seed: Math.trunc(seed),
    map,
    snapshot: raw.snapshot,
    ...(raw.launch != null ? { launch: normalizeLaunch(raw.launch) } : {}),
  };
}

export function parseCampaignLibrary(raw: string | null): CampaignSave[] {
  if (!raw) {
    return [];
  }
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) {
      return [];
    }
    return data.flatMap((item) => {
      const save = parseCampaignSave(item);
      return save ? [save] : [];
    });
  } catch {
    return [];
  }
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

export function readCampaignSaves(storage: KeyValueStore | null = browserStorage()): CampaignSave[] {
  if (!storage) {
    return [];
  }
  try {
    return parseCampaignLibrary(storage.getItem(CAMPAIGN_SAVES_KEY));
  } catch {
    return [];
  }
}

/** Newest first. The same label replaces the previous copy. Returns an error, or "". */
export function writeCampaignSave(save: CampaignSave, storage: KeyValueStore | null = browserStorage()): string {
  if (!storage) {
    return "This browser has no storage for a save.";
  }
  const prior = readCampaignSaves(storage).filter((item) => item.label !== save.label);
  const next = [save, ...prior].slice(0, SAVE_LIMIT);
  try {
    storage.setItem(CAMPAIGN_SAVES_KEY, JSON.stringify(next));
    return "";
  } catch {
    return "This browser could not store that save.";
  }
}
