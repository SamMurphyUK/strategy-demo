// Named map snapshots kept in this browser, separate from the one autosaved working copy.
import type { Dict } from "../../../engine/model/types";
import { isDict } from "../../../engine/model/types";

export const VERSIONS_KEY = "strategy-demo.map-editor.versions.v1";
export const VERSION_NAME_MAX = 80;

export interface MapVersion {
  id: string;
  name: string;
  savedAt: number;
  map: Dict;
}

/** A problem with the name, or null when it can be saved. */
export function versionNameError(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "") {
    return "Name the version before saving.";
  }
  if (trimmed.length > VERSION_NAME_MAX) {
    return `Keep the version name under ${VERSION_NAME_MAX} characters.`;
  }
  return null;
}

/**
 * Writes `map` under `name`. The same name replaces that version and keeps its id. The saved one is first.
 */
export function upsertVersion(
  versions: MapVersion[],
  name: string,
  map: Dict,
  now: number,
  id: string,
): { versions: MapVersion[]; replaced: boolean; version: MapVersion } {
  const trimmed = name.trim();
  const existing = versions.find((v) => v.name === trimmed);
  const version: MapVersion = { id: existing?.id ?? id, name: trimmed, savedAt: now, map };
  return {
    versions: [version, ...versions.filter((v) => v.name !== trimmed)],
    replaced: existing !== undefined,
    version,
  };
}

export function removeVersion(versions: MapVersion[], id: string): MapVersion[] {
  return versions.filter((v) => v.id !== id);
}

/** Reads a stored library. Anything that is not a named map is dropped. */
export function parseVersionLibrary(raw: string | null): MapVersion[] {
  if (!raw) {
    return [];
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) {
    return [];
  }
  const out: MapVersion[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const item of data) {
    if (!isDict(item)) {
      continue;
    }
    const id = typeof item.id === "string" ? item.id : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const savedAt = Number(item.savedAt);
    if (id === "" || name === "" || name.length > VERSION_NAME_MAX || !Number.isFinite(savedAt) || !isDict(item.map)) {
      continue;
    }
    if (seenIds.has(id) || seenNames.has(name)) {
      continue;
    }
    seenIds.add(id);
    seenNames.add(name);
    out.push({ id, name, savedAt, map: item.map });
  }
  return out;
}
