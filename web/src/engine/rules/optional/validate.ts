import type { CampaignLaunchConfig, OptionalRulesetConfig } from "../../types/ruleset";
import { normalizeLaunch } from "../../types/ruleset";

export function validateLaunch(raw: unknown): { config: CampaignLaunchConfig; notes: string[] } {
  const config = normalizeLaunch(raw);
  const notes: string[] = [];
  const claimed = raw && typeof raw === "object" ? (raw as { ruleset?: Partial<OptionalRulesetConfig> }).ruleset : undefined;
  if (claimed?.preparatoryBombardment === true && claimed.terrainModifiers === false) {
    notes.push("Preparatory bombardment stays off without terrain.");
  }
  if (config.scenarioId !== "SCENARIO_1942_QUICK" && config.scenarioId !== "SCENARIO_GLOBAL_1940") {
    notes.push("Unknown scenario. Using 1942 Quick.");
  }
  return { config, notes };
}
