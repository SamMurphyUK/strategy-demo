import type { MoveOrder, PhaseStartSnapshot } from "../movement/phase_orders";
import type { NeutralBloc, NationalObjective } from "../rules/optional/objectives";
import { commandedFactions, installGlobal1940, resumeGlobal1940 } from "../rules/optional/global1940Evaluator";
import type { UnitExperience } from "../rules/optional/veterancy";
import { DEFAULT_LEGACY_RULESET, normalizeLaunch, type OptionalRulesetConfig, type ScenarioId } from "../types/ruleset";
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
  /**
   * Build slots frozen at match start and at the end of mobilize.
   * Absent from snapshots. A missing key means "count the factories held now".
   */
  turnBuildCapacity: Record<string, { maxUnits: number; breakdown: { territoryId: string; slots: number }[] }> = {};
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
  /** Air stacks that began this turn on an operational airbase. Absent from snapshots. */
  airbase_launch: Record<string, boolean> = {};
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
  /** Absent from snapshots. An old save therefore stays on the 1942 rules. */
  scenarioId: ScenarioId = "SCENARIO_1942_QUICK";
  rulesetConfig: OptionalRulesetConfig = { ...DEFAULT_LEGACY_RULESET };
  /** Region id → the game round through which urban or forest cover is suppressed. */
  terrainSuppressed: Record<string, number> = {};
  /** Battle-piece id → that piece gives up its first attack to a preparatory bombardment. */
  forfeitOpening: Record<string, boolean> = {};
  /** Battle-piece id → fighter flying escort for a suppression run. Absent from snapshots. */
  escortDuty: Record<string, boolean> = {};
  /** Region id → repair tokens on a major factory. Absent from snapshots. */
  repairTokens: Record<string, number> = {};
  /** Region id → game round through which a forward depot stays closed. Absent from snapshots. */
  depotDisabledUntil: Record<string, number> = {};
  /** Faction id → unlocked research names. Absent from snapshots. */
  researchUnlocked: Record<string, string[]> = {};
  unitExperience: Record<string, UnitExperience> = {};
  /** `faction|region` → fighters with isPatrolling set. Absent from snapshots. */
  patrolCounts: Record<string, number> = {};
  /** Faction id → those fighters stay up until purchase stand-down. Absent from snapshots. */
  patrolLock: Record<string, boolean> = {};
  /** `faction|region` → this move may enter without the patrol bypass tax. Absent from snapshots. */
  patrolBypassWaived: Record<string, boolean> = {};
  /** Winning pieces waiting for one promotion to xp 3. Absent from snapshots. */
  pendingPromotion: { id: string; cost: number }[] = [];
  /** Battle-piece id → the combat round that already spent its veteran reroll. Absent from snapshots. */
  veteranRerollRound: Record<string, number> = {};
  nationalObjectives: NationalObjective[] = [];
  neutralBlocs: NeutralBloc[] = [];
  /** Sea pairs a fleet may cross only while its side holds a control territory. Absent from snapshots. */
  canals: { seas: [string, string]; control: string[] }[] = [];
  /** Faction id → PEACETIME or WARTIME. Absent from snapshots. */
  warStatus: Record<string, "PEACETIME" | "WARTIME"> = {};
  /** Faction id → the round wartime income begins. Absent from snapshots. */
  wartimeBonusRound: Record<string, number> = {};
  /** Faction id → who plays that power. China is played by the United States. Absent from snapshots. */
  playedBy: Record<string, string> = {};
  /** Set once Free France has joined the United Kingdom. Absent from snapshots. */
  freeFranceAbsorbed = false;
  /** Faction id → pips carried into the next research roll. Absent from snapshots. */
  researchPity: Record<string, number> = {};
  /** Faction id → techs waiting for the purchase-phase roll. Absent from snapshots. */
  researchPending: Record<string, string[]> = {};
  /** Sea zones that launched a naval raid this combat move. Absent from snapshots. */
  combatRaids: string[] = [];
  /** Units that bombarded and sit out the battle. Key is `movementStackKey`. */
  bombardSatOut: Record<string, number> = {};

  // ---------------------------------------------------------
  // REGION + ADJACENCY HELPERS
  // ---------------------------------------------------------

  applyCampaignLaunch(raw: unknown): void {
    this.hydrateCampaignLaunch(raw);
    if (this.scenarioId === "SCENARIO_GLOBAL_1940") {
      installGlobal1940(this);
    }
  }

  /** Rules only. A missing save is 1942 Quick with every toggle off. A 1940 save also gets its roster back. */
  hydrateCampaignLaunch(raw: unknown): void {
    const launch = normalizeLaunch(raw);
    this.scenarioId = launch.scenarioId;
    this.rulesetConfig = launch.ruleset;
    if (launch.scenarioId === "SCENARIO_GLOBAL_1940") {
      resumeGlobal1940(this);
    }
  }

  getAdjacentRegions(regionId: string): string[] {
    return this.adjacency[regionId] ?? [];
  }

  isAdjacent(fromId: string, toId: string): boolean {
    return this.getAdjacentRegions(fromId).includes(toId);
  }

  /** A warship step across a canal the mover's side does not hold. */
  canalBlocks(fromId: string, toId: string, factionId: string): boolean {
    if (this.canals.length === 0 || factionId === "") {
      return false;
    }
    for (const canal of this.canals) {
      const [a, b] = canal.seas;
      if (!((fromId === a && toId === b) || (fromId === b && toId === a))) {
        continue;
      }
      const open = canal.control.some((regionId) => {
        const owner = this.regions[regionId]?.owner_faction_id ?? "";
        return owner !== "" && (owner === factionId || this.sameTeam(owner, factionId));
      });
      if (!open) {
        return true;
      }
    }
    return false;
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

  /**
   * A sea zone is a naval target only when an enemy ship is in it.
   * An empty zone, and a zone that merely borders enemy land, is not.
   */
  holdsEnemyNavalUnit(regionId: string, factionId: string): boolean {
    const region = this.regions[regionId];
    if (region == null || !region.isSeaRegion()) {
      return false;
    }
    for (const entry of this.getUnitsInRegion(regionId)) {
      const other = String(entry.faction_id ?? "");
      const count = Math.trunc(Number(entry.count ?? 0));
      if (other === "" || count <= 0 || this.sameTeam(other, factionId)) {
        continue;
      }
      if (String(this.unit_types[String(entry.unit_type_id ?? "")]?.category ?? "") === "sea") {
        return true;
      }
    }
    return false;
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
    const owners = [factionId, ...commandedFactions(this, factionId)];
    let total = 0;
    for (const owner of owners) {
      let have = 0;
      for (const entry of this.getFactionUnitsInRegion(regionId, owner)) {
        if (String(entry.unit_type_id ?? "") === unitTypeId && !("instance_id" in entry)) {
          have += Math.trunc(Number(entry.count ?? 0));
        }
      }
      const key = this.movementStackKey(owner, regionId, unitTypeId);
      const arrived = Math.trunc(Number(this.units_arrived_this_phase[key] ?? 0));
      const embarked = Math.trunc(Number(this.units_embarked_this_phase[key] ?? 0));
      const attacking = Math.trunc(Number(this.units_attacking_this_phase[key] ?? 0));
      total += Math.max(0, have - arrived - embarked - attacking);
    }
    return total;
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
    clearInPlace(this.airbase_launch);
    this.combatRaids = [];
    clearInPlace(this.bombardSatOut);
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
