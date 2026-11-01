import type { Command } from "../model/command";
import { GameEvent, GameEventType } from "../model/event";
import type { GameState } from "../model/game_state";
import type { Dict, PurchaseLine } from "../model/types";
import { Unit } from "../model/unit";

export class PlacementEngine {
  private _seq: number;

  constructor(
    public state: GameState,
    seqStart = 0,
  ) {
    this._seq = seqStart;
  }

  processPlacement(command: Command): GameEvent[] {
    const placements: Dict[] = command.payload.placements ?? [];
    const faction = command.player_id;
    for (const p of placements) {
      for (const u of p.units as Dict[]) {
        this.addToRegion(p.region_id, faction, u);
        this.consumePending(faction, u);
      }
    }
    return [
      GameEvent.create(GameEventType.UNITS_PLACED, { faction_id: faction, placements }, this.nextSeq()),
    ];
  }

  private consumePending(faction: string, unitEntry: Dict): void {
    const utid = String(unitEntry.unit_type_id ?? "");
    let toConsume = Math.trunc(Number(unitEntry.count ?? 1));
    if (toConsume <= 0 || utid === "") {
      return;
    }
    const pending = this.state.pending_purchases[faction] ?? [];
    if (pending.length === 0) {
      return;
    }
    const remaining: PurchaseLine[] = [];
    for (const line of pending) {
      const lineUtid = String(line.unit_type_id ?? "");
      let lineCount = Math.trunc(Number(line.count ?? 0));
      if (lineUtid === utid && toConsume > 0) {
        const used = Math.min(lineCount, toConsume);
        lineCount -= used;
        toConsume -= used;
      }
      if (lineCount > 0) {
        remaining.push({ unit_type_id: lineUtid, count: lineCount });
      }
    }
    this.state.pending_purchases[faction] = remaining;
  }

  checkForfeited(faction: string): GameEvent[] {
    const state = this.state;
    const pending = state.pending_purchases[faction] ?? [];
    if (pending.length === 0) {
      return [];
    }

    const valid = state.factories_controlled_at_turn_start[faction] ?? [];
    const current: string[] = [];
    for (const rid of Object.keys(state.regions)) {
      const r = state.regions[rid];
      if (r.has_factory && r.owner_faction_id === faction) {
        current.push(rid);
      }
    }

    const lost = valid.filter((f) => !current.includes(f));

    if (lost.length > 0 && pending.length > 0) {
      let ipc = 0;
      for (const p of pending) {
        const ut = state.unit_types[p.unit_type_id];
        if (ut) {
          ipc += ut.cost * p.count;
        }
      }

      state.pending_purchases[faction] = [];

      return [
        GameEvent.create(
          GameEventType.PLACEMENT_FORFEITED,
          {
            faction_id: faction,
            region_id: lost[0],
            reason: "factory_lost",
            forfeited_units: pending,
            ipc_lost: ipc,
          },
          this.nextSeq(),
        ),
      ];
    }
    return [];
  }

  private addToRegion(rid: string, faction: string, entry: Dict): void {
    const state = this.state;
    if (!(rid in state.region_units)) {
      state.region_units[rid] = [];
    }
    const units = state.region_units[rid];
    const ut = state.unit_types[entry.unit_type_id];

    if (Unit.isContainerUnit(ut)) {
      for (let i = 0; i < entry.count; i++) {
        const iid = state.generateInstanceId(entry.unit_type_id, faction);
        state.transport_instances[iid] = {
          instance_id: iid,
          unit_type_id: entry.unit_type_id,
          cargo: [],
          region_id: rid,
        };
        units.push({ faction_id: faction, unit_type_id: entry.unit_type_id, instance_id: iid, count: 1 });
      }
    } else {
      for (const u of units) {
        if (u.faction_id === faction && u.unit_type_id === entry.unit_type_id && !("instance_id" in u)) {
          u.count += entry.count;
          return;
        }
      }
      units.push({ faction_id: faction, unit_type_id: entry.unit_type_id, count: entry.count });
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
