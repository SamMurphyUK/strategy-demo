// Ports of core/phases/*_controller.gd. The Godot controllers are thin wrappers that
// also emit signals; only their event ordering and success checks matter to the engine.
import type { AmphibiousEngine } from "../amphibious/amphibious";
import type { CombatEngine } from "../combat/combat";
import type { EconomyEngine } from "../economy/economy";
import { type GameEvent, GameEventType, type GameEventTypeValue } from "../model/event";
import type { GameState } from "../model/game_state";
import type { PlacementEngine } from "../placement/placement";
import type { VictoryEngine } from "../victory/victory";
import type { TurnEngine } from "./turn_engine";

export type SyncSeq = (events: GameEvent[]) => GameEvent[];

export interface PhaseResult {
  success: boolean;
  error_code: string;
  error_message: string;
  events: GameEvent[];
}

export function firstEventIs(events: GameEvent[], type: GameEventTypeValue): boolean {
  return events.length > 0 && events[0].type === type;
}

/** PurchasePhaseController.process_purchase */
export function purchaseResult(events: GameEvent[]): PhaseResult {
  const success = firstEventIs(events, GameEventType.UNITS_PURCHASED);
  let reason = "";
  if (!success) {
    if (events.length === 0) {
      reason = "no_events";
    } else if (events[0].type === GameEventType.PURCHASE_FAILED) {
      reason = String(events[0].payload.reason ?? "purchase_failed");
    } else {
      reason = "purchase_failed";
    }
  }
  return {
    success,
    error_code: success ? "" : "PURCHASE_FAILED",
    error_message: reason,
    events,
  };
}

/** StartTurnPhaseController.start_turn */
export function startTurn(turnEngine: TurnEngine): GameEvent[] {
  return turnEngine.startGame();
}

/** BattlePhaseController.resolve_phase */
export function resolveBattlePhase(
  factionId: string,
  amphibious: AmphibiousEngine,
  combat: CombatEngine,
  syncSeq: SyncSeq,
): GameEvent[] {
  const events: GameEvent[] = [];
  events.push(...syncSeq(amphibious.resolveAssaults(factionId, combat)));
  events.push(...syncSeq(combat.resolveAllBattles(factionId)));
  return events;
}

/** EndPhaseController.process_end_phase */
export function processEndPhase(
  phaseAtRequest: string,
  state: GameState,
  turnEngine: TurnEngine,
  amphibious: AmphibiousEngine,
  combat: CombatEngine,
  placement: PlacementEngine,
  syncSeq: SyncSeq,
): GameEvent[] {
  const events: GameEvent[] = [];
  if (phaseAtRequest === "combat_move") {
    events.push(...syncSeq(turnEngine.advancePhase()));
  } else if (phaseAtRequest === "combat") {
    events.push(...resolveBattlePhase(state.current_faction_id, amphibious, combat, syncSeq));
    events.push(...syncSeq(turnEngine.advancePhase()));
  } else if (phaseAtRequest === "mobilize") {
    events.push(...syncSeq(placement.checkForfeited(state.current_faction_id)));
    events.push(...syncSeq(turnEngine.advancePhase()));
  } else {
    events.push(...syncSeq(turnEngine.advancePhase()));
  }
  return events;
}

/** EndTurnPhaseController.process_end_turn */
export function processEndTurn(
  factionId: string,
  phaseAtRequest: string,
  state: GameState,
  economy: EconomyEngine,
  victory: VictoryEngine,
  turnEngine: TurnEngine,
  syncSeq: SyncSeq,
): GameEvent[] {
  const events: GameEvent[] = [];
  if (phaseAtRequest === "collect_income") {
    events.push(...syncSeq(economy.collectIncome(factionId)));
  }
  events.push(...syncSeq(victory.checkVictory()));
  if (!state.game_over) {
    events.push(...syncSeq(turnEngine.endTurn()));
  }
  return events;
}
