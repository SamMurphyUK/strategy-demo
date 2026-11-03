import { useEffect, useRef, useState } from "react";
import type { ActiveBattle, BattleCasualty, BattleDie, BattleUnitState } from "../../engine/model/battle";
import type { Dict } from "../../engine/model/types";
import { soundManager, volleyCueForUnit } from "../../audio/sound_manager";
import type { BattleFeed } from "./session/use_campaign_session";
import BattleBoard from "../battle/App";
import type { UnitType } from "../battle/combatTypes";
import { UNIT_DEFINITIONS } from "../battle/combatTypes";
import { battleSpriteKey } from "../battle/default_unit_matrices";
import type { BattleMatch, MatchHit, MatchOutcome, MatchRound, MatchUnit } from "../battle/match";
import "./battleScreen.css";
import { playCampaignCue } from "./campaignAudio";
import { factionName } from "./session/event_text";
import type { GameSessionHandle } from "./session/use_game_session";

const OUTCOMES: Record<string, MatchOutcome> = {
  attacker_won: "attacker_wins",
  defender_won: "defender_wins",
  mutual_destruction: "mutual",
  draw: "defender_wins",
};

function boardUnitType(unitTypeId: string): UnitType {
  const key = battleSpriteKey(unitTypeId);
  return Object.prototype.hasOwnProperty.call(UNIT_DEFINITIONS, key) ? (key as UnitType) : "infantry";
}

function toMatchUnits(units: BattleUnitState[], costOf: (unitTypeId: string) => number): MatchUnit[] {
  return units
    .filter((u) => u.hp > 0)
    .map((u) => ({
      id: u.id,
      type: boardUnitType(u.unit_type_id),
      maxHp: u.max_hp,
      cost: costOf(u.unit_type_id),
    }));
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
    defenderCasualties: toHits(casualties.filter((c) => !c.surprise && !c.aa && c.side === "defender")),
    aaCasualties: toHits(casualties.filter((c) => c.aa && c.side === "attacker")),
    attackerHitsToTake: Number(payload?.attacker_hits_to_take ?? 0),
  };
}

interface Props {
  game: GameSessionHandle;
  battle: ActiveBattle;
  regionName: string;
  onExit(): void;
  spectating?: boolean;
  online?: boolean;
  feed?: BattleFeed | null;
}

function emptyRound(): MatchRound {
  return {
    dice: {},
    surpriseCasualties: { attacker: [], defender: [] },
    defenderCasualties: [],
    aaCasualties: [],
    attackerHitsToTake: 0,
  };
}

function volleyCues(payload: Dict | undefined, battle: ActiveBattle) {
  const dice: BattleDie[] = payload?.dice ?? [];
  const units = [...battle.attackers, ...battle.defenders];
  return dice.map((die) => {
    const unit = units.find((item) => item.id === die.unit_id);
    return volleyCueForUnit(unit?.unit_type_id ?? "infantry");
  });
}

/**
 * The battle board playing a battle the engine owns. Every roll, casualty and retreat is a command;
 * the board animates the events that come back.
 */
export function BattleScreen({ game, battle, regionName, onExit, spectating = false, online = false, feed = null }: Props) {
  const [retreats, setRetreats] = useState<string[] | null>(null);
  const [playSignal, setPlaySignal] = useState(0);
  const spectatingRef = useRef(spectating);
  const onlineRef = useRef(online);
  const queueRef = useRef<MatchRound[]>([]);
  const fedSeq = useRef(-1);
  spectatingRef.current = spectating;
  onlineRef.current = online;

  const [match] = useState<BattleMatch>(() => {
    let finished: MatchOutcome | null = null;
    const record = (events: Dict[]) => {
      const done = eventOf(events, "battlefinished");
      if (done) finished = OUTCOMES[String(done.payload?.result)] ?? "defender_wins";
    };
    return {
      theater: battle.battle_type === "naval" ? "navy_test" : "eastern",
      regionName,
      attackerFaction: battle.attacker_faction_id,
      defenderFaction: battle.defender_faction_id,
      attackerIpc: game.session.state.getFactionIpc(battle.attacker_faction_id),
      defenderIpc: game.session.state.getFactionIpc(battle.defender_faction_id),
      attackers: toMatchUnits(battle.attackers, (id) => Math.trunc(Number(game.session.state.unit_types[id]?.cost ?? 0))),
      defenders: toMatchUnits(battle.defenders, (id) => Math.trunc(Number(game.session.state.unit_types[id]?.cost ?? 0))),
      rollRound() {
        const queued = queueRef.current.shift();
        if (queued) {
          return queued;
        }
        if (onlineRef.current || spectatingRef.current) {
          return emptyRound();
        }
        const result = game.send("battle_roll");
        record(result.events);
        return toRound(eventOf(result.events, "dicerolled")?.payload);
      },
      confirmCasualties(unitIds) {
        if (spectatingRef.current) return "undecided";
        if (finished) return finished;
        if (game.session.state.active_battle?.stage !== "awaiting_casualties") return "undecided";
        let result = game.send("battle_casualties", { unit_ids: unitIds });
        if (result.result_type !== "ok") {
          result = game.send("battle_casualties");
        }
        record(result.events);
        return finished ?? "undecided";
      },
      canRetreat: () => !spectatingRef.current && game.session.getLegalRetreats().length > 0,
      retreat() {
        if (spectatingRef.current) return;
        const options = game.session.getLegalRetreats();
        if (options.length === 1) {
          retreatTo(options[0]);
        } else if (options.length > 1) {
          setRetreats(options);
        }
      },
      requestRoll() {
        if (!onlineRef.current || spectatingRef.current) return;
        game.send("battle_roll");
      },
      exit: onExit,
    };
  });

  const attacker = factionName(battle.attacker_faction_id).toUpperCase();
  match.spectating = spectating;
  match.online = online;
  match.spectatorLabel = `SPECTATING BATTLE — ${attacker} ATTACKING`;

  useEffect(() => {
    if (!feed || fedSeq.current === feed.seq) {
      return;
    }
    fedSeq.current = feed.seq;
    if (feed.commandType === "battle_retreat" && spectatingRef.current) {
      playCampaignCue("retreat");
    }
    if (spectatingRef.current && feed.events.some((event) => event.type === "unitsdestroyed")) {
      soundManager.play("assign_casualty");
    }
    const rolled = eventOf(feed.events, "dicerolled");
    if (!rolled) {
      return;
    }
    queueRef.current.push(toRound(rolled.payload));
    if (spectatingRef.current) {
      const cues = volleyCues(rolled.payload, battle);
      if (cues.length > 0) {
        soundManager.scheduleVolley(cues);
      }
    }
    setPlaySignal((n) => n + 1);
  }, [feed, battle]);

  const retreatTo = (regionId: string) => {
    if (spectating) return;
    const result = game.send("battle_retreat", { to_region_id: regionId });
    if (result.result_type === "ok") {
      playCampaignCue("retreat");
      setRetreats(null);
      onExit();
    }
  };

  return (
    <div className="battle-screen">
      <BattleBoard match={match} playSignal={playSignal} />
      {retreats && !spectating && (
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
