import { describeStranded, strandedPlanes } from "../air/air_fuel";
import type { GameState } from "../model/game_state";
import { HOSTILE_COAST_MESSAGE, hostileCoastTransport, strandedCargoGate } from "../transport/cargo_rules";

export interface CombatMoveGate {
  advance: boolean;
  regionId: string;
  warning: string;
  code: "" | "PLANES_NO_LANDING" | "CARGO_STRANDED" | "TRANSPORT_ON_HOSTILE_COAST";
}

const OPEN: CombatMoveGate = { advance: true, regionId: "", warning: "", code: "" };

/** Empty when combat move may end. Otherwise the piece the camera should show. */
export function endCombatMoveGate(state: GameState): CombatMoveGate {
  if (state.current_phase !== "combat_move") {
    return OPEN;
  }
  const factionId = state.current_faction_id;
  const planes = strandedPlanes(state, factionId).filter((plane) => !plane.canReturn);
  if (planes.length > 0) {
    return {
      advance: false,
      regionId: planes[0].regionId,
      warning: `No landing zone for ${describeStranded(state, planes)}.`,
      code: "PLANES_NO_LANDING",
    };
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
