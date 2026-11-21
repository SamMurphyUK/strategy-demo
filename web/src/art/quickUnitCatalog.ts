/**
 * Which `_QUICK` vector clip folders exist for the campaign and battle boards.
 * Pure: no DOM. Missing art is reported, never invented.
 */

export const QUICK_FACTIONS = ["GER", "USSR", "UK", "US", "JAP"] as const;
export type QuickFaction = (typeof QUICK_FACTIONS)[number];

/** Roster / art folder names the boards ask for (infantry stays on its placeholder). */
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

/** Logical art size for every shipped `_QUICK` vector clip. Resolution 4 lives in the SVG viewBox. */
const QUICK_CLIPS: Record<string, { width: number; height: number; feet: { x: number; y: number }; idle: number; walk: number; fire: number; damaged: number }> = {
  ger_tank_seed1_QUICK: { width: 192, height: 96, feet: { x: 87, y: 95 }, idle: 8, walk: 8, fire: 8, damaged: 0 },
  ussr_tank_seed1_QUICK: { width: 192, height: 96, feet: { x: 87, y: 95 }, idle: 8, walk: 8, fire: 8, damaged: 0 },
  uk_tank_seed1_QUICK: { width: 176, height: 96, feet: { x: 80, y: 95 }, idle: 8, walk: 8, fire: 8, damaged: 0 },
  us_tank_seed1_QUICK: { width: 144, height: 96, feet: { x: 66, y: 95 }, idle: 8, walk: 8, fire: 8, damaged: 0 },
  jap_tank_seed1_QUICK: { width: 176, height: 96, feet: { x: 80, y: 95 }, idle: 8, walk: 8, fire: 8, damaged: 0 },
};

export interface QuickClipRef {
  unitId: string;
  factionId: QuickFaction;
  unitTypeId: QuickUnitType;
  /** Public URL folder, no trailing slash. */
  dir: string;
  width: number;
  height: number;
  feet: { x: number; y: number };
  /** SVG viewBox scale. 1 unit = 1 sprite pixel after scale(1/resolution). */
  resolution: 4;
  idle: number;
  walk: number;
  fire: number;
  damaged: number;
  /** True when this clip belongs to a different faction than the one asked for. */
  fallback: boolean;
}

export interface QuickAuditRow {
  factionId: QuickFaction;
  unitTypeId: QuickUnitType | "infantry" | "carrier";
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

function asUnitType(unitTypeId: string): QuickUnitType | null {
  const id = unitTypeId.trim().toLowerCase();
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
  return (QUICK_UNIT_TYPES as readonly string[]).includes(id) ? (id as QuickUnitType) : null;
}

function clipId(faction: QuickFaction, unitType: QuickUnitType): string {
  return `${FACTION_PREFIX[faction]}_${TYPE_FOLDER[unitType]}_seed1_QUICK`;
}

function refFor(unitId: string, factionId: QuickFaction, unitTypeId: QuickUnitType, fallback: boolean): QuickClipRef | null {
  const meta = QUICK_CLIPS[unitId];
  if (!meta) {
    return null;
  }
  return {
    unitId,
    factionId,
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
    fallback,
  };
}

/** Exact faction match, else any other faction's `_QUICK` seed for that archetype. */
export function resolveQuickClip(factionId: string, unitTypeId: string): QuickClipRef | null {
  const faction = asFaction(factionId);
  const unitType = asUnitType(unitTypeId);
  if (!faction || !unitType) {
    return null;
  }
  const exact = refFor(clipId(faction, unitType), faction, unitType, false);
  if (exact) {
    return exact;
  }
  for (const other of QUICK_FACTIONS) {
    if (other === faction) {
      continue;
    }
    const hit = refFor(clipId(other, unitType), other, unitType, true);
    if (hit) {
      return hit;
    }
  }
  return null;
}

export function quickFrameUrl(clip: QuickClipRef, mode: "idle" | "walk" | "fire" | "damaged", index: number): string | null {
  const count = clip[mode];
  if (count < 1) {
    return null;
  }
  const wrapped = ((index % count) + count) % count;
  return `${clip.dir}/${mode}_${wrapped}.svg`;
}

/** Every faction × roster type the boards care about, with what `_QUICK` art is present. */
export function auditQuickCoverage(): QuickAuditRow[] {
  const rows: QuickAuditRow[] = [];
  for (const factionId of QUICK_FACTIONS) {
    rows.push({
      factionId,
      unitTypeId: "infantry",
      quick: "missing",
      unitId: null,
      notes: "Left on campaign/battle placeholder until _v2 is finalized",
    });
    for (const unitTypeId of QUICK_UNIT_TYPES) {
      const hit = resolveQuickClip(factionId, unitTypeId);
      if (!hit) {
        const notes: string[] = ["No _QUICK vector clip folder"];
        if (unitTypeId !== "tank") {
          notes.push("missing idle/walk/fire vector layers");
        }
        rows.push({ factionId, unitTypeId, quick: "missing", unitId: null, notes: notes.join("; ") });
        continue;
      }
      const gaps: string[] = [];
      if (hit.damaged < 1) {
        gaps.push("no damaged clip");
      }
      if (hit.fallback) {
        gaps.push(`using ${hit.factionId} seed`);
      }
      rows.push({
        factionId,
        unitTypeId,
        quick: hit.fallback ? "fallback" : "yes",
        unitId: hit.unitId,
        notes: gaps.length > 0 ? gaps.join("; ") : "idle/walk/fire present",
      });
    }
    rows.push({
      factionId,
      unitTypeId: "carrier",
      quick: "missing",
      unitId: null,
      notes: "No _QUICK carrier; battle still uses procedural hull",
    });
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
