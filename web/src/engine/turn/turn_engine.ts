import { GameEvent, GameEventType } from "../model/event";
import type { GameState } from "../model/game_state";

export const PHASES = [
  "purchase",
  "combat_move",
  "combat",
  "noncombat_move",
  "mobilize",
  "collect_income",
] as const;

export type TurnPhase = (typeof PHASES)[number];

export class TurnEngine {
  private _seq = 0;

  constructor(public state: GameState) {}

  startGame(): GameEvent[] {
    const state = this.state;
    state.current_faction_id = state.turn_order[0];
    state.current_phase = PHASES[0];
    state.turn_number = 1;
    state.game_round = 1;
    this.recordFactories();
    return [
      GameEvent.create(
        GameEventType.PHASE_CHANGED,
        { faction_id: state.current_faction_id, new_phase: state.current_phase },
        this.nextSeq(),
      ),
    ];
  }

  /** An unknown phase has index -1, so it advances to "purchase", as PHASES.find() does in GDScript. */
  advancePhase(): GameEvent[] {
    const state = this.state;
    const oldPhase = state.current_phase;
    const idx = (PHASES as readonly string[]).indexOf(state.current_phase);
    if (idx < PHASES.length - 1) {
      state.current_phase = PHASES[idx + 1];
      this.syncMovementTracking(oldPhase, state.current_phase);
      return [
        GameEvent.create(
          GameEventType.PHASE_CHANGED,
          { faction_id: state.current_faction_id, new_phase: state.current_phase },
          this.nextSeq(),
        ),
      ];
    }
    return [];
  }

  endTurn(): GameEvent[] {
    const state = this.state;
    const events: GameEvent[] = [];
    events.push(
      GameEvent.create(
        GameEventType.TURN_ENDED,
        {
          faction_id: state.current_faction_id,
          turn_number: state.turn_number,
          game_round: state.game_round,
        },
        this.nextSeq(),
      ),
    );
    const idx = state.turn_order.indexOf(state.current_faction_id);
    const nextIdx = (idx + 1) % state.turn_order.length;
    state.current_faction_id = state.turn_order[nextIdx];
    state.turn_number += 1;
    if (nextIdx === 0) {
      state.game_round += 1;
    }
    state.current_phase = PHASES[0];
    state.clearMovementPhaseTracking();
    this.recordFactories();
    events.push(
      GameEvent.create(
        GameEventType.PHASE_CHANGED,
        { faction_id: state.current_faction_id, new_phase: state.current_phase },
        this.nextSeq(),
      ),
    );
    return events;
  }

  private syncMovementTracking(oldPhase: string, newPhase: string): void {
    if (oldPhase === "purchase" && newPhase === "combat_move") {
      this.state.clearMovementPhaseTracking();
    } else if (oldPhase === "noncombat_move") {
      this.state.clearMovementPhaseTracking();
    }
  }

  private recordFactories(): void {
    const state = this.state;
    const factories: string[] = [];
    for (const rid of Object.keys(state.regions)) {
      const r = state.regions[rid];
      if (r.has_factory && r.owner_faction_id === state.current_faction_id) {
        factories.push(rid);
      }
    }
    state.factories_controlled_at_turn_start[state.current_faction_id] = factories;
  }

  private nextSeq(): number {
    this._seq += 1;
    return this._seq;
  }

  setSequence(val: number): void {
    this._seq = val;
  }
}
