import type { Command } from "../../engine/model/command";

/** Live faction ids are lowercase. The spec names are the keys below. */
export type FactionId =
  | "GERMANY"
  | "JAPAN"
  | "SOVIET_UNION"
  | "CHINA"
  | "ITALY"
  | "UNITED_KINGDOM"
  | "UNITED_STATES";

export type GameCommand = Command;

export type AIDifficulty = "EASY" | "NORMAL" | "HARD";

export interface AIDifficultyProfile {
  difficulty: AIDifficulty;
  /** Beam width (number of candidate turn plans retained per ply) */
  beamWidth: number;
  /** Lookahead depth: 1 = My Turn only, 2 = My Turn + Enemy Counter-Turn */
  lookaheadPly: 1 | 2;
  /** Monte Carlo iterations per candidate battle during pruning */
  fastOddsIterations: number;
  /** Monte Carlo iterations for top-beam final verification */
  deepOddsIterations: number;
  /** Enables multi-turn Transport chain staging and National Objective hunting */
  enableStrategicStaging: boolean;
}

export const AI_DIFFICULTY_PROFILES: Record<AIDifficulty, AIDifficultyProfile> = {
  EASY: {
    difficulty: "EASY",
    beamWidth: 2,
    lookaheadPly: 1,
    fastOddsIterations: 50,
    deepOddsIterations: 150,
    enableStrategicStaging: false,
  },
  NORMAL: {
    difficulty: "NORMAL",
    beamWidth: 6,
    lookaheadPly: 2,
    fastOddsIterations: 250,
    deepOddsIterations: 750,
    enableStrategicStaging: true,
  },
  HARD: {
    difficulty: "HARD",
    beamWidth: 14,
    lookaheadPly: 2,
    fastOddsIterations: 500,
    deepOddsIterations: 1500,
    enableStrategicStaging: true,
  },
};

export interface CommanderWeights {
  personaId: "BLITZKRIEG" | "ATTRITIONAL" | "MARITIME";
  /** Minimum win probability required for a Hold Attack (0..1) */
  holdWinThreshold: number;
  /** Minimum counter-attack survival probability required to keep heavy armor/air in target tile */
  holdSurvivalThreshold: number;
  /** Minimum win probability for cheap Infantry/Artillery dead-zone trades */
  tradeWinThreshold: number;
  /** Value multiplier on Victory Cities and National Objective triggers */
  objectiveWeight: number;
  /** Value multiplier on preserving Total Unit Value (TUV) */
  tuvPreservationWeight: number;
}

export const FACTION_PERSONAS: Record<FactionId, CommanderWeights> = {
  GERMANY: {
    personaId: "BLITZKRIEG",
    holdWinThreshold: 0.72,
    holdSurvivalThreshold: 0.55,
    tradeWinThreshold: 0.62,
    objectiveWeight: 1.35,
    tuvPreservationWeight: 0.95,
  },
  JAPAN: {
    personaId: "BLITZKRIEG",
    holdWinThreshold: 0.72,
    holdSurvivalThreshold: 0.55,
    tradeWinThreshold: 0.6,
    objectiveWeight: 1.4,
    tuvPreservationWeight: 0.9,
  },
  SOVIET_UNION: {
    personaId: "ATTRITIONAL",
    holdWinThreshold: 0.78,
    holdSurvivalThreshold: 0.68,
    tradeWinThreshold: 0.58,
    objectiveWeight: 1.15,
    tuvPreservationWeight: 1.25,
  },
  CHINA: {
    personaId: "ATTRITIONAL",
    holdWinThreshold: 0.75,
    holdSurvivalThreshold: 0.65,
    tradeWinThreshold: 0.55,
    objectiveWeight: 1.1,
    tuvPreservationWeight: 1.3,
  },
  ITALY: {
    personaId: "ATTRITIONAL",
    holdWinThreshold: 0.76,
    holdSurvivalThreshold: 0.62,
    tradeWinThreshold: 0.6,
    objectiveWeight: 1.25,
    tuvPreservationWeight: 1.15,
  },
  UNITED_KINGDOM: {
    personaId: "MARITIME",
    holdWinThreshold: 0.75,
    holdSurvivalThreshold: 0.65,
    tradeWinThreshold: 0.62,
    objectiveWeight: 1.3,
    tuvPreservationWeight: 1.2,
  },
  UNITED_STATES: {
    personaId: "MARITIME",
    holdWinThreshold: 0.75,
    holdSurvivalThreshold: 0.65,
    tradeWinThreshold: 0.64,
    objectiveWeight: 1.3,
    tuvPreservationWeight: 1.15,
  },
};

export interface TurnPlanResult {
  commands: GameCommand[];
  evaluatedPlans: number;
  expectedScoreDelta: number;
  elapsedMs: number;
}

const PERSONA_ALIAS: Record<string, FactionId> = {
  germany: "GERMANY",
  ger: "GERMANY",
  japan: "JAPAN",
  jap: "JAPAN",
  soviet_union: "SOVIET_UNION",
  ussr: "SOVIET_UNION",
  china: "CHINA",
  italy: "ITALY",
  united_kingdom: "UNITED_KINGDOM",
  uk: "UNITED_KINGDOM",
  united_states: "UNITED_STATES",
  usa: "UNITED_STATES",
};

/** Unknown factions use the Soviet weights so they do not blitz. */
export function personaFor(factionId: string): CommanderWeights {
  const key = PERSONA_ALIAS[factionId.trim().toLowerCase()];
  return key != null ? FACTION_PERSONAS[key] : FACTION_PERSONAS.SOVIET_UNION;
}
