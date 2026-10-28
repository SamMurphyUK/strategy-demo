import { useState } from "react";
import type { ActiveBattle, BattleCasualty, BattleDie, BattleUnitState } from "../../engine/model/battle";
import type { Dict } from "../../engine/model/types";
import BattleBoard from "../battle/App";
import type { UnitType } from "../battle/combatTypes";
import type { BattleMatch, MatchHit, MatchOutcome, MatchRound, MatchUnit } from "../battle/match";
import "./battleScreen.css";
import type { GameSessionHandle } from "./session/use_game_session";

const BOARD_TYPES: Record<string, UnitType> = {
  infantry: "infantry",
  mech_infantry: "infantry",
  artillery: "artillery",
  tank: "tank",
  fighter: "fighter",
  tactical_bomber: "tactical_bomber",
  strategic_bomber: "strategic_bomber",
  submarine: "submarine",
  destroyer: "destroyer",
  cruiser: "cruiser",
  carrier: "carrier",
  battleship: "battleship",
};

const OUTCOMES: Record<string, MatchOutcome> = {
  attacker_won: "attacker_wins",
  defender_won: "defender_wins",
  mutual_destruction: "mutual",
  draw: "defender_wins",
};

function toMatchUnits(units: BattleUnitState[]): MatchUnit[] {
  return units
    .filter((u) => u.hp > 0)
    .map((u) => ({ id: u.id, type: BOARD_TYPES[u.unit_type_id] ?? "infantry", maxHp: u.max_hp }));
}

function toHits(casualties: BattleCasualty[]): MatchHit[] {
  return casualties.map((c) => ({ unitId: c.unit_id, result: c.result }));
}

function eventOf(events: Dict[], type: string): Dict | undefined {
  return events.find((e) => e.type === type);
}

function toRound(payload: Dict | undefined): MatchRound {
  const dice: BattleDie[] = payload?.dice ?? [];
  const casualties: BattleCasualty[] = payload?.casualties ?? [];
  const surprise = casualties.filter((c) => c.surprise);
  return {
    dice: Object.fromEntries(dice.map((d) => [d.unit_id, { roll: d.roll, hit: d.hit }])),
    surpriseCasualties: {
      attacker: toHits(surprise.filter((c) => c.side === "attacker")),
      defender: toHits(surprise.filter((c) => c.side === "defender")),
    },
    defenderCasualties: toHits(casualties.filter((c) => !c.surprise && c.side === "defender")),
    attackerHitsToTake: Number(payload?.attacker_hits_to_take ?? 0),
  };
}

interface Props {
  game: GameSessionHandle;
  battle: ActiveBattle;
  regionName: string;
  onExit(): void;
}

/**
 * The battle board playing a battle the engine owns. Every roll, casualty and retreat is a command;
 * the board animates the events that come back.
 */
export function BattleScreen({ game, battle, regionName, onExit }: Props) {
  const [retreats, setRetreats] = useState<string[] | null>(null);

  const [match] = useState<BattleMatch>(() => {
    let finished: MatchOutcome | null = null;
    const record = (events: Dict[]) => {
      const done = eventOf(events, "battlefinished");
      if (done) finished = OUTCOMES[String(done.payload?.result)] ?? "defender_wins";
    };
    return {
      theater: battle.battle_type === "naval" ? "navy_test" : "eastern",
      regionName,
      attackerIpc: game.session.state.getFactionIpc(battle.attacker_faction_id),
      defenderIpc: game.session.state.getFactionIpc(battle.defender_faction_id),
      attackers: toMatchUnits(battle.attackers),
      defenders: toMatchUnits(battle.defenders),
      rollRound() {
        const result = game.send("battle_roll");
        record(result.events);
        return toRound(eventOf(result.events, "dicerolled")?.payload);
      },
      confirmCasualties(unitIds) {
        if (finished) return finished;
        if (game.session.state.active_battle?.stage !== "awaiting_casualties") return "undecided";
        let result = game.send("battle_casualties", { unit_ids: unitIds });
        if (result.result_type !== "ok") {
          // The board and engine disagree on who can take a hit; let the engine pick rather than stall.
          result = game.send("battle_casualties");
        }
        record(result.events);
        return finished ?? "undecided";
      },
      canRetreat: () => game.session.getLegalRetreats().length > 0,
      retreat() {
        const options = game.session.getLegalRetreats();
        if (options.length === 1) {
          retreatTo(options[0]);
        } else if (options.length > 1) {
          setRetreats(options);
        }
      },
      exit: onExit,
    };
  });

  const retreatTo = (regionId: string) => {
    const result = game.send("battle_retreat", { to_region_id: regionId });
    if (result.result_type === "ok") {
      setRetreats(null);
      onExit();
    }
  };

  return (
    <div className="battle-screen">
      <BattleBoard match={match} />
      {retreats && (
        <div className="retreat-picker" role="dialog" aria-label="Retreat">
          <div className="retreat-card">
            <h2>Retreat to</h2>
            {retreats.map((id) => (
              <button key={id} type="button" onClick={() => retreatTo(id)}>
                {id}
              </button>
            ))}
            <button type="button" className="muted" onClick={() => setRetreats(null)}>
              Stay and fight
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
