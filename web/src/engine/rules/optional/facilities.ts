import type { GameState } from "../../model/game_state";
import { convoyDrain, patrolZones } from "./airAndNavalRaiding";

export {
  adjustedMoveRange,
  airRangeBonus,
  capitalHullDamage,
  carryAirbaseLaunch,
  facilitiesActive,
  harborRepair,
  harborStagingLoad,
  navalRangeBonus,
  operationalAirbase,
  operationalHarbor,
  planScramble,
  repairCapitalShips,
} from "./facilitiesResolver";
export type { ScrambleLift } from "./facilitiesResolver";

export interface PatrolZone {
  regionId: string;
  kind: "air" | "convoy";
}

/** Sea zones covered by fighters that set isPatrolling. */
export function airPatrols(state: GameState, factionId: string): PatrolZone[] {
  return patrolZones(state, factionId);
}

/** Enemy submarines in an isConvoyZone drain one Industrial Output each, capped per sea zone. */
export function convoyRaidLoss(state: GameState, factionId: string): number {
  return convoyDrain(state, factionId);
}
