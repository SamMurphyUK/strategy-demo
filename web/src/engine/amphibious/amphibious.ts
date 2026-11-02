import type { CombatEngine } from "../combat/combat";
import type { Command } from "../model/command";
import { GameEvent, GameEventType } from "../model/event";
import type { GameState } from "../model/game_state";
import { type CargoLine, deepCopy } from "../model/types";
import { movesOnlyInNoncombat } from "../transport/cargo_rules";

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
    if (td == null) {
      return [];
    }
    const cargo = (deepCopy(td.cargo) as CargoLine[]).filter(
      (line) => !movesOnlyInNoncombat(this.state, String(line.unit_type_id ?? "")),
    );
    td.cargo = (td.cargo ?? []).filter((line) => movesOnlyInNoncombat(this.state, String(line.unit_type_id ?? "")));
    const aid = `amp_${String(this.state.pending_amphibious_assaults.length + 1).padStart(3, "0")}`;
    this.state.pending_amphibious_assaults.push({
      assault_id: aid,
      faction_id: command.player_id,
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

  /** Puts declared assault cargo onto the beaches, then drops the pending list. */
  resolveAssaults(_attacker: string, _combat: CombatEngine): GameEvent[] {
    const landed = deployPendingAssaults(this.state);
    if (landed === 0) {
      return [];
    }
    return [
      GameEvent.create(
        GameEventType.AMPHIBIOUS_DECLARED,
        { faction_id: _attacker, assaults: landed },
        this.nextSeq(),
      ),
    ];
  }

  private nextSeq(): number {
    this._seq += 1;
    return this._seq;
  }

  setSequence(val: number): void {
    this._seq = val;
  }
}

/** Move every pending assault onto its beach and remember it for bombardment and retreat. */
export function deployPendingAssaults(state: GameState): number {
  const assaults = state.pending_amphibious_assaults;
  if (assaults.length === 0) {
    return 0;
  }
  state.pending_amphibious_assaults = [];
  for (const assault of assaults) {
    const faction = String(assault.faction_id ?? state.current_faction_id);
    const target = String(assault.target_region_id ?? "");
    const cargo = (Array.isArray(assault.cargo) ? assault.cargo : []) as CargoLine[];
    for (const line of cargo) {
      addStack(state, target, faction, String(line.unit_type_id ?? ""), Math.trunc(Number(line.count ?? 0)));
    }
    state.amphibious_landings.push({
      region_id: target,
      sea_zone_id: String(assault.origin_sea_zone_id ?? ""),
      faction_id: faction,
      cargo: cargo.map((line) => ({
        unit_type_id: String(line.unit_type_id ?? ""),
        count: Math.trunc(Number(line.count ?? 0)),
      })),
    });
  }
  return assaults.length;
}

function addStack(state: GameState, regionId: string, factionId: string, unitTypeId: string, count: number): void {
  if (regionId === "" || unitTypeId === "" || count <= 0) {
    return;
  }
  if (!(regionId in state.region_units)) {
    state.region_units[regionId] = [];
  }
  const units = state.region_units[regionId];
  const existing = units.find(
    (entry) => entry.faction_id === factionId && entry.unit_type_id === unitTypeId && entry.instance_id == null,
  );
  if (existing) {
    existing.count += count;
    return;
  }
  units.push({ faction_id: factionId, unit_type_id: unitTypeId, count });
}
