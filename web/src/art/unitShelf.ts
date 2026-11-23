import { UNIT_TYPE_LABEL } from "./archetypeLayers";
import { STAMPED_PNG_SUFFIX, polishedPngFor } from "./spriteStamps";

/** The sprite editor's unit list. Polished vectors by default; every picture on disk with Show all units. */

export const SHELF_FACTION_ORDER = ["GER", "USSR", "UK", "US", "JAP"] as const;

/** Battle map key for the shaded Japanese walk, drawn from its PNGs. */
export const POLISHED_WALK_KEY = "walk:jap:polished";

/** The infantry sheet every faction plays until that faction has its own folder. */
export const CURRENT_INFANTRY_CLIP = "jap_infantry_QUICK";

export type ShelfKind = "vector" | "clips" | "picture";

export interface ShelfUnit {
  /** Unique across the whole list. */
  key: string;
  kind: ShelfKind;
  factionId: string;
  unitTypeId: string;
  seed?: number;
  width?: number;
  height?: number;
  vectorised: boolean;
  polished: boolean;
  /** Traced from a polished PNG with emblems stamped on it. A stamped vector is also polished. */
  stamped: boolean;
  /** Shown in the list and the large view: the SVG for a vector, the PNG for a picture. */
  preview: string;
  /** The pixel picture behind it, for a vector traced from a candidate PNG. */
  picture?: string;
  /** The polished PNG the Stamp panel places emblems on. The stamped PNG is made from it, never edited. */
  stampSource?: string;
  /** What On a battle map opens: a candidate PNG path, or a battle map sprite key. */
  fieldPick: string | null;
  label: string;
}

export interface ShelfTypeGroup {
  unitTypeId: string;
  label: string;
  units: ShelfUnit[];
}

export interface ShelfFactionGroup {
  factionId: string;
  types: ShelfTypeGroup[];
}

export interface ShelfCandidate {
  factionId: string;
  unitTypeId?: string;
  blueprintId?: string;
  seed?: number;
  quantized: string;
  width?: number;
  height?: number;
  grade?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function size(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function publicUrl(file: string): string {
  return `/${file.replace(/^\/+/, "")}`;
}

function safePath(file: string): boolean {
  return !file.includes("..");
}

const FACTION_PREFIX: Record<string, string> = { GER: "ger", USSR: "ussr", UK: "uk", US: "us", JAP: "jap" };

const RIG_FOLDER: Record<string, string> = {
  tactical_bomber: "tac_bomber",
  strategic_bomber: "bomber",
};

const SEED_RIG_TYPES = new Set([
  "tank",
  "mech_infantry",
  "artillery",
  "aaa",
  "fighter",
  "tac_bomber",
  "tactical_bomber",
  "bomber",
  "strategic_bomber",
  "battleship",
  "cruiser",
  "destroyer",
  "submarine",
  "transport",
]);

/** The seed-1 rig id for a shelf row, such as `uk_artillery_seed1`. A renamed picture such as a T-34 has none. */
export function seedRigId(factionId: string, unitTypeId: string): string | null {
  const prefix = FACTION_PREFIX[factionId];
  if (!prefix || !SEED_RIG_TYPES.has(unitTypeId)) {
    return null;
  }
  return `${prefix}_${RIG_FOLDER[unitTypeId] ?? unitTypeId}_seed1`;
}

function quickPick(factionId: string, unitTypeId: string, path: string): string | null {
  const rigId = seedRigId(factionId, unitTypeId);
  if (!rigId || !path.includes(`/${rigId}.`)) {
    return null;
  }
  return `walk:${rigId}_QUICK:vector`;
}

/** The overnight batch names the bombers the short way. */
const SHORT_TYPE_LABEL: Record<string, string> = {
  bomber: UNIT_TYPE_LABEL.strategic_bomber ?? "Strategic bomber",
  tac_bomber: UNIT_TYPE_LABEL.tactical_bomber ?? "Tactical bomber",
};

export function unitTypeLabel(unitTypeId: string): string {
  return UNIT_TYPE_LABEL[unitTypeId] ?? SHORT_TYPE_LABEL[unitTypeId] ?? unitTypeId;
}

function shelfLabel(factionId: string, unitTypeId: string, seed: number | undefined, tail: string): string {
  const number = typeof seed === "number" ? ` ${seed}` : "";
  return `${factionId} ${unitTypeLabel(unitTypeId)}${number}, ${tail}`;
}

/** Rows from public/assets/units/vector/manifest.json. A row without "polished": true is not polished. */
export function vectorShelf(manifest: unknown): ShelfUnit[] {
  if (!isRecord(manifest)) {
    return [];
  }
  const units: ShelfUnit[] = [];
  const rows = Array.isArray(manifest.units) ? manifest.units : [];
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const file = text(row.file);
    const factionId = text(row.factionId);
    const unitTypeId = text(row.unitTypeId);
    if (!file || !file.endsWith(".svg") || !safePath(file) || !factionId || !unitTypeId) {
      continue;
    }
    const source = text(row.source);
    const picture = source && source.startsWith("assets/candidates/") && source.endsWith(".png") && safePath(source) ? source : undefined;
    const stamped = row.stamped === true && picture !== undefined && picture.endsWith(STAMPED_PNG_SUFFIX);
    const polished = row.polished === true || stamped;
    const stampSource = picture && polished ? (polishedPngFor(picture) ?? undefined) : undefined;
    const seed = typeof row.seed === "number" ? row.seed : undefined;
    units.push({
      key: `vec:${file}`,
      kind: "vector",
      factionId,
      unitTypeId,
      seed,
      width: size(row.width),
      height: size(row.height),
      vectorised: true,
      polished,
      stamped,
      preview: publicUrl(file),
      picture,
      stampSource,
      fieldPick: quickPick(factionId, unitTypeId, file) ?? picture ?? null,
      label: shelfLabel(factionId, unitTypeId, seed, stamped ? "stamped vector" : polished ? "polished vector" : "vector"),
    });
  }
  const clips = Array.isArray(manifest.clips) ? manifest.clips : [];
  for (const clip of clips) {
    if (!isRecord(clip)) {
      continue;
    }
    const dir = text(clip.dir);
    const factionId = text(clip.factionId);
    const unitTypeId = text(clip.unitTypeId);
    if (!dir || !safePath(dir) || !factionId || !unitTypeId) {
      continue;
    }
    const polished = clip.polished === true;
    const preview = text(clip.preview);
    const unitId = text(clip.unitId) ?? "";
    const walk = polished && unitId === "jap_infantry";
    const current = unitId === CURRENT_INFANTRY_CLIP;
    units.push({
      key: `clips:${dir}`,
      kind: "clips",
      factionId,
      unitTypeId,
      width: size(clip.width),
      height: size(clip.height),
      vectorised: true,
      polished,
      stamped: false,
      preview: publicUrl(preview && preview.endsWith(".svg") && safePath(preview) ? preview : `${dir}/idle_0.svg`),
      fieldPick: walk ? POLISHED_WALK_KEY : unitId.endsWith("_QUICK") || unitId.endsWith("_v2") ? `walk:${unitId}:vector` : null,
      label: `${factionId} ${unitTypeLabel(unitTypeId)} walk${unitId.endsWith("_QUICK") ? ", QUICK" : unitId.endsWith("_v2") ? ", v2" : ""}${current ? ", current" : ""}, ${polished ? "polished vector" : "vector"}`,
    });
  }
  return units;
}

/** Overnight pictures from /__dev/bake-candidates. None of them is a vector. */
export function candidateShelf(candidates: readonly ShelfCandidate[]): ShelfUnit[] {
  const seen = new Set<string>();
  const units: ShelfUnit[] = [];
  for (const row of candidates) {
    const path = text(row.quantized);
    const factionId = text(row.factionId);
    if (!path || !path.endsWith(".png") || !safePath(path) || !factionId || seen.has(path)) {
      continue;
    }
    seen.add(path);
    const unitTypeId = text(row.unitTypeId) ?? text(row.blueprintId) ?? "unit";
    units.push({
      key: `pic:${path}`,
      kind: "picture",
      factionId,
      unitTypeId,
      seed: row.seed,
      width: size(row.width),
      height: size(row.height),
      vectorised: false,
      polished: false,
      stamped: false,
      preview: `/__dev/bake-file?path=${encodeURIComponent(path)}`,
      picture: path,
      fieldPick: quickPick(factionId, unitTypeId, path) ?? path,
      label: shelfLabel(factionId, unitTypeId, row.seed, row.grade === "outlined" ? "picture, outlines" : "picture"),
    });
  }
  return units;
}

/**
 * Drops each polished row whose polished PNG also has a stamped row, so the stamped vector stands in for it.
 * Works on shelf units and on raw manifest rows alike.
 */
export function preferStamped<T extends { stamped?: boolean; polished?: boolean; picture?: string; source?: string }>(rows: readonly T[]): T[] {
  const behind = (row: T) => {
    const png = row.picture ?? row.source;
    return png ? polishedPngFor(png) : null;
  };
  const stampedSources = new Set(rows.filter((row) => row.stamped === true).map(behind).filter((png): png is string => png !== null));
  return rows.filter((row) => row.stamped === true || row.polished !== true || !stampedSources.has(behind(row) ?? ""));
}

/** Polished vectors only, a stamped one in place of its polished one, unless showAll. */
export function shelfUnits(units: readonly ShelfUnit[], showAll: boolean): ShelfUnit[] {
  return showAll ? [...units] : preferStamped(units.filter((unit) => unit.vectorised && unit.polished));
}

function factionRank(factionId: string): number {
  const index = (SHELF_FACTION_ORDER as readonly string[]).indexOf(factionId);
  return index < 0 ? SHELF_FACTION_ORDER.length : index;
}

const KIND_RANK: Record<ShelfKind, number> = { vector: 0, clips: 1, picture: 2 };

function unitOrder(a: ShelfUnit, b: ShelfUnit): number {
  return (
    Number(b.polished) - Number(a.polished) ||
    Number(b.stamped) - Number(a.stamped) ||
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    (a.seed ?? 0) - (b.seed ?? 0) ||
    a.key.localeCompare(b.key)
  );
}

/** Faction in SHELF_FACTION_ORDER, others after by name; then unit type by its label; polished first inside a type. */
export function groupShelf(units: readonly ShelfUnit[]): ShelfFactionGroup[] {
  const factions = new Map<string, Map<string, ShelfUnit[]>>();
  for (const unit of units) {
    const types = factions.get(unit.factionId) ?? new Map<string, ShelfUnit[]>();
    factions.set(unit.factionId, types);
    const list = types.get(unit.unitTypeId) ?? [];
    types.set(unit.unitTypeId, list);
    list.push(unit);
  }
  return [...factions.entries()]
    .sort(([a], [b]) => factionRank(a) - factionRank(b) || a.localeCompare(b))
    .map(([factionId, types]) => ({
      factionId,
      types: [...types.entries()]
        .map(([unitTypeId, list]) => ({ unitTypeId, label: unitTypeLabel(unitTypeId), units: [...list].sort(unitOrder) }))
        .sort((a, b) => a.label.localeCompare(b.label) || a.unitTypeId.localeCompare(b.unitTypeId)),
    }));
}
