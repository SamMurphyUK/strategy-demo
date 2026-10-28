import { GameEvent, GameEventType } from "../model/event";
import type { GameState } from "../model/game_state";

export class VictoryEngine {
  private _seq: number;

  constructor(
    public state: GameState,
    seqStart = 0,
  ) {
    this._seq = seqStart;
  }

  checkVictory(): GameEvent[] {
    const state = this.state;
    if (state.game_over) {
      return [];
    }
    for (const faction of Object.keys(state.factions)) {
      let controlsAll = true;
      for (const rid of Object.keys(state.regions)) {
        const r = state.regions[rid];
        if (r.is_capital && r.owner_faction_id !== faction) {
          controlsAll = false;
          break;
        }
      }
      if (controlsAll) {
        state.game_over = true;
        state.winner_faction_id = faction;
        return [
          GameEvent.create(
            GameEventType.GAME_FINISHED,
            { winner_faction_id: faction, reason: "all_enemy_capitals_captured" },
            this.nextSeq(),
          ),
        ];
      }
    }
    return [];
  }

  private nextSeq(): number {
    this._seq += 1;
    return this._seq;
  }

  setSequence(val: number): void {
    this._seq = val;
  }
}
