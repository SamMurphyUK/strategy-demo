import { describeStranded, planesMustLandMessage, strandedPlanes } from "../../engine/air/air_fuel";
import { endCombatMoveGate } from "../../engine/movement/combat_move_gate";
import { mustPlaceMessage } from "../../engine/placement/unplaced";
import type { GameSessionHandle } from "../map/session/use_game_session";

/** End-phase control for the phases when the right drawer is off the map. */
export function PhaseChip({
  game,
  commandsEnabled,
  onFight,
  onStrandedCargo,
}: {
  game: GameSessionHandle;
  commandsEnabled: boolean;
  onFight(regionId: string): void;
  onStrandedCargo?(seaZoneId: string): void;
}) {
  const state = game.session.state;
  const faction = state.current_faction_id;
  const phase = state.current_phase;
  if (phase === "purchase" || phase === "mobilize") {
    return null;
  }
  const legal = game.session.getLegalCommands(faction);
  const battles = phase === "combat" ? game.session.getPendingBattles(faction) : [];
  const mustReturn = phase === "noncombat_move" ? planesMustLandMessage(state, faction) : "";
  const mustPlace = phase === "mobilize" ? mustPlaceMessage(state, faction) : "";
  const moveGate = phase === "combat_move" ? endCombatMoveGate(state) : { advance: true, regionId: "", warning: "" };
  const doomed = phase === "noncombat_move" ? strandedPlanes(state, faction).filter((plane) => !plane.canReturn) : [];
  if (!legal.includes("end_phase") && !legal.includes("end_turn") && battles.length === 0) {
    return null;
  }
  return (
    <div className="hud-phase-chip">
      {mustReturn !== "" && <p className="warn">{mustReturn}</p>}
      {moveGate.warning !== "" && <p className="warn">{moveGate.warning}</p>}
      {doomed.length > 0 && <p className="warn">{describeStranded(state, doomed)} will be lost when the phase ends.</p>}
      {legal.includes("start_battle") && battles.length > 0 && (
        <button type="button" className="primary" disabled={!commandsEnabled} onClick={() => onFight(battles[0].region_id)}>
          Fight next battle
        </button>
      )}
      {legal.includes("end_phase") && (
        <button
          type="button"
          className="primary"
          disabled={mustReturn !== "" || mustPlace !== "" || !commandsEnabled}
          onClick={() => {
            if (!moveGate.advance) {
              onStrandedCargo?.(moveGate.regionId);
              return;
            }
            game.send("end_phase");
          }}
        >
          End phase
        </button>
      )}
      {legal.includes("end_turn") && (
        <button type="button" className="primary" disabled={!commandsEnabled} onClick={() => game.send("end_turn")}>
          Collect income and end turn
        </button>
      )}
    </div>
  );
}
