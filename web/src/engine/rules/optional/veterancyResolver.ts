import type { BattleUnitState } from "../../model/battle";
import type { GameState } from "../../model/game_state";

export interface UnitExperience {
  xp: number;
  veteran: boolean;
}

export interface BattleStrength {
  attacker: number;
  defender: number;
  attackerLost: number;
  defenderLost: number;
  attackerSurvivors: BattleUnitState[];
  defenderSurvivors: BattleUnitState[];
  winner: "attacker" | "defender" | "none";
  /** Starting production of each side. Counts are used when a cost is omitted. */
  attackerCost?: number;
  defenderCost?: number;
}

export const AWAITING_PROMOTION_CHOICE = "AWAITING_PROMOTION_CHOICE";

/** A win is close when the smaller side started with at least 70% of the larger side. */
export function bloodyParity(report: BattleStrength): boolean {
  const high = Math.max(report.attacker, report.defender);
  const low = Math.min(report.attacker, report.defender);
  if (high <= 0 || report.winner === "none") {
    return false;
  }
  const parity = low / high;
  const bloody = report.attackerLost + report.defenderLost > 0;
  return bloody && parity >= 0.7;
}

export function experienceGain(report: BattleStrength): number {
  if (!bloodyParity(report)) {
    return 0;
  }
  const winnerLost = report.winner === "attacker" ? report.attackerLost : report.defenderLost;
  const winnerStart = report.winner === "attacker" ? report.attacker : report.defender;
  if (winnerStart > 0 && winnerLost / winnerStart >= 0.5) {
    return 2;
  }
  return 1;
}

function sideCost(report: BattleStrength, side: "attacker" | "defender"): number {
  if (side === "attacker") {
    return report.attackerCost ?? report.attacker;
  }
  return report.defenderCost ?? report.defender;
}

function costParity(report: BattleStrength): boolean {
  const high = Math.max(sideCost(report, "attacker"), sideCost(report, "defender"));
  const low = Math.min(sideCost(report, "attacker"), sideCost(report, "defender"));
  if (high <= 0 || report.winner === "none") {
    return false;
  }
  return low / high >= 0.7;
}

function pieceCost(state: GameState, unit: BattleUnitState): number {
  return Math.max(0, Math.trunc(Number(state.unit_types[unit.unit_type_id]?.cost ?? 0)));
}

function promote(state: GameState, unitId: string): void {
  state.unitExperience[unitId] = { xp: 3, veteran: true };
}

/**
 * A bloody, close win gives each surviving winner one XP until xp 2.
 * One of those at xp 2 may go to xp 3. The defender's highest-cost piece is chosen.
 * The attacker waits for AWAITING_PROMOTION_CHOICE.
 */
export function grantVictoryExperience(state: GameState, report: BattleStrength): void {
  if (state.rulesetConfig.unitVeterancy !== true || report.winner === "none") {
    return;
  }
  const survivors = report.winner === "attacker" ? report.attackerSurvivors : report.defenderSurvivors;
  const lost = report.winner === "attacker" ? report.attackerLost : report.defenderLost;
  if (survivors.length < 1 || lost < 1 || !costParity(report)) {
    return;
  }
  for (const unit of survivors) {
    const prior = state.unitExperience[unit.id] ?? { xp: 0, veteran: false };
    if (prior.xp < 2) {
      state.unitExperience[unit.id] = { xp: prior.xp + 1, veteran: false };
    }
  }
  const ready = survivors.filter((unit) => (state.unitExperience[unit.id]?.xp ?? 0) === 2);
  if (ready.length === 0) {
    return;
  }
  const priced = ready.map((unit) => ({ id: unit.id, cost: pieceCost(state, unit) }));
  if (report.winner === "defender") {
    priced.sort((a, b) => b.cost - a.cost || a.id.localeCompare(b.id));
    promote(state, priced[0].id);
    state.pendingPromotion = [];
    return;
  }
  state.pendingPromotion = priced;
}

export function promotionState(state: GameState): string {
  return state.pendingPromotion.length > 0 ? AWAITING_PROMOTION_CHOICE : "";
}

export function choosePromotion(state: GameState, unitId: string): string {
  if (state.rulesetConfig.unitVeterancy !== true) {
    return "Veterancy is off.";
  }
  if (!state.pendingPromotion.some((item) => item.id === unitId)) {
    return "That unit is not waiting for a promotion.";
  }
  promote(state, unitId);
  state.pendingPromotion = [];
  return "";
}

/** Highest production cost. The id breaks a tie. Used for an AI attacker. */
export function autoPromote(state: GameState): string {
  if (state.pendingPromotion.length === 0) {
    return "";
  }
  const ranked = [...state.pendingPromotion].sort((a, b) => b.cost - a.cost || a.id.localeCompare(b.id));
  return choosePromotion(state, ranked[0].id);
}

/** xp 3 rerolls one miss each combat round. */
export function veteranMayReroll(state: GameState, unitId: string): boolean {
  if (state.rulesetConfig.unitVeterancy !== true) {
    return false;
  }
  const record = state.unitExperience[unitId];
  if (record == null || record.xp < 3) {
    return false;
  }
  const round = state.active_battle?.round ?? 0;
  return state.veteranRerollRound[unitId] !== round;
}

export function markVeteranReroll(state: GameState, unitId: string): void {
  state.veteranRerollRound[unitId] = state.active_battle?.round ?? 0;
}
