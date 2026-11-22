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
    const requested = Array.isArray(command.payload.units) ? command.payload.units : null;
    const split = splitAssaultCargo(this.state, deepCopy(td.cargo) as CargoLine[], requested);
    if (split.taken.length === 0) {
      return [];
    }
    const cargo = split.taken;
    td.cargo = split.rest;
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

/**
 * `units` omitted means every cargo line that can fight. A list lands only those counts
 * and leaves the rest aboard, so one circle can assault while the other stays on the ship.
 */
function splitAssaultCargo(
  state: GameState,
  lines: CargoLine[],
  requested: unknown[] | null,
): { taken: CargoLine[]; rest: CargoLine[] } {
  if (requested == null) {
    return {
      taken: lines.filter((line) => !movesOnlyInNoncombat(state, String(line.unit_type_id ?? ""))),
      rest: lines.filter((line) => movesOnlyInNoncombat(state, String(line.unit_type_id ?? ""))),
    };
  }
  const rest = lines.map((line) => ({
    unit_type_id: String(line.unit_type_id ?? ""),
    count: Math.max(0, Math.trunc(Number(line.count ?? 0))),
  }));
  const taken: CargoLine[] = [];
  for (const ask of requested) {
    if (ask == null || typeof ask !== "object") {
      continue;
    }
    const type = String((ask as { unit_type_id?: unknown }).unit_type_id ?? "");
    let need = Math.trunc(Number((ask as { count?: unknown }).count ?? 0));
    if (type === "" || need <= 0 || movesOnlyInNoncombat(state, type)) {
      continue;
    }
    for (const line of rest) {
      if (line.unit_type_id !== type || line.count <= 0 || need <= 0) {
        continue;
      }
      const n = Math.min(line.count, need);
      line.count -= n;
      need -= n;
      const have = taken.find((item) => item.unit_type_id === type);
      if (have) {
        have.count += n;
      } else {
        taken.push({ unit_type_id: type, count: n });
      }
    }
  }
  return { taken, rest: rest.filter((line) => line.count > 0) };
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
