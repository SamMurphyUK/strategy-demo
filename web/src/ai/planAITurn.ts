import { Faction } from "../engine/model/faction";
import { GameState } from "../engine/model/game_state";
import { Region } from "../engine/model/region";
import { Unit } from "../engine/model/unit";
import { mulberry32 } from "../engine/rules/optional/montecarlo";
import { planTurn } from "./planTurn";
import type { AIDifficulty, TurnPlanResult } from "./types/aiTypes";

export interface PlannerRequest {
  state: GameState;
  faction: string;
  difficulty?: AIDifficulty;
  /** Shared match seed. The turn seed also folds in the round and the faction. */
  matchSeed: number;
}

/**
 * One Mulberry32 draw from the match seed, the round, and the faction.
 * Every client that shares those three values draws the same turn.
 */
export function plannerSeed(matchSeed: number, round: number, faction: string): number {
  let mixed = (matchSeed >>> 0) ^ Math.imul(Math.max(0, Math.trunc(round)), 0x9e3779b1);
  const name = faction.trim().toLowerCase();
  for (let i = 0; i < name.length; i += 1) {
    mixed = (Math.imul(mixed ^ name.charCodeAt(i), 0x85ebca6b) + i) >>> 0;
  }
  const roll = mulberry32(mixed || 1);
  return Math.floor(roll() * 0xffffffff) >>> 0 || 1;
}

/** A cloned worker payload has the board data and none of the prototypes. */
export function reviveGameState(raw: GameState): GameState {
  if (typeof raw.sameTeam !== "function") {
    Object.setPrototypeOf(raw, GameState.prototype);
  }
  for (const region of Object.values(raw.regions ?? {})) {
    if (region != null && typeof region.isLandRegion !== "function") {
      Object.setPrototypeOf(region, Region.prototype);
    }
  }
  for (const unit of Object.values(raw.unit_types ?? {})) {
    if (unit != null) {
      Object.setPrototypeOf(unit, Unit.prototype);
    }
  }
  for (const faction of Object.values(raw.factions ?? {})) {
    if (faction != null) {
      Object.setPrototypeOf(faction, Faction.prototype);
    }
  }
  return raw;
}

/**
 * Plan the faction's turn. The dice stream is Mulberry32, seeded from the match,
 * the current round, and the faction, so lockstep clients emit the same commands.
 */
export function planAITurn(state: GameState, faction: string, difficulty: AIDifficulty, matchSeed: number): TurnPlanResult {
  return planTurn(state, { difficulty, seed: plannerSeed(matchSeed, state.game_round, faction) });
}

export function handlePlannerMessage(request: PlannerRequest): TurnPlanResult {
  const state = reviveGameState(request.state);
  return planAITurn(state, request.faction, request.difficulty ?? "NORMAL", request.matchSeed);
}
