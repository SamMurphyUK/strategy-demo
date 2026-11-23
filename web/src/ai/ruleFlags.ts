import type { GameState } from "../engine/model/game_state";
import type { OptionalRulesetConfig } from "../engine/types/ruleset";

export interface CampaignRuleFlags {
  enableTerrainModifiers: boolean;
  enablePreparatorySuppression: boolean;
  enableVeterancy: boolean;
  enableMobilizationCurve: boolean;
  enableAirPatrols: boolean;
  enableFactoryBombing: boolean;
  enableConvoyRaiding: boolean;
  enableNeutralBlocs: boolean;
  enableChinaGuerrillas: boolean;
}

/** Neutral-bloc invasion stays out of candidate generation until a later desperation rule turns it on. */
export const AI_NEUTRAL_INVASION = false;

export type AiEvaluator =
  | "terrain"
  | "preparatorySuppression"
  | "veterancy"
  | "mobilization"
  | "airPatrols"
  | "factoryBombing"
  | "convoyRaiding"
  | "neutralInvasion"
  | "chinaGuerrillas";

export function campaignRuleFlags(state: GameState): CampaignRuleFlags {
  const rules: OptionalRulesetConfig = state.rulesetConfig;
  const global = state.scenarioId === "SCENARIO_GLOBAL_1940";
  return {
    enableTerrainModifiers: rules.terrainModifiers === true,
    enablePreparatorySuppression: rules.preparatoryBombardment === true,
    enableVeterancy: rules.unitVeterancy === true,
    enableMobilizationCurve: global,
    enableAirPatrols: rules.facilitiesAndPatrols === true,
    enableFactoryBombing: rules.facilitiesAndPatrols === true,
    enableConvoyRaiding: rules.facilitiesAndPatrols === true,
    enableNeutralBlocs: rules.nationalObjectivesAndNeutrals === true,
    enableChinaGuerrillas: global && rules.terrainModifiers === true,
  };
}

export function shouldRunEvaluator(flags: CampaignRuleFlags, evaluator: AiEvaluator): boolean {
  switch (evaluator) {
    case "terrain":
      return flags.enableTerrainModifiers;
    case "preparatorySuppression":
      return flags.enablePreparatorySuppression;
    case "veterancy":
      return flags.enableVeterancy;
    case "mobilization":
      return flags.enableMobilizationCurve;
    case "airPatrols":
      return flags.enableAirPatrols;
    case "factoryBombing":
      return flags.enableFactoryBombing;
    case "convoyRaiding":
      return flags.enableConvoyRaiding;
    case "neutralInvasion":
      return flags.enableNeutralBlocs && AI_NEUTRAL_INVASION;
    case "chinaGuerrillas":
      return flags.enableChinaGuerrillas;
    default:
      return false;
  }
}
