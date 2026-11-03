// Movement phases keep a clone from the moment they begin. Cancelling an order
// restores that clone and plays the other orders forward again.
import { isAirUnit, noteAirArrival } from "../air/air_fuel";
import { Faction } from "../model/faction";
import { Command, CommandType } from "../model/command";
import type { GameEvent } from "../model/event";
import type { GameState } from "../model/game_state";
import { Region } from "../model/region";
import type { Dict } from "../model/types";
import { Unit } from "../model/unit";
import { Ruleset } from "../rules/ruleset";
import { AmphibiousEngine, deployPendingAssaults } from "../amphibious/amphibious";
import { MovementEngine } from "./movement";
import { MovementValidator } from "./movement_validator";
import { assaultError, transportSeaZone, unloadError } from "../transport/cargo_rules";
import { TransportLoadValidator } from "../transport/transport_load_validator";

export interface MoveOrder {
  id: string;
  faction: string;
  unitType: string;
  count: number;
  fromRegionId: string;
  toRegionId: string;
  /** Indexes into `Object.keys(state.regions)`, from the origin through the destination. */
  path: number[];
  stepsUsed: number;
  shipInstanceIds?: string[];
  /** Absent on a normal move. Cargo orders are applied when they are issued, then skipped at commit. */
  kind?: "move" | "load_transport" | "unload_transport" | "amphibious_assault";
  transportInstanceId?: string;
  cargo?: { unit_type_id: string; count: number }[];
}

/** `structuredClone` of a `GameState`. Region, unit, and faction prototypes are put back on restore. */
export type PhaseStartSnapshot = GameState;

const MOVEMENT_PHASES = ["combat_move", "noncombat_move"];

function cloneData<T>(value: T): T {
  return (globalThis as unknown as { structuredClone: <U>(value: U) => U }).structuredClone(value);
}

export function beginMovementPhase(state: GameState): void {
  if (state.current_phase === "noncombat_move") {
    releaseAirArrivals(state);
  }
  state.phase_orders = [];
  state.phase_order_seq = 0;
  state.phase_start_snapshot = null;
  state.phase_start_snapshot = cloneData(state);
}

/** Aircraft move again in noncombat, within whatever fuel the combat move left them. Land and sea stay spent. */
function releaseAirArrivals(state: GameState): void {
  for (const key of Object.keys(state.units_arrived_this_phase)) {
    const unitType = key.slice(key.lastIndexOf("|") + 1);
    if (isAirUnit(state, unitType)) {
      delete state.units_arrived_this_phase[key];
    }
  }
}

/** Append one order per unit line of a move that has already been applied. */
export function recordMoveOrders(state: GameState, command: Command): void {
  if (state.phase_start_snapshot == null || !MOVEMENT_PHASES.includes(state.current_phase)) {
    return;
  }
  const moves: unknown[] = command.payload.moves ?? [];
  const validator = new MovementValidator();
  const indexes = Object.keys(state.regions);
  for (const move of moves) {
    if (!isRecord(move)) {
      continue;
    }
    const fromRegionId = String(move.from_region_id ?? "");
    const toRegionId = String(move.to_region_id ?? "");
    const units: unknown[] = Array.isArray(move.units) ? move.units : [];
    for (const unit of units) {
      if (!isRecord(unit)) {
        continue;
      }
      const unitType = String(unit.unit_type_id ?? "");
      const instanceId = String(unit.instance_id ?? "");
      const sea = state.unit_types[unitType]?.category === "sea";
      const air = state.unit_types[unitType]?.category === "air";
      const walked = validator.shortestPath(fromRegionId, toRegionId, state, sea, command.player_id, air);
      state.phase_order_seq += 1;
      const order: MoveOrder = {
        id: `ord_${state.phase_order_seq}`,
        faction: command.player_id,
        unitType,
        count: Math.trunc(Number(unit.count ?? 1)),
        fromRegionId,
        toRegionId,
        path: walked.map((regionId) => indexes.indexOf(regionId)),
        stepsUsed: Math.max(0, walked.length - 1),
      };
      if (sea && instanceId !== "") {
        order.shipInstanceIds = [instanceId];
      }
      state.phase_orders.push(order);
    }
  }
}

/** Every move in a movement phase stays an order until that phase ends. */
function orderIsHeld(state: GameState): boolean {
  return state.current_phase === "combat_move" || state.current_phase === "noncombat_move";
}

/**
 * Apply a validated move and record it. A held order does not enter its destination:
 * the units stay where they are until the phase ends, and can be cancelled one by one.
 */
export function applyRecordedMove(state: GameState, command: Command, movement: MovementEngine): GameEvent[] {
  const moves = (command.payload.moves ?? []) as unknown[];
  const going: Dict[] = [];
  for (const move of moves) {
    if (!isRecord(move)) {
      continue;
    }
    if (orderIsHeld(state)) {
      const fromRegion = String(move.from_region_id ?? "");
      const units = Array.isArray(move.units) ? move.units : [];
      for (const unit of units) {
        if (isRecord(unit)) {
          holdAttack(state, command.player_id, fromRegion, unit);
        }
      }
    } else {
      going.push(move);
    }
  }
  const events = movement.processMove(commandWithMoves(command, going));
  events[0].payload = { faction_id: command.player_id, moves: command.payload.moves ?? [] };
  const marked = state.phase_orders.length;
  recordMoveOrders(state, command);
  for (const order of state.phase_orders.slice(marked)) {
    if (orderIsHeld(state)) {
      continue;
    }
    noteAirArrival(state, order.faction, order.fromRegionId, order.toRegionId, order.unitType, order.stepsUsed);
  }
  return events;
}

function commitOrders(state: GameState, orders: readonly MoveOrder[]): void {
  const movement = new MovementEngine(state);
  for (const order of orders) {
    if (order.kind != null && order.kind !== "move") {
      continue;
    }
    if (!order.shipInstanceIds || order.shipInstanceIds.length === 0) {
      state.releaseAttackHold(order.faction, order.fromRegionId, order.unitType, order.count);
    }
    movement.processMove(commandForOrder(order));
    noteAirArrival(state, order.faction, order.fromRegionId, order.toRegionId, order.unitType, order.stepsUsed);
  }
  for (const key of Object.keys(state.units_attacking_this_phase)) {
    delete state.units_attacking_this_phase[key];
  }
}

/** Walk every combat-move order onto the board as combat begins. Attacks can then be fought. */
export function commitCombatAttacks(state: GameState): void {
  if (state.current_phase !== "combat_move") {
    return;
  }
  commitOrders(state, state.phase_orders);
  deployPendingAssaults(state);
}

/** Walk noncombat orders onto the board as that phase ends. */
export function commitNoncombatMoves(state: GameState): void {
  if (state.current_phase !== "noncombat_move") {
    return;
  }
  commitOrders(state, state.phase_orders);
}

/**
 * `order_id` selects one staged order. When it is absent, `index` is its position in
 * `phase_orders`. A present `order_id` is never replaced by `index`.
 */
export function findPhaseOrder(state: GameState, payload: Dict): MoveOrder | null {
  const rawId = payload.order_id ?? payload.orderId;
  if (rawId != null && String(rawId) !== "") {
    const id = String(rawId);
    return state.phase_orders.find((order) => order.id === id) ?? null;
  }
  if (!Object.prototype.hasOwnProperty.call(payload, "index") || payload.index == null || payload.index === "") {
    return null;
  }
  const index = Math.trunc(Number(payload.index));
  if (!Number.isFinite(index) || index < 0) {
    return null;
  }
  return state.phase_orders[index] ?? null;
}

/**
 * Drop `orderId`, put the board back to the phase-start clone, and run the other orders
 * through the movement validator and movement engine in their original order.
 */
export function cancel_phase_order(state: GameState, orderId: string): void {
  const snapshot = state.phase_start_snapshot;
  if (snapshot == null || !MOVEMENT_PHASES.includes(state.current_phase)) {
    return;
  }
  if (!state.phase_orders.some((order) => order.id === orderId)) {
    return;
  }
  const remaining = state.phase_orders.filter((order) => order.id !== orderId);
  Object.assign(state, cloneData(snapshot));
  rehydrateState(state);
  state.phase_start_snapshot = snapshot;
  state.phase_orders = [];

  const ruleset = new Ruleset();
  ruleset.syncFromState(state);
  const validator = new MovementValidator();
  const movement = new MovementEngine(state);
  for (const order of remaining) {
    if (order.kind === "load_transport" || order.kind === "unload_transport" || order.kind === "amphibious_assault") {
      const command = commandForCargo(order);
      if (!cargoOrderIsLegal(state, command)) {
        break;
      }
      applyCargoCommand(state, command, movement);
      continue;
    }
    const command = commandForOrder(order);
    if (!orderIsLegal(validator, ruleset, state, command)) {
      break;
    }
    applyRecordedMove(state, command, movement);
  }
}

/** Apply a load, unload, or assault and keep it on the phase order list. */
export function applyCargoCommand(
  state: GameState,
  command: Command,
  movement: MovementEngine,
  amphibious?: AmphibiousEngine,
): GameEvent[] {
  if (command.type === CommandType.LOAD_TRANSPORT) {
    const events = movement.processLoad(command);
    rememberCargo(state, command, "load_transport");
    return events;
  }
  if (command.type === CommandType.UNLOAD_TRANSPORT) {
    const events = movement.processUnload(command);
    rememberCargo(state, command, "unload_transport");
    return events;
  }
  if (command.type === CommandType.DESIGNATE_AMPHIBIOUS) {
    const events = (amphibious ?? new AmphibiousEngine(state)).designateAssault(command);
    rememberCargo(state, command, "amphibious_assault");
    return events;
  }
  return [];
}

function rememberCargo(
  state: GameState,
  command: Command,
  kind: "load_transport" | "unload_transport" | "amphibious_assault",
): void {
  if (state.phase_start_snapshot == null || !MOVEMENT_PHASES.includes(state.current_phase)) {
    return;
  }
  const transportInstanceId = String(command.payload.transport_instance_id ?? "");
  const cargo = cargoLines(command, state, kind);
  const fromRegionId =
    kind === "load_transport"
      ? String(command.payload.from_region_id ?? "")
      : kind === "amphibious_assault"
        ? String(command.payload.origin_sea_zone_id ?? "")
        : transportSeaZone(state, transportInstanceId);
  const toRegionId =
    kind === "load_transport"
      ? transportSeaZone(state, transportInstanceId)
      : kind === "unload_transport"
        ? String(command.payload.to_region_id ?? "")
        : String(command.payload.target_region_id ?? "");
  const indexes = Object.keys(state.regions);
  state.phase_order_seq += 1;
  const first = cargo[0];
  state.phase_orders.push({
    id: `ord_${state.phase_order_seq}`,
    faction: command.player_id,
    unitType: first ? String(first.unit_type_id) : "cargo",
    count: cargo.reduce((sum, line) => sum + Math.trunc(Number(line.count ?? 0)), 0),
    fromRegionId,
    toRegionId,
    path: [indexes.indexOf(fromRegionId), indexes.indexOf(toRegionId)].filter((index) => index >= 0),
    stepsUsed: 0,
    kind,
    transportInstanceId,
    cargo,
  });
}

function cargoLines(
  command: Command,
  state: GameState,
  kind: "load_transport" | "unload_transport" | "amphibious_assault",
): { unit_type_id: string; count: number }[] {
  if (kind === "amphibious_assault") {
    const last = state.pending_amphibious_assaults[state.pending_amphibious_assaults.length - 1];
    const cargo = Array.isArray(last?.cargo) ? last.cargo : [];
    return cargo.map((line: Dict) => ({
      unit_type_id: String(line.unit_type_id ?? ""),
      count: Math.trunc(Number(line.count ?? 0)),
    }));
  }
  const units = Array.isArray(command.payload.units) ? command.payload.units : [];
  return units.filter(isRecord).map((line) => ({
    unit_type_id: String(line.unit_type_id ?? ""),
    count: Math.trunc(Number(line.count ?? 1)),
  }));
}

function commandForCargo(order: MoveOrder): Command {
  if (order.kind === "load_transport") {
    return Command.fromDict({
      player_id: order.faction,
      type: CommandType.LOAD_TRANSPORT,
      payload: {
        transport_instance_id: order.transportInstanceId,
        from_region_id: order.fromRegionId,
        units: order.cargo ?? [],
      },
    });
  }
  if (order.kind === "unload_transport") {
    return Command.fromDict({
      player_id: order.faction,
      type: CommandType.UNLOAD_TRANSPORT,
      payload: {
        transport_instance_id: order.transportInstanceId,
        to_region_id: order.toRegionId,
        units: order.cargo ?? [],
      },
    });
  }
  return Command.fromDict({
    player_id: order.faction,
    type: CommandType.DESIGNATE_AMPHIBIOUS,
    payload: {
      transport_instance_id: order.transportInstanceId,
      origin_sea_zone_id: order.fromRegionId,
      target_region_id: order.toRegionId,
    },
  });
}

function cargoOrderIsLegal(state: GameState, command: Command): boolean {
  if (command.type === CommandType.LOAD_TRANSPORT) {
    return new TransportLoadValidator()
      .validateLoad(
        String(command.payload.transport_instance_id ?? ""),
        String(command.payload.from_region_id ?? ""),
        command.payload.units ?? [],
        command.player_id,
        state,
      ).ok;
  }
  if (command.type === CommandType.UNLOAD_TRANSPORT) {
    return (
      unloadError(
        state,
        command.player_id,
        String(command.payload.transport_instance_id ?? ""),
        String(command.payload.to_region_id ?? ""),
        command.payload.units ?? [],
      ) == null
    );
  }
  return (
    assaultError(
      state,
      command.player_id,
      String(command.payload.transport_instance_id ?? ""),
      String(command.payload.origin_sea_zone_id ?? ""),
      String(command.payload.target_region_id ?? ""),
    ) == null
  );
}

function holdAttack(state: GameState, faction: string, fromRegion: string, unit: Dict): void {
  const instanceId = String(unit.instance_id ?? "");
  if (instanceId !== "") {
    state.recordInstanceMoved(instanceId);
    return;
  }
  state.recordAttackHold(faction, fromRegion, String(unit.unit_type_id ?? ""), Math.trunc(Number(unit.count ?? 1)));
}

function commandWithMoves(command: Command, moves: Dict[]): Command {
  return Command.fromDict({
    command_id: command.command_id,
    player_id: command.player_id,
    faction_id: command.faction_id,
    type: command.type,
    payload: { ...command.payload, moves },
  });
}

function commandForOrder(order: MoveOrder): Command {
  const unit: Dict = { unit_type_id: order.unitType, count: order.count };
  const shipId = order.shipInstanceIds?.[0];
  if (shipId) {
    unit.instance_id = shipId;
  }
  return Command.fromDict({
    player_id: order.faction,
    type: CommandType.MOVE_UNITS,
    payload: {
      moves: [{ from_region_id: order.fromRegionId, to_region_id: order.toRegionId, units: [unit] }],
    },
  });
}

function orderIsLegal(validator: MovementValidator, ruleset: Ruleset, state: GameState, command: Command): boolean {
  for (const move of (command.payload.moves ?? []) as unknown[]) {
    if (!isRecord(move)) {
      return false;
    }
    const fromRegion = String(move.from_region_id ?? "");
    const toRegion = String(move.to_region_id ?? "");
    for (const unit of (Array.isArray(move.units) ? move.units : []) as unknown[]) {
      if (!isRecord(unit)) {
        return false;
      }
      const instanceId = String(unit.instance_id ?? "");
      const result =
        instanceId !== ""
          ? validator.validateInstanceMove(fromRegion, toRegion, instanceId, command.player_id, state, ruleset)
          : validator.validateStackMove(
              fromRegion,
              toRegion,
              String(unit.unit_type_id ?? ""),
              command.player_id,
              Math.trunc(Number(unit.count ?? 1)),
              state,
              ruleset,
            );
      if (!result.ok) {
        return false;
      }
    }
  }
  return true;
}

function rehydrateState(state: GameState): void {
  for (const region of Object.values(state.regions)) {
    Object.setPrototypeOf(region, Region.prototype);
  }
  for (const unit of Object.values(state.unit_types)) {
    Object.setPrototypeOf(unit, Unit.prototype);
  }
  for (const faction of Object.values(state.factions)) {
    Object.setPrototypeOf(faction, Faction.prototype);
  }
}

function isRecord(value: unknown): value is Dict {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
