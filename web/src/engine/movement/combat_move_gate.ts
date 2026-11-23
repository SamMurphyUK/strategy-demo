import { strandedPlanes } from "../air/air_fuel";
import type { GameState } from "../model/game_state";
import { cancel_phase_order } from "./phase_orders";
import { HOSTILE_COAST_MESSAGE, hostileCoastTransport, strandedCargoGate } from "../transport/cargo_rules";

export interface CombatMoveGate {
  advance: boolean;
  regionId: string;
  warning: string;
  code: "" | "PLANES_NO_LANDING" | "CARGO_STRANDED" | "TRANSPORT_ON_HOSTILE_COAST";
}

const OPEN: CombatMoveGate = { advance: true, regionId: "", warning: "", code: "" };

/**
 * A combat-move flight that cannot land is undone before the phase ends.
 * A plane that started the turn with no landing stays up and is scrapped at the end of noncombat.
 */
export function retractUnlandableFlights(state: GameState): void {
  if (state.current_phase !== "combat_move") {
    return;
  }
  const factionId = state.current_faction_id;
  for (let guard = 0; guard < 20; guard += 1) {
    const stuck = strandedPlanes(state, factionId).filter((plane) => !plane.canReturn);
    const order = [...state.phase_orders]
      .reverse()
      .find(
        (item) =>
          item.faction === factionId &&
          stuck.some((plane) => plane.regionId === item.toRegionId && plane.unitType === item.unitType),
      );
    if (order == null) {
      return;
    }
    cancel_phase_order(state, order.id);
  }
}

/** Empty when combat move may end. Otherwise the piece the camera should show. */
export function endCombatMoveGate(state: GameState): CombatMoveGate {
  if (state.current_phase !== "combat_move") {
    return OPEN;
  }
  const cargo = strandedCargoGate(state);
  if (!cargo.advance) {
    return { advance: false, regionId: cargo.seaZoneId, warning: cargo.warning, code: "CARGO_STRANDED" };
  }
  const coast = hostileCoastTransport(state);
  if (coast !== "") {
    return { advance: false, regionId: coast, warning: HOSTILE_COAST_MESSAGE, code: "TRANSPORT_ON_HOSTILE_COAST" };
  }
  return OPEN;
}
