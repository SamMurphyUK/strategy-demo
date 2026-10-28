import type { Command } from "../model/command";
import { GameEvent, GameEventType } from "../model/event";
import type { GameState } from "../model/game_state";
import type { Dict, UnitStackEntry } from "../model/types";

export class MovementEngine {
  private _seq: number;

  constructor(
    public state: GameState,
    seqStart = 0,
  ) {
    this._seq = seqStart;
  }

  processMove(command: Command): GameEvent[] {
    const moves: Dict[] = command.payload.moves ?? [];
    for (const move of moves) {
      for (const unitEntry of move.units as Dict[]) {
        this.transfer(move.from_region_id, move.to_region_id, command.player_id, unitEntry);
      }
    }
    return [
      GameEvent.create(GameEventType.UNITS_MOVED, { faction_id: command.player_id, moves }, this.nextSeq()),
    ];
  }

  processLoad(command: Command): GameEvent[] {
    const tid: string = command.payload.transport_instance_id;
    const fromRegion: string = command.payload.from_region_id;
    const units: Dict[] = command.payload.units;
    const td = this.state.transport_instances[tid];
    for (const u of units) {
      this.removeFromRegion(fromRegion, command.player_id, u);
      this.addToCargo(tid, u);
      this.state.recordStackEmbark(
        command.player_id,
        fromRegion,
        String(u.unit_type_id ?? ""),
        Math.trunc(Number(u.count ?? 1)),
      );
    }
    return [
      GameEvent.create(
        GameEventType.TRANSPORT_LOADED,
        {
          faction_id: command.player_id,
          transport_instance_id: tid,
          sea_zone_id: td.region_id,
          from_region_id: fromRegion,
          units,
        },
        this.nextSeq(),
      ),
    ];
  }

  processUnload(command: Command): GameEvent[] {
    const tid: string = command.payload.transport_instance_id;
    const toRegion: string = command.payload.to_region_id;
    const units: Dict[] = command.payload.units;
    const td = this.state.transport_instances[tid];
    for (const u of units) {
      this.removeFromCargo(tid, u);
      this.addToRegion(toRegion, command.player_id, u);
    }
    return [
      GameEvent.create(
        GameEventType.TRANSPORT_UNLOADED,
        {
          faction_id: command.player_id,
          transport_instance_id: tid,
          sea_zone_id: td.region_id,
          to_region_id: toRegion,
          units,
        },
        this.nextSeq(),
      ),
    ];
  }

  private transfer(from: string, to: string, faction: string, entry: Dict): void {
    this.removeFromRegion(from, faction, entry);
    this.addToRegion(to, faction, entry);
    if ("instance_id" in entry) {
      this.state.recordInstanceMoved(String(entry.instance_id ?? ""));
    } else {
      this.state.recordStackArrival(
        faction,
        to,
        String(entry.unit_type_id ?? ""),
        Math.trunc(Number(entry.count ?? 1)),
      );
    }
  }

  private removeFromRegion(rid: string, faction: string, entry: Dict): void {
    const units: UnitStackEntry[] = this.state.region_units[rid] ?? [];
    if ("instance_id" in entry) {
      const iid = String(entry.instance_id ?? "");
      for (let i = units.length - 1; i >= 0; i--) {
        if (String(units[i].instance_id ?? "") === iid) {
          units.splice(i, 1);
          break;
        }
      }
      return;
    }
    let count = Math.trunc(Number(entry.count ?? 1));
    for (let i = units.length - 1; i >= 0; i--) {
      const u = units[i];
      if (u.faction_id === faction && u.unit_type_id === entry.unit_type_id && !("instance_id" in u)) {
        if (u.count > count) {
          u.count -= count;
          break;
        } else {
          count -= u.count;
          units.splice(i, 1);
        }
        if (count <= 0) {
          break;
        }
      }
    }
  }

  private addToRegion(rid: string, faction: string, entry: Dict): void {
    if (!(rid in this.state.region_units)) {
      this.state.region_units[rid] = [];
    }
    const units = this.state.region_units[rid];
    if ("instance_id" in entry) {
      const iid = String(entry.instance_id ?? "");
      units.push({
        faction_id: faction,
        unit_type_id: String(entry.unit_type_id ?? ""),
        instance_id: iid,
        count: Math.trunc(Number(entry.count ?? 1)),
      });
      if (iid in this.state.transport_instances) {
        this.state.transport_instances[iid].region_id = rid;
      }
      return;
    }
    for (const u of units) {
      if (u.faction_id === faction && u.unit_type_id === entry.unit_type_id && !("instance_id" in u)) {
        u.count += entry.count;
        return;
      }
    }
    units.push({ faction_id: faction, unit_type_id: entry.unit_type_id, count: entry.count });
  }

  private addToCargo(tid: string, entry: Dict): void {
    const cargo = this.state.transport_instances[tid].cargo;
    for (const c of cargo) {
      if (c.unit_type_id === entry.unit_type_id) {
        c.count += entry.count;
        return;
      }
    }
    cargo.push({ unit_type_id: entry.unit_type_id, count: entry.count });
  }

  private removeFromCargo(tid: string, entry: Dict): void {
    const cargo = this.state.transport_instances[tid].cargo;
    let count: number = entry.count;
    for (let i = cargo.length - 1; i >= 0; i--) {
      const c = cargo[i];
      if (c.unit_type_id === entry.unit_type_id) {
        if (c.count > count) {
          c.count -= count;
          break;
        } else {
          count -= c.count;
          cargo.splice(i, 1);
        }
        if (count <= 0) {
          break;
        }
      }
    }
  }

  private nextSeq(): number {
    this._seq += 1;
    return this._seq;
  }

  setSequence(val: number): void {
    this._seq = val;
  }
}
