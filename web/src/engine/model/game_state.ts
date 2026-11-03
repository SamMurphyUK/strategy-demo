import type { MoveOrder, PhaseStartSnapshot } from "../movement/phase_orders";
import type { ActiveBattle } from "./battle";
import { Faction } from "./faction";
import { Region } from "./region";
import { type CargoLine, type Dict, deepCopy, type PurchaseLine, type TransportInstance, type UnitStackEntry } from "./types";
import { Unit } from "./unit";

export interface TurnInfo {
  current_faction_id: string;
  current_phase: string;
  turn_number: number;
}

export interface RegionSnapshot {
  region_id: string;
  owner_faction_id: string;
  units: UnitStackEntry[];
}

export interface StateSnapshot {
  game_round: number;
  turn_info: TurnInfo;
  regions: RegionSnapshot[];
  ipc: Record<string, number>;
  pending_purchases: Record<string, PurchaseLine[]>;
  pending_amphibious_assaults: Dict[];
  /** Cargo aboard transports and carriers. Stack units stay counts; only these instances have ids. */
  transport_instances: Record<string, TransportInstance>;
  /** Moves and cargo orders staged in the current movement phase, not yet committed. */
  phase_orders: MoveOrder[];
  active_battle: ActiveBattle | null;
  game_over: boolean;
  winner_faction_id: string;
  [key: string]: unknown;
}

function clearInPlace(record: Record<string, unknown>): void {
  for (const key of Object.keys(record)) {
    delete record[key];
  }
}

export class GameState {
  game_round = 1;
  current_faction_id = "";
  current_phase = "";
  turn_number = 1;
  unit_types: Record<string, Unit> = {};
  factions: Record<string, Faction> = {};
  regions: Record<string, Region> = {};
  adjacency: Record<string, string[]> = {};
  turn_order: string[] = [];
  rules: Dict = {};
  region_units: Record<string, UnitStackEntry[]> = {};
  ipc: Record<string, number> = {};
  pending_purchases: Record<string, PurchaseLine[]> = {};
  pending_amphibious_assaults: Dict[] = [];
  /** Cargo already placed on a hostile coast, with the sea zone it left. Cleared after combat. */
  amphibious_landings: { region_id: string; sea_zone_id: string; faction_id: string; cargo: CargoLine[] }[] = [];
  /** Sea zones that opened a naval battle during this faction's combat. */
  naval_battles_this_turn: Record<string, boolean> = {};
  factories_controlled_at_turn_start: Record<string, string[]> = {};
  next_instance_id: Record<string, number> = {};
  transport_instances: Record<string, TransportInstance> = {};
  game_over = false;
  winner_faction_id = "";
  /** Units that arrived in a region during the current movement window (combat + noncombat). */
  units_arrived_this_phase: Record<string, number> = {};
  units_embarked_this_phase: Record<string, number> = {};
  /** Container instances that already spent movement this window. */
  instances_moved_this_phase: Record<string, boolean> = {};
  /** Stacks that declared a combat-move attack and are still in the region they left from. */
  units_attacking_this_phase: Record<string, number> = {};
  /** Air movement already spent this turn, keyed `faction|region|unitType`. Combat move and noncombat share it. */
  air_movement_spent: Record<string, number> = {};
  /** Land taken this turn. Aircraft cannot land there until the next turn. */
  territories_captured_this_turn: Record<string, boolean> = {};
  /** Territories where a battle was resolved during the current round. Cleared when the round advances. */
  territories_fought_this_round: Record<string, boolean> = {};
  /** The battle being fought round by round in the combat phase, if any. */
  active_battle: ActiveBattle | null = null;
  /** Orders applied since the current movement phase began. */
  phase_orders: MoveOrder[] = [];
  /** Next `phase_orders` id. Reset when the phase snapshot is taken. */
  phase_order_seq = 0;
  /** Deep clone of this state at the start of `combat_move` or `noncombat_move`. */
  phase_start_snapshot: PhaseStartSnapshot | null = null;

  // ---------------------------------------------------------
  // REGION + ADJACENCY HELPERS
  // ---------------------------------------------------------

  getAdjacentRegions(regionId: string): string[] {
    return this.adjacency[regionId] ?? [];
  }

  isAdjacent(fromId: string, toId: string): boolean {
    return this.getAdjacentRegions(fromId).includes(toId);
  }

  getRegionOwner(regionId: string): string {
    const region = this.regions[regionId];
    return region ? region.owner_faction_id : "";
  }

  setRegionOwner(regionId: string, factionId: string): void {
    const region = this.regions[regionId];
    if (region) {
      region.owner_faction_id = factionId;
    }
  }

  // ---------------------------------------------------------
  // REGION TYPE + OWNERSHIP HELPERS
  // ---------------------------------------------------------

  isRegionLand(regionId: string): boolean {
    const region = this.regions[regionId];
    return region != null && region.type === "land";
  }

  isRegionOwnedBy(regionId: string, factionId: string): boolean {
    const region = this.regions[regionId];
    return region != null && region.owner_faction_id === factionId;
  }

  /** A faction with no team is its own side, so the two-power scenarios stay hostile to each other. */
  teamOf(factionId: string): string {
    if (factionId === "") {
      return "";
    }
    const team = this.factions[factionId]?.team ?? "";
    return team !== "" ? team : factionId;
  }

  sameTeam(a: string, b: string): boolean {
    if (a === "" || b === "") {
      return false;
    }
    return this.teamOf(a) === this.teamOf(b);
  }

  isRegionHostileTo(regionId: string, factionId: string): boolean {
    const region = this.regions[regionId];
    if (region == null) {
      return true;
    }
    const owner = String(region.owner_faction_id);
    if (owner !== "" && !this.sameTeam(owner, factionId)) {
      return true;
    }
    for (const entry of this.getUnitsInRegion(regionId)) {
      const other = String(entry.faction_id ?? "");
      if (other !== "" && !this.sameTeam(other, factionId)) {
        return true;
      }
    }
    return false;
  }

  movementStackKey(factionId: string, regionId: string, unitTypeId: string): string {
    return `${factionId}|${regionId}|${unitTypeId}`;
  }

  movableStackCount(factionId: string, regionId: string, unitTypeId: string): number {
    let total = 0;
    for (const entry of this.getFactionUnitsInRegion(regionId, factionId)) {
      if (String(entry.unit_type_id ?? "") === unitTypeId && !("instance_id" in entry)) {
        total += Math.trunc(Number(entry.count ?? 0));
      }
    }
    const key = this.movementStackKey(factionId, regionId, unitTypeId);
    const arrived = Math.trunc(Number(this.units_arrived_this_phase[key] ?? 0));
    const embarked = Math.trunc(Number(this.units_embarked_this_phase[key] ?? 0));
    const attacking = Math.trunc(Number(this.units_attacking_this_phase[key] ?? 0));
    return Math.max(0, total - arrived - embarked - attacking);
  }

  recordStackEmbark(factionId: string, regionId: string, unitTypeId: string, count: number): void {
    const key = this.movementStackKey(factionId, regionId, unitTypeId);
    this.units_embarked_this_phase[key] = (this.units_embarked_this_phase[key] ?? 0) + count;
  }

  recordStackArrival(factionId: string, regionId: string, unitTypeId: string, count: number): void {
    const key = this.movementStackKey(factionId, regionId, unitTypeId);
    this.units_arrived_this_phase[key] = (this.units_arrived_this_phase[key] ?? 0) + count;
  }

  /** Count units that have declared an attack but have not entered the enemy region. */
  recordAttackHold(factionId: string, regionId: string, unitTypeId: string, count: number): void {
    const key = this.movementStackKey(factionId, regionId, unitTypeId);
    this.units_attacking_this_phase[key] = (this.units_attacking_this_phase[key] ?? 0) + count;
  }

  releaseAttackHold(factionId: string, regionId: string, unitTypeId: string, count: number): void {
    const key = this.movementStackKey(factionId, regionId, unitTypeId);
    const next = (this.units_attacking_this_phase[key] ?? 0) - count;
    if (next <= 0) {
      delete this.units_attacking_this_phase[key];
    } else {
      this.units_attacking_this_phase[key] = next;
    }
  }

  hasInstanceMoved(instanceId: string): boolean {
    return Boolean(this.instances_moved_this_phase[instanceId] ?? false);
  }

  recordInstanceMoved(instanceId: string): void {
    this.instances_moved_this_phase[instanceId] = true;
  }

  noteTerritoryFought(regionId: string): void {
    if (regionId !== "") {
      this.territories_fought_this_round[regionId] = true;
    }
  }

  clearFoughtThisRound(): void {
    clearInPlace(this.territories_fought_this_round);
  }

  clearMovementPhaseTracking(): void {
    clearInPlace(this.units_arrived_this_phase);
    clearInPlace(this.units_embarked_this_phase);
    clearInPlace(this.instances_moved_this_phase);
    clearInPlace(this.units_attacking_this_phase);
    clearInPlace(this.air_movement_spent);
    clearInPlace(this.territories_captured_this_turn);
    clearInPlace(this.naval_battles_this_turn);
    this.amphibious_landings = [];
  }

  // ---------------------------------------------------------
  // IPC + ECONOMY
  // ---------------------------------------------------------

  getFactionIpc(factionId: string): number {
    return this.ipc[factionId] ?? 0;
  }

  modifyIpc(factionId: string, amount: number): void {
    this.ipc[factionId] = (this.ipc[factionId] ?? 0) + amount;
  }

  // ---------------------------------------------------------
  // INSTANCE ID GENERATION
  // ---------------------------------------------------------

  generateInstanceId(unitTypeId: string, factionId: string): string {
    const key = `${unitTypeId}_${factionId}`;
    const seq = this.next_instance_id[key] ?? 1;
    this.next_instance_id[key] = seq + 1;
    return `${unitTypeId}_${factionId}_${String(seq).padStart(3, "0")}`;
  }

  // ---------------------------------------------------------
  // UNIT LOOKUP HELPERS (dictionary-based)
  // ---------------------------------------------------------

  getUnitsInRegion(regionId: string): UnitStackEntry[] {
    return this.region_units[regionId] ?? [];
  }

  getFactionUnitsInRegion(regionId: string, factionId: string): UnitStackEntry[] {
    return this.getUnitsInRegion(regionId).filter((entry) => entry.faction_id === factionId);
  }

  getEnemyUnitsInRegion(regionId: string, factionId: string): UnitStackEntry[] {
    return this.getUnitsInRegion(regionId).filter((entry) => !this.sameTeam(String(entry.faction_id ?? ""), factionId));
  }

  getUnit(id: number): UnitStackEntry | Dict {
    for (const regionId of Object.keys(this.region_units)) {
      for (const entry of this.region_units[regionId]) {
        if (entry.id === id) {
          return entry;
        }
      }
    }
    return {};
  }

  getUnitRegion(id: number): string {
    for (const regionId of Object.keys(this.region_units)) {
      for (const entry of this.region_units[regionId]) {
        if (entry.id === id) {
          return regionId;
        }
      }
    }
    return "";
  }

  getUnitsForFaction(factionId: string): UnitStackEntry[] {
    const result: UnitStackEntry[] = [];
    for (const regionId of Object.keys(this.region_units)) {
      for (const entry of this.region_units[regionId]) {
        if (entry.faction_id === factionId) {
          result.push(entry);
        }
      }
    }
    return result;
  }

  // ---------------------------------------------------------
  // SNAPSHOT SERIALISATION
  // ---------------------------------------------------------

  /** `units` is the live array, matching to_snapshot() which does not copy it. */
  toSnapshot(): StateSnapshot {
    const regionData: RegionSnapshot[] = [];
    for (const regionId of Object.keys(this.regions)) {
      regionData.push({
        region_id: regionId,
        owner_faction_id: this.regions[regionId].owner_faction_id,
        units: this.getUnitsInRegion(regionId),
      });
    }
    return {
      game_round: this.game_round,
      turn_info: {
        current_faction_id: this.current_faction_id,
        current_phase: this.current_phase,
        turn_number: this.turn_number,
      },
      regions: regionData,
      ipc: { ...this.ipc },
      pending_purchases: deepCopy(this.pending_purchases),
      pending_amphibious_assaults: deepCopy(this.pending_amphibious_assaults),
      transport_instances: deepCopy(this.transport_instances),
      phase_orders: deepCopy(this.phase_orders),
      game_over: this.game_over,
      winner_faction_id: this.winner_faction_id,
      active_battle: deepCopy(this.active_battle),
    };
  }
}
