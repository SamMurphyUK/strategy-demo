import type { GameState } from "../model/game_state";
import type { Dict } from "../model/types";
import { Ruleset } from "./ruleset";

const CLASSIC_UNIT_DEFS: Record<string, Dict> = {
  infantry: { cost: 3, move: 1, is_land: true },
  artillery: { cost: 4, move: 1, is_land: true },
  tank: { cost: 6, move: 2, is_land: true },
  fighter: { cost: 10, move: 4, is_air: true },
  bomber: { cost: 12, move: 6, is_air: true },
  transport: { cost: 7, move: 2, is_sea: true },
  submarine: { cost: 8, move: 2, is_sea: true },
  destroyer: { cost: 8, move: 2, is_sea: true },
  carrier: { cost: 14, move: 2, is_sea: true },
  battleship: { cost: 20, move: 2, is_sea: true },
};

export class RulesetClassic extends Ruleset {
  override getUnitDef(unitType: string): Dict {
    return CLASSIC_UNIT_DEFS[unitType] ?? {};
  }

  override isRegionHostileTo(region: string, factionId: string, state: GameState): boolean {
    return state.isRegionHostileTo(region, factionId);
  }

  /** Checks the phase name "non_combat", which no phase uses; kept as in ruleset_classic.gd. */
  override canUnitEnterRegion(unitType: string, region: string, state: GameState, phase: string): boolean {
    void unitType;
    if (phase === "non_combat" && this.isRegionHostileTo(region, state.current_faction_id, state)) {
      return false;
    }
    return true;
  }
}
