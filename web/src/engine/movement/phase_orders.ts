// Movement phases keep a clone from the moment they begin. Cancelling an order
// restores that clone and plays the other orders forward again.
import { Faction } from "../model/faction";
import { Command, CommandType } from "../model/command";
import type { GameState } from "../model/game_state";
import { Region } from "../model/region";
import type { Dict } from "../model/types";
import { Unit } from "../model/unit";
import { Ruleset } from "../rules/ruleset";
import { MovementEngine } from "./movement";
import { MovementValidator } from "./movement_validator";

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
}

/** `structuredClone` of a `GameState`. Region, unit, and faction prototypes are put back on restore. */
export type PhaseStartSnapshot = GameState;

const MOVEMENT_PHASES = ["combat_move", "noncombat_move"];

function cloneData<T>(value: T): T {
  return (globalThis as unknown as { structuredClone: <U>(value: U) => U }).structuredClone(value);
}

export function beginMovementPhase(state: GameState): void {
  state.phase_orders = [];
  state.phase_order_seq = 0;
  state.phase_start_snapshot = null;
  state.phase_start_snapshot = cloneData(state);
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
      const walked = validator.shortestPath(fromRegionId, toRegionId, state, sea, command.player_id);
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
    const command = commandForOrder(order);
    if (!orderIsLegal(validator, ruleset, state, command)) {
      break;
    }
    movement.processMove(command);
    recordMoveOrders(state, command);
  }
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
