/**
 * Shelf vectors for the campaign and battle boards.
 * A clip folder's clips.json is the index. A still is used only when that faction and type
 * has no folder yet. No shared-faction substitute, and no hand-written frame counts.
 */

import vectorManifest from "../../public/assets/units/vector/manifest.json";
import { readClipsFile } from "./frameClips";
import { QUIET_QUICK_FX, type QuickFxMarks } from "./quickUnitFx";

const CLIP_FILES = import.meta.glob("../../public/assets/units/vector/frames/*/clips.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

export const QUICK_FACTIONS = ["GER", "USSR", "UK", "US", "JAP"] as const;
export type QuickFaction = (typeof QUICK_FACTIONS)[number];

/** Roster / art folder names the boards ask for. */
export const QUICK_UNIT_TYPES = [
  "tank",
  "mech_infantry",
  "artillery",
  "aaa",
  "fighter",
  "tactical_bomber",
  "strategic_bomber",
  "battleship",
  "cruiser",
  "destroyer",
  "submarine",
  "transport",
] as const;
export type QuickUnitType = (typeof QUICK_UNIT_TYPES)[number];
/** Types that can resolve a vector clip, including infantry v2 and the carrier still. */
export type QuickResolvableType = QuickUnitType | "infantry" | "carrier";

const FACTION_PREFIX: Record<QuickFaction, string> = {
  GER: "ger",
  USSR: "ussr",
  UK: "uk",
  US: "us",
  JAP: "jap",
};

interface IndexedClip {
  ref: QuickClipRef;
  frames: number;
}

export interface QuickClipRef {
  unitId: string;
  factionId: QuickFaction;
  unitTypeId: QuickResolvableType;
  /** Public URL folder, no trailing slash. Empty when `file` is a single still. */
  dir: string;
  /** One stamped or polished SVG from the sprite shelf. Set instead of a frame folder. */
  file?: string;
  width: number;
  height: number;
  feet: { x: number; y: number };
  /** SVG viewBox scale. 1 unit = 1 sprite pixel after scale(1/resolution). */
  resolution: number;
  idle: number;
  walk: number;
  fire: number;
  damaged: number;
  /** Exhaust and barrel tip in picture pixels. */
  fx: QuickFxMarks;
  /** True when this clip belongs to a different faction than the one asked for. */
  fallback: boolean;
}

export interface QuickAuditRow {
  factionId: QuickFaction;
  unitTypeId: QuickResolvableType | "carrier";
  quick: "yes" | "fallback" | "missing";
  unitId: string | null;
  notes: string;
}

function asFaction(factionId: string): QuickFaction | null {
  const upper = factionId.trim().toUpperCase();
  if (upper === "GERMANY" || upper === "GERMAN" || upper === "AXIS") {
    return "GER";
  }
  if (upper === "RUSSIA" || upper === "SOVIET" || upper === "SOVIET_UNION") {
    return "USSR";
  }
  if (upper === "BRITAIN" || upper === "BRITISH" || upper === "ENGLAND") {
    return "UK";
  }
  if (upper === "AMERICA" || upper === "USA" || upper === "UNITED_STATES" || upper === "ALLIES") {
    return "US";
  }
  if (upper === "JAPAN" || upper === "JAPANESE") {
    return "JAP";
  }
  return (QUICK_FACTIONS as readonly string[]).includes(upper) ? (upper as QuickFaction) : null;
}

function asUnitType(unitTypeId: string): QuickResolvableType | null {
  const id = unitTypeId.trim().toLowerCase();
  if (id === "infantry" || id === "inf") {
    return "infantry";
  }
  if (id === "aa" || id === "aa_gun") {
    return "aaa";
  }
  if (id === "armor") {
    return "tank";
  }
  if (id === "tac_bomber") {
    return "tactical_bomber";
  }
  if (id === "bomber" || id === "strat_bomber") {
    return "strategic_bomber";
  }
  if (id === "carrier") {
    return "carrier";
  }
  return (QUICK_UNIT_TYPES as readonly string[]).includes(id) ? (id as QuickUnitType) : null;
}

function factionOfId(unitId: string): QuickFaction | null {
  const id = unitId.toLowerCase();
  for (const faction of QUICK_FACTIONS) {
    if (id.startsWith(`${FACTION_PREFIX[faction]}_`)) {
      return faction;
    }
  }
  return null;
}

function typeOfId(unitId: string): QuickResolvableType | null {
  let text = unitId.toLowerCase();
  for (const faction of QUICK_FACTIONS) {
    const prefix = `${FACTION_PREFIX[faction]}_`;
    if (text.startsWith(prefix)) {
      text = text.slice(prefix.length);
      break;
    }
  }
  text = text.replace(/_seed\d+.*$/, "").replace(/_v\d+$/, "").replace(/_polished$/, "").replace(/_quick$/, "").replace(/_25d$/, "");
  return asUnitType(text);
}

function marksOf(file: ReturnType<typeof readClipsFile>): QuickFxMarks {
  return {
    smoke: file.smoke ?? null,
    muzzle: file.muzzle ?? null,
    flashFrames: file.flashFrames ?? [],
    puffFrames: file.puffFrames ?? { idle: [], fire: [] },
  };
}

/** One folder per faction and type. When several folders match, the one with more frames wins. */
const CLIP_INDEX = new Map<string, IndexedClip>();
for (const [path, raw] of Object.entries(CLIP_FILES)) {
  let parsed: ReturnType<typeof readClipsFile>;
  try {
    parsed = readClipsFile(raw);
  } catch {
    continue;
  }
  const record = raw as { factionId?: unknown; unitTypeId?: unknown; scale?: unknown };
  const faction = asFaction(typeof record.factionId === "string" ? record.factionId : "") ?? factionOfId(parsed.unitId);
  const unitType = asUnitType(typeof record.unitTypeId === "string" ? record.unitTypeId : "") ?? typeOfId(parsed.unitId);
  if (!faction || !unitType || parsed.width < 1 || parsed.height < 1) {
    continue;
  }
  // The 2.5D fighter is an editor experiment. Boards use the QUICK picture.
  if (/_25D$/i.test(parsed.unitId)) {
    continue;
  }
  const folder = path.split(/[/\\]/).filter((part) => part.length > 0).at(-2) ?? parsed.unitId;
  const frames = parsed.clips.idle.length + parsed.clips.walk.length + parsed.clips.fire.length + parsed.clips.damaged.length;
  const ref: QuickClipRef = {
    unitId: parsed.unitId,
    factionId: faction,
    unitTypeId: unitType,
    dir: `/assets/units/vector/frames/${folder}`,
    width: parsed.width,
    height: parsed.height,
    feet: parsed.feet,
    resolution: typeof record.scale === "number" && record.scale > 0 ? record.scale : 4,
    idle: parsed.clips.idle.length,
    walk: parsed.clips.walk.length,
    fire: parsed.clips.fire.length,
    damaged: parsed.clips.damaged.length,
    fx: marksOf(parsed),
    fallback: false,
  };
  const key = `${faction}:${unitType}`;
  const prev = CLIP_INDEX.get(key);
  if (!prev || frames > prev.frames) {
    CLIP_INDEX.set(key, { ref, frames });
  }
}

/** The faction's clip folder when one exists, otherwise that faction's still. */
export function resolveQuickClip(factionId: string, unitTypeId: string): QuickClipRef | null {
  const faction = asFaction(factionId);
  const unitType = asUnitType(unitTypeId);
  if (!faction || !unitType) {
    return null;
  }
  const folder = CLIP_INDEX.get(`${faction}:${unitType}`);
  if (folder) {
    return folder.ref;
  }
  return stillFor(faction, unitType);
}

const MANIFEST_TYPE: Partial<Record<QuickResolvableType, string>> = {
  tactical_bomber: "tac_bomber",
  strategic_bomber: "bomber",
};

interface ManifestStill {
  file: string;
  factionId: string;
  unitTypeId: string;
  width: number;
  height: number;
  stamped?: boolean;
  polished?: boolean;
}

const STILLS = new Map<string, ManifestStill>();
for (const row of vectorManifest.units) {
  if (row.polished !== true && row.stamped !== true) {
    continue;
  }
  if (!row.file.endsWith(".svg")) {
    continue;
  }
  const key = `${row.factionId}:${row.unitTypeId}`;
  const prev = STILLS.get(key);
  if (!prev || (row.stamped === true && prev.stamped !== true)) {
    STILLS.set(key, row);
  }
}

function stillFor(faction: QuickFaction, unitType: QuickResolvableType): QuickClipRef | null {
  const row = STILLS.get(`${faction}:${MANIFEST_TYPE[unitType] ?? unitType}`);
  if (!row || row.width < 1 || row.height < 1) {
    return null;
  }
  const name = row.file.split("/").pop() ?? row.file;
  return {
    unitId: name.replace(/\.svg$/, ""),
    factionId: faction,
    unitTypeId: unitType,
    dir: "",
    file: `/${row.file}`,
    width: row.width,
    height: row.height,
    feet: { x: Math.round(row.width / 2), y: row.height - 1 },
    resolution: 4,
    idle: 1,
    walk: 0,
    fire: 0,
    damaged: 0,
    fx: QUIET_QUICK_FX,
    fallback: false,
  };
}

export function quickFrameUrl(clip: QuickClipRef, mode: "idle" | "walk" | "fire" | "damaged", index: number): string | null {
  if (clip.file) {
    return clip.file;
  }
  const count = clip[mode];
  if (count < 1) {
    return null;
  }
  const wrapped = ((index % count) + count) % count;
  return `${clip.dir}/${mode}_${wrapped}.svg`;
}

function auditOne(factionId: QuickFaction, unitTypeId: QuickResolvableType): QuickAuditRow {
  const hit = resolveQuickClip(factionId, unitTypeId);
  if (!hit) {
    return {
      factionId,
      unitTypeId,
      quick: "missing",
      unitId: null,
      notes: "No vector clip folder for battle/campaign",
    };
  }
  if (hit.file) {
    return {
      factionId,
      unitTypeId,
      quick: "yes",
      unitId: hit.unitId,
      notes: hit.file.includes(".stamped.") ? "stamped vector" : "polished vector",
    };
  }
  const gaps: string[] = [];
  if (hit.damaged < 1) {
    gaps.push("no damaged clip");
  }
  if (hit.fallback) {
    gaps.push(`using ${hit.factionId} seed`);
  }
  if (!hit.fx.smoke) {
    gaps.push("no exhaust mark");
  }
  if (!hit.fx.muzzle) {
    gaps.push("no muzzle mark");
  }
  const notes = [...gaps];
  if (hit.fx.smoke && hit.fx.muzzle) {
    notes.push("exhaust and muzzle");
  }
  return {
    factionId,
    unitTypeId,
    quick: hit.fallback ? "fallback" : "yes",
    unitId: hit.unitId,
    notes: notes.length > 0 ? notes.join("; ") : "idle/walk/fire present",
  };
}

/** Every faction × roster type the boards care about, with what vector art is present. */
export function auditQuickCoverage(): QuickAuditRow[] {
  const rows: QuickAuditRow[] = [];
  for (const factionId of QUICK_FACTIONS) {
    rows.push(auditOne(factionId, "infantry"));
    for (const unitTypeId of QUICK_UNIT_TYPES) {
      rows.push(auditOne(factionId, unitTypeId));
    }
    rows.push(auditOne(factionId, "carrier"));
  }
  return rows;
}

export function formatQuickAuditMarkdown(rows: readonly QuickAuditRow[] = auditQuickCoverage()): string {
  const lines = [
    "| Faction | Unit | QUICK | Asset | Notes |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${row.factionId} | ${row.unitTypeId} | ${row.quick} | ${row.unitId ?? "—"} | ${row.notes} |`,
    ),
  ];
  return lines.join("\n");
}
