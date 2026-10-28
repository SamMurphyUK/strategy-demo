import type { GameState } from "../model/game_state";
import { type CargoLine, type Dict, isDict } from "../model/types";
import type { Unit } from "../model/unit";
import { MoveError, ValidationResult } from "../validation/validation_types";

export class TransportLoadValidator {
  getLegalLoadDestinations(fromRegion: string, unitTypeId: string, factionId: string, state: GameState): string[] {
    const legal: string[] = [];
    if (fromRegion === "" || unitTypeId === "") {
      return legal;
    }
    const from = state.regions[fromRegion];
    if (from == null || !from.isLandRegion()) {
      return legal;
    }
    if (state.movableStackCount(factionId, fromRegion, unitTypeId) <= 0) {
      return legal;
    }
    for (const neighbor of state.getAdjacentRegions(fromRegion)) {
      const seaId = String(neighbor);
      const sea = state.regions[seaId];
      if (sea == null || !sea.isSeaRegion()) {
        continue;
      }
      for (const transportId of this.friendlyTransportIds(seaId, factionId, state)) {
        if (this.canLoadUnits(transportId, fromRegion, [{ unit_type_id: unitTypeId, count: 1 }], factionId, state)) {
          if (!legal.includes(seaId)) {
            legal.push(seaId);
          }
        }
      }
    }
    return legal;
  }

  findTransportForLoad(
    fromRegion: string,
    seaRegion: string,
    unitTypeId: string,
    factionId: string,
    state: GameState,
  ): string {
    for (const transportId of this.friendlyTransportIds(seaRegion, factionId, state)) {
      if (this.canLoadUnits(transportId, fromRegion, [{ unit_type_id: unitTypeId, count: 1 }], factionId, state)) {
        return transportId;
      }
    }
    return "";
  }

  validateLoad(
    transportInstanceId: string,
    fromRegion: string,
    units: unknown[],
    factionId: string,
    state: GameState,
  ): ValidationResult {
    const result = new ValidationResult();
    if (transportInstanceId === "" || fromRegion === "") {
      result.errors.push(MoveError.of("LOAD_INVALID", "Missing transport or source region"));
    } else if (!this.canLoadUnits(transportInstanceId, fromRegion, units, factionId, state)) {
      result.errors.push(MoveError.of("LOAD_INVALID", "Cannot load units onto transport"));
    }
    result.ok = result.errors.length === 0;
    return result;
  }

  canLoadUnits(
    transportInstanceId: string,
    fromRegion: string,
    units: unknown[],
    factionId: string,
    state: GameState,
  ): boolean {
    if (!["combat_move", "noncombat_move"].includes(state.current_phase)) {
      return false;
    }
    const td = state.transport_instances[transportInstanceId];
    if (td == null || Object.keys(td).length === 0) {
      return false;
    }
    const seaRegion = String(td.region_id ?? "");
    if (seaRegion === "" || !state.isAdjacent(fromRegion, seaRegion)) {
      return false;
    }
    const from = state.regions[fromRegion];
    const sea = state.regions[seaRegion];
    if (from == null || sea == null || !from.isLandRegion() || !sea.isSeaRegion()) {
      return false;
    }
    if (!this.transportBelongsToFaction(transportInstanceId, factionId, state)) {
      return false;
    }
    const transportType = String(td.unit_type_id ?? "transport");
    const transportUnit = state.unit_types[transportType];
    if (transportUnit == null) {
      return false;
    }
    for (const unitEntry of units) {
      if (!isDict(unitEntry)) {
        return false;
      }
      const utid = String(unitEntry.unit_type_id ?? "");
      const count = Math.trunc(Number(unitEntry.count ?? 1));
      if (count <= 0) {
        return false;
      }
      if (state.movableStackCount(factionId, fromRegion, utid) < count) {
        return false;
      }
      const cargoUnit = state.unit_types[utid];
      if (cargoUnit == null || cargoUnit.category !== "land") {
        return false;
      }
      if (!this.cargoAllowed(transportUnit, utid, state)) {
        return false;
      }
      if (!this.hasUnitsInRegion(fromRegion, factionId, utid, count, state)) {
        return false;
      }
      const cargo: CargoLine[] = td.cargo ?? [];
      if (!this.fitsCargo(transportUnit, cargo, utid, count)) {
        return false;
      }
    }
    return true;
  }

  private friendlyTransportIds(seaRegion: string, factionId: string, state: GameState): string[] {
    const ids: string[] = [];
    for (const entry of state.getFactionUnitsInRegion(seaRegion, factionId)) {
      if (!("instance_id" in entry)) {
        continue;
      }
      const iid = String(entry.instance_id ?? "");
      if (iid in state.transport_instances) {
        ids.push(iid);
      }
    }
    return ids;
  }

  private transportBelongsToFaction(transportInstanceId: string, factionId: string, state: GameState): boolean {
    const seaRegion = String(state.transport_instances[transportInstanceId]?.region_id ?? "");
    for (const entry of state.getFactionUnitsInRegion(seaRegion, factionId)) {
      if (String(entry.instance_id ?? "") === transportInstanceId) {
        return true;
      }
    }
    return false;
  }

  private hasUnitsInRegion(
    regionId: string,
    factionId: string,
    unitTypeId: string,
    count: number,
    state: GameState,
  ): boolean {
    return state.movableStackCount(factionId, regionId, unitTypeId) >= count;
  }

  /** An empty container dictionary passes the null check and then fails on the empty allow-list. */
  private cargoAllowed(transportUnit: Unit, cargoUnitTypeId: string, state: GameState): boolean {
    const container = transportUnit.container;
    if (container == null || !isDict(container)) {
      return false;
    }
    const cargo = state.unit_types[cargoUnitTypeId];
    if (cargo == null) {
      return false;
    }
    const allowed: unknown[] = container.allowed_cargo_categories ?? [];
    return allowed.includes(cargo.category);
  }

  private fitsCargo(transportUnit: Unit, cargo: CargoLine[], newType: string, newCount: number): boolean {
    const container = transportUnit.container;
    if (container == null || !isDict(container)) {
      return false;
    }
    const capacity = Math.trunc(Number(container.capacity ?? 0));
    const maxPerType: Dict = container.max_per_type ?? {};
    const totals: Record<string, number> = {};
    let slots = 0;
    for (const line of cargo) {
      const utid = String(line.unit_type_id ?? "");
      const count = Math.trunc(Number(line.count ?? 0));
      totals[utid] = (totals[utid] ?? 0) + count;
      slots += count;
    }
    totals[newType] = (totals[newType] ?? 0) + newCount;
    slots += newCount;
    if (slots > capacity) {
      return false;
    }
    for (const utid of Object.keys(totals)) {
      if (utid in maxPerType && totals[utid] > Math.trunc(Number(maxPerType[utid]))) {
        return false;
      }
    }
    return true;
  }
}
