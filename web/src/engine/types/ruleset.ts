/**
 * Optional campaign rules. Missing or partial saves use the 1942 quick set,
 * so an older game does not change its dice, income, or movement.
 */

export type TerrainType = "OPEN" | "URBAN" | "FOREST" | "MOUNTAIN" | "DESERT" | "SNOW";

export type RulesetUnitType =
  | "INFANTRY"
  | "CHINESE_GUERRILLA"
  | "ARTILLERY"
  | "ARMOR"
  | "MECH"
  | "FIGHTER"
  | "TACTICAL_BOMBER"
  | "HEAVY_BOMBER"
  | "SUBMARINE"
  | "DESTROYER"
  | "CRUISER"
  | "CARRIER"
  | "BATTLESHIP"
  | "TRANSPORT";

export type ScenarioId = "SCENARIO_1942_QUICK" | "SCENARIO_GLOBAL_1940";

export interface OptionalRulesetConfig {
  /** Urban (+1 Def max 3 Inf), Forest (-1 Atk Armor), Mountain (+1 Def max 2 Inf, no Blitz), Desert (0.5 move), Snow (movement stop) */
  terrainModifiers: boolean;
  /** Artillery & Bombers forfeit R1 attack to suppress Urban/Forest for 1 turn (auto-disabled if terrainModifiers is false) */
  preparatoryBombardment: boolean;
  /** Surviving units gain XP (0-2) in bloody >=70% parity wins; max 1 Level 2 unit promoted to Level 3 Veteran (1 reroll/round) per victory */
  unitVeterancy: boolean;
  /** Operational Airbases (+1 air range, scramble), Harbors (+1 naval range, capital repair), Air Patrols, Coastal/Convoy Raids */
  facilitiesAndPatrols: boolean;
  /** Faction National Objectives (COLLECT_INCOME) & Regional Neutral Bloc Dominoes */
  nationalObjectivesAndNeutrals: boolean;
  /** Optional R&D Research Tokens (5 IO/roll, 6 unlocks with +1 pity carry-over) */
  techTree: boolean;
}

export interface CampaignLaunchConfig {
  scenarioId: ScenarioId;
  ruleset: OptionalRulesetConfig;
}

export const DEFAULT_LEGACY_RULESET: OptionalRulesetConfig = {
  terrainModifiers: false,
  preparatoryBombardment: false,
  unitVeterancy: false,
  facilitiesAndPatrols: false,
  nationalObjectivesAndNeutrals: false,
  techTree: false,
};

export const SCENARIO_PRESETS: Record<ScenarioId, OptionalRulesetConfig> = {
  SCENARIO_1942_QUICK: {
    terrainModifiers: false,
    preparatoryBombardment: false,
    unitVeterancy: false,
    facilitiesAndPatrols: false,
    nationalObjectivesAndNeutrals: false,
    techTree: false,
  },
  SCENARIO_GLOBAL_1940: {
    terrainModifiers: true,
    preparatoryBombardment: true,
    unitVeterancy: true,
    facilitiesAndPatrols: true,
    nationalObjectivesAndNeutrals: true,
    techTree: false,
  },
};

export const SCENARIO_LABEL: Record<ScenarioId, string> = {
  SCENARIO_1942_QUICK: "1942 Quick",
  SCENARIO_GLOBAL_1940: "Global 1940",
};

export const RULE_TOGGLES: { key: keyof OptionalRulesetConfig; label: string; detail: string }[] = [
  {
    key: "terrainModifiers",
    label: "Terrain",
    detail: "Urban, forest, mountain, desert, and snow change the fight and the march.",
  },
  {
    key: "preparatoryBombardment",
    label: "Preparatory bombardment",
    detail: "Artillery and bombers may give up their first attack to suppress a city or a wood.",
  },
  {
    key: "unitVeterancy",
    label: "Veterancy",
    detail: "A close, bloody win leaves experience. One unit may become a veteran.",
  },
  {
    key: "facilitiesAndPatrols",
    label: "Facilities and patrols",
    detail: "Airbases, harbors, air patrols, and convoy raids.",
  },
  {
    key: "nationalObjectivesAndNeutrals",
    label: "Objectives and neutrals",
    detail: "National objectives pay extra Industrial Output. Neutral blocs fall together.",
  },
  {
    key: "techTree",
    label: "Research",
    detail: "5 Industrial Output a roll. A 6 unlocks, and a miss carries one pip forward.",
  },
];

const RULE_KEYS = RULE_TOGGLES.map((item) => item.key);

export function legacyLaunch(): CampaignLaunchConfig {
  return { scenarioId: "SCENARIO_1942_QUICK", ruleset: { ...DEFAULT_LEGACY_RULESET } };
}

export function launchForScenario(scenarioId: ScenarioId): CampaignLaunchConfig {
  return { scenarioId, ruleset: { ...SCENARIO_PRESETS[scenarioId] } };
}

/** A missing or partial save is the 1942 quick set. Bombardment cannot stand without terrain. */
export function normalizeRuleset(raw: unknown): OptionalRulesetConfig {
  const source = raw && typeof raw === "object" ? (raw as Partial<OptionalRulesetConfig>) : {};
  const next = { ...DEFAULT_LEGACY_RULESET };
  for (const key of RULE_KEYS) {
    if (typeof source[key] === "boolean") {
      next[key] = source[key];
    }
  }
  if (!next.terrainModifiers) {
    next.preparatoryBombardment = false;
  }
  return next;
}

export function normalizeLaunch(raw: unknown): CampaignLaunchConfig {
  const source = raw && typeof raw === "object" ? (raw as { scenarioId?: unknown; ruleset?: unknown }) : {};
  const scenarioId: ScenarioId = source.scenarioId === "SCENARIO_GLOBAL_1940" ? "SCENARIO_GLOBAL_1940" : "SCENARIO_1942_QUICK";
  return { scenarioId, ruleset: normalizeRuleset(source.ruleset) };
}

export function sameRuleset(a: OptionalRulesetConfig, b: OptionalRulesetConfig): boolean {
  return RULE_KEYS.every((key) => a[key] === b[key]);
}

/** One checkbox. Bombardment cannot stay on once terrain is off. */
export function applyRuleToggle(
  ruleset: OptionalRulesetConfig,
  key: keyof OptionalRulesetConfig,
  value: boolean,
): OptionalRulesetConfig {
  const next: OptionalRulesetConfig = { ...ruleset, [key]: value };
  if (!next.terrainModifiers) {
    next.preparatoryBombardment = false;
  }
  return next;
}

/** Ledger name for new rules. The saved field is still `ipc`, so old snapshots hash the same. */
export function treasuryOf(ipc: Record<string, number> | undefined, factionId: string): number {
  return Math.trunc(Number(ipc?.[factionId] ?? 0));
}

const UNIT_CLASS: Record<string, RulesetUnitType> = {
  infantry: "INFANTRY",
  chinese_guerrilla: "CHINESE_GUERRILLA",
  guerrilla: "CHINESE_GUERRILLA",
  artillery: "ARTILLERY",
  tank: "ARMOR",
  armor: "ARMOR",
  mech_infantry: "MECH",
  mech: "MECH",
  fighter: "FIGHTER",
  tactical_bomber: "TACTICAL_BOMBER",
  tac_bomber: "TACTICAL_BOMBER",
  strategic_bomber: "HEAVY_BOMBER",
  bomber: "HEAVY_BOMBER",
  submarine: "SUBMARINE",
  destroyer: "DESTROYER",
  cruiser: "CRUISER",
  carrier: "CARRIER",
  battleship: "BATTLESHIP",
  transport: "TRANSPORT",
};

export function classifyUnit(unitTypeId: string): RulesetUnitType | null {
  const id = unitTypeId.trim().toLowerCase();
  if (id.includes("guerrilla")) {
    return "CHINESE_GUERRILLA";
  }
  return UNIT_CLASS[id] ?? null;
}

export function isInfantryClass(unitTypeId: string): boolean {
  const kind = classifyUnit(unitTypeId);
  return kind === "INFANTRY" || kind === "CHINESE_GUERRILLA";
}

export function isArmorClass(unitTypeId: string): boolean {
  return classifyUnit(unitTypeId) === "ARMOR";
}

export function isBomberClass(unitTypeId: string): boolean {
  const kind = classifyUnit(unitTypeId);
  return kind === "TACTICAL_BOMBER" || kind === "HEAVY_BOMBER";
}

export function isArtilleryClass(unitTypeId: string): boolean {
  return classifyUnit(unitTypeId) === "ARTILLERY";
}
