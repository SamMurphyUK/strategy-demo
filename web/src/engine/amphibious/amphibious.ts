import type { CombatEngine } from "../combat/combat";
import type { Command } from "../model/command";
import { GameEvent, GameEventType } from "../model/event";
import type { GameState } from "../model/game_state";
import { deepCopy } from "../model/types";

export class AmphibiousEngine {
  private _seq: number;

  constructor(
    public state: GameState,
    seqStart = 0,
  ) {
    this._seq = seqStart;
  }

  designateAssault(command: Command): GameEvent[] {
    const tid: string = command.payload.transport_instance_id;
    const origin: string = command.payload.origin_sea_zone_id;
    const target: string = command.payload.target_region_id;
    const td = this.state.transport_instances[tid];
    const cargo = deepCopy(td.cargo);
    const aid = `amp_${String(this.state.pending_amphibious_assaults.length + 1).padStart(3, "0")}`;
    this.state.pending_amphibious_assaults.push({
      assault_id: aid,
      transport_instance_id: tid,
      origin_sea_zone_id: origin,
      target_region_id: target,
      cargo,
    });
    return [
      GameEvent.create(
        GameEventType.AMPHIBIOUS_DECLARED,
        {
          assault_id: aid,
          faction_id: command.player_id,
          transport_instance_id: tid,
          origin_sea_zone_id: origin,
          target_region_id: target,
          cargo,
        },
        this.nextSeq(),
      ),
    ];
  }

  /** Clears pending assaults and resolves nothing, as amphibious.gd does today. */
  resolveAssaults(_attacker: string, _combat: CombatEngine): GameEvent[] {
    this.state.pending_amphibious_assaults = [];
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
