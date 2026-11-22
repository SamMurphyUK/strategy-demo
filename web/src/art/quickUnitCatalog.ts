/**
 * Which `_QUICK` vector clip folders exist for the campaign and battle boards.
 * Pure: no DOM. Missing art is reported, never invented.
 */

import vectorManifest from "../../public/assets/units/vector/manifest.json";
import { QUIET_QUICK_FX, type QuickFxMarks } from "./quickUnitFx";

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

/** Folder fragment after the faction prefix. */
const TYPE_FOLDER: Record<QuickUnitType, string> = {
  tank: "tank",
  mech_infantry: "mech_infantry",
  artillery: "artillery",
  aaa: "aaa",
  fighter: "fighter",
  tactical_bomber: "tac_bomber",
  strategic_bomber: "bomber",
  battleship: "battleship",
  cruiser: "cruiser",
  destroyer: "destroyer",
  submarine: "submarine",
  transport: "transport",
};

interface QuickClipMeta {
  width: number;
  height: number;
  feet: { x: number; y: number };
  idle: number;
  walk: number;
  fire: number;
  damaged: number;
  fx: QuickFxMarks;
}

/** Fire index where the tank barrel is kicked back. That picture draws the flash. */
const TANK_FLASH: readonly number[] = [1];
const TANK_PUFF = { idle: [6, 7] as const, fire: [5, 6, 7] as const };

function tankMarks(smoke: { x: number; y: number }, muzzle: { x: number; y: number }): QuickFxMarks {
  return {
    smoke,
    muzzle,
    flashFrames: TANK_FLASH,
    puffFrames: { idle: TANK_PUFF.idle, fire: TANK_PUFF.fire },
  };
}

/**
 * Logical art size for every shipped battle/campaign vector clip. Resolution 4 lives in the SVG viewBox.
 * Smoke, and the German tank muzzle, are the clip marks. The other tank muzzles are the top pixel of the
 * barrel's rightmost column on idle_0. No flame SVG is shipped.
 */
const QUICK_CLIPS: Record<string, QuickClipMeta> = {
  ger_tank_seed1_QUICK: {
    width: 192,
    height: 96,
    feet: { x: 87, y: 95 },
    idle: 8,
    walk: 8,
    fire: 8,
    damaged: 0,
    fx: tankMarks({ x: 16, y: 40 }, { x: 191, y: 26 }),
  },
  ussr_tank_seed1_QUICK: {
    width: 192,
    height: 96,
    feet: { x: 87, y: 95 },
    idle: 8,
    walk: 8,
    fire: 8,
    damaged: 0,
    fx: tankMarks({ x: 15, y: 48 }, { x: 187, y: 26 }),
  },
  uk_tank_seed1_QUICK: {
    width: 176,
    height: 96,
    feet: { x: 80, y: 95 },
    idle: 8,
    walk: 8,
    fire: 8,
    damaged: 0,
    fx: tankMarks({ x: 11, y: 56 }, { x: 168, y: 39 }),
  },
  us_tank_seed1_QUICK: {
    width: 144,
    height: 96,
    feet: { x: 66, y: 95 },
    idle: 8,
    walk: 8,
    fire: 8,
    damaged: 0,
    fx: tankMarks({ x: 6, y: 58 }, { x: 138, y: 40 }),
  },
  jap_tank_seed1_QUICK: {
    width: 176,
    height: 96,
    feet: { x: 80, y: 95 },
    idle: 8,
    walk: 8,
    fire: 8,
    damaged: 0,
    fx: tankMarks({ x: 5, y: 55 }, { x: 172, y: 28 }),
  },
  /** Japanese infantry walk / fire / damaged. Other factions fall back to this seed. */
  jap_infantry_v2: {
    width: 80,
    height: 80,
    feet: { x: 43, y: 71 },
    idle: 5,
    walk: 8,
    fire: 4,
    damaged: 4,
    fx: {
      smoke: null,
      muzzle: { x: 62, y: 38 },
      flashFrames: [1, 2],
      puffFrames: { idle: [], fire: [] },
    },
  },
  /** German fighter flat clip (25D layers stay in the field preview). */
  ger_fighter_seed1_25D: {
    width: 144,
    height: 160,
    feet: { x: 97, y: 159 },
    idle: 4,
    walk: 8,
    fire: 2,
    damaged: 2,
    fx: {
      smoke: null,
      muzzle: { x: 133, y: 72 },
      flashFrames: [0, 1],
      puffFrames: { idle: [], fire: [] },
    },
  },
};

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
  resolution: 4;
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

/** Preferred clip folder ids for a faction × type, exact first then shared seeds. */
function candidateClipIds(faction: QuickFaction, unitType: QuickResolvableType): string[] {
  const prefix = FACTION_PREFIX[faction];
  if (unitType === "infantry") {
    return [`${prefix}_infantry_v2`, "jap_infantry_v2"];
  }
  if (unitType === "fighter") {
    return [`${prefix}_fighter_seed1_25D`];
  }
  if (unitType === "carrier" || unitType === "tactical_bomber" || unitType === "strategic_bomber") {
    return [];
  }
  const folder = TYPE_FOLDER[unitType];
  const ids = [`${prefix}_${folder}_seed1_QUICK`];
  for (const other of QUICK_FACTIONS) {
    if (other === faction) {
      continue;
    }
    ids.push(`${FACTION_PREFIX[other]}_${folder}_seed1_QUICK`);
  }
  return ids;
}

function ownerFactionOf(unitId: string): QuickFaction | null {
  for (const faction of QUICK_FACTIONS) {
    if (unitId.startsWith(`${FACTION_PREFIX[faction]}_`)) {
      return faction;
    }
  }
  return null;
}

function refFor(
  unitId: string,
  askedFaction: QuickFaction,
  unitTypeId: QuickResolvableType,
): QuickClipRef | null {
  const meta = QUICK_CLIPS[unitId];
  if (!meta) {
    return null;
  }
  const owner = ownerFactionOf(unitId) ?? askedFaction;
  return {
    unitId,
    factionId: owner,
    unitTypeId,
    dir: `/assets/units/vector/frames/${unitId}`,
    width: meta.width,
    height: meta.height,
    feet: meta.feet,
    resolution: 4,
    idle: meta.idle,
    walk: meta.walk,
    fire: meta.fire,
    damaged: meta.damaged,
    fx: meta.fx,
    fallback: owner !== askedFaction,
  };
}

/** Exact faction match, else that faction's stamped or polished still, else a shared animated seed. */
export function resolveQuickClip(factionId: string, unitTypeId: string): QuickClipRef | null {
  const faction = asFaction(factionId);
  const unitType = asUnitType(unitTypeId);
  if (!faction || !unitType) {
    return null;
  }
  for (const unitId of candidateClipIds(faction, unitType)) {
    const hit = refFor(unitId, faction, unitType);
    if (hit && !hit.fallback) {
      return hit;
    }
  }
  const still = stillFor(faction, unitType);
  if (still) {
    return still;
  }
  for (const unitId of candidateClipIds(faction, unitType)) {
    const hit = refFor(unitId, faction, unitType);
    if (hit) {
      return hit;
    }
  }
  return null;
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
