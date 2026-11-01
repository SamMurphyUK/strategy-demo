import type { Dict } from "./types";

/** Values are `GameEvent.Type.keys()[t].to_lower()` from event.gd. */
export const GameEventType = {
  PHASE_CHANGED: "phase_changed",
  UNITS_PURCHASED: "units_purchased",
  PURCHASE_FAILED: "purchase_failed",
  UNITS_MOVED: "units_moved",
  TRANSPORT_LOADED: "transport_loaded",
  TRANSPORT_UNLOADED: "transport_unloaded",
  AMPHIBIOUS_DECLARED: "amphibious_declared",
  AMPHIBIOUS_CANCELLED: "amphibious_cancelled",
  BATTLE_STARTED: "battle_started",
  DICE_ROLLED: "dice_rolled",
  UNITS_DESTROYED: "units_destroyed",
  CARGO_DESTROYED: "cargo_destroyed",
  BATTLE_FINISHED: "battle_finished",
  REGION_CAPTURED: "region_captured",
  UNITS_PLACED: "units_placed",
  PLACEMENT_FORFEITED: "placement_forfeited",
  INCOME_COLLECTED: "income_collected",
  TURN_ENDED: "turn_ended",
  GAME_FINISHED: "game_finished",
} as const;

export type GameEventTypeValue = (typeof GameEventType)[keyof typeof GameEventType];

export interface GameEventDict {
  event_id: string;
  sequence: number;
  type: string;
  payload: Dict;
}

export class GameEvent {
  event_id = "";
  sequence = 0;
  type: GameEventTypeValue = GameEventType.PHASE_CHANGED;
  payload: Dict = {};

  static create(evtType: GameEventTypeValue, evtPayload: Dict, seq: number): GameEvent {
    const evt = new GameEvent();
    evt.event_id = `e_${String(seq).padStart(5, "0")}`;
    evt.sequence = seq;
    evt.type = evtType;
    evt.payload = evtPayload;
    return evt;
  }

  toDict(): GameEventDict {
    return {
      event_id: this.event_id,
      sequence: this.sequence,
      type: GameEvent.typeToString(this.type),
      payload: this.payload,
    };
  }

  static typeToString(t: GameEventTypeValue): string {
    return t;
  }
}
