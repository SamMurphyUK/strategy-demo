import { useEffect, useState } from "react";
import type { Battle } from "../../../engine/combat/combat";
import type { PurchaseLine } from "../../../engine/model/types";
import type { Selection } from "../App";
import { UnitToken } from "../../theme/tokens/UnitToken";
import { factionName, phaseName, unitName } from "../session/event_text";
import type { GameSessionHandle } from "../session/use_game_session";

interface Props {
  game: GameSessionHandle;
  selection: Selection;
  setSelection(s: Selection): void;
  legalTargets: string[];
  pending: PurchaseLine[];
}

export function PhasePanel({ game, selection, setSelection, legalTargets, pending }: Props) {
  const { session } = game;
  const state = session.state;
  const faction = state.current_faction_id;
  const phase = state.current_phase;
  const legal = session.getLegalCommands(faction);
  const battles = phase === "combat" ? session.getPendingBattles(faction) : [];
  const fight = (regionId: string) => game.send("start_battle", { region_id: regionId });

  return (
    <section className="panel phase-panel">
      <h2>
        {factionName(faction)}: {phaseName(phase)}
      </h2>

      {phase === "purchase" && <PurchaseBody game={game} pending={pending} />}

      {(phase === "combat_move" || phase === "noncombat_move") && (
        <MoveBody selection={selection} setSelection={setSelection} legalTargets={legalTargets} game={game} />
      )}

      {phase === "combat" && <CombatBody battles={battles} onFight={fight} />}

      {phase === "mobilize" && (
        <MobilizeBody
          game={game}
          pending={pending}
          selection={selection}
          setSelection={setSelection}
          legalTargets={legalTargets}
        />
      )}

      {phase === "collect_income" && (
        <p>
          Income this turn: <strong>{session.economy.calculateIncome(faction)} IPC</strong> from owned land.
        </p>
      )}

      <div className="phase-actions">
        {legal.includes("start_battle") && battles.length > 0 && (
          <button type="button" className="primary" onClick={() => fight(battles[0].region_id)}>
            Fight next battle
          </button>
        )}
        {legal.includes("end_phase") && (
          <button
            type="button"
            className={battles.length > 0 ? "" : "primary"}
            onClick={() => game.send("end_phase")}
          >
            {battles.length > 0 ? "Auto-resolve the rest and end phase" : "End phase"}
          </button>
        )}
        {legal.includes("end_turn") && (
          <button type="button" className="primary" onClick={() => game.send("end_turn")}>
            Collect income and end turn
          </button>
        )}
      </div>
    </section>
  );
}

function PurchaseBody({ game, pending }: { game: GameSessionHandle; pending: PurchaseLine[] }) {
  const { session } = game;
  const state = session.state;
  const faction = state.current_faction_id;
  const costs = session.getCostTable();
  const [staged, setStaged] = useState<Record<string, number>>({});

  useEffect(() => {
    setStaged({});
  }, [faction, game.seed]);

  const total = Object.entries(staged).reduce((sum, [id, n]) => sum + (costs[id] ?? 0) * n, 0);
  const ipc = state.getFactionIpc(faction);
  const bump = (id: string, d: number) =>
    setStaged((s) => ({ ...s, [id]: Math.max(0, (s[id] ?? 0) + d) }));

  const confirm = () => {
    const purchases = Object.entries(staged)
      .filter(([, n]) => n > 0)
      .map(([unit_type_id, count]) => ({ unit_type_id, count }));
    if (purchases.length === 0) {
      return;
    }
    const result = game.send("purchase_units", { purchases });
    if (result.result_type === "ok") {
      setStaged({});
    }
  };

  return (
    <>
      <p className="muted catalog-legend">Cost in IPC · attack / defense / movement</p>
      <ul className="catalog">
        {Object.keys(costs).map((id) => {
          const ut = state.unit_types[id];
          const count = staged[id] ?? 0;
          return (
            <li key={id} className={count > 0 ? "unit-card staged" : "unit-card"}>
              <UnitToken unit={id} faction={faction} size={56} />
              <div className="unit-card-info">
                <span className="unit-name">{unitName(id, state.unit_types)}</span>
                <span className="unit-stats mono">
                  {costs[id]} IPC · {ut.attack}/{ut.defense}/{ut.movement}
                </span>
              </div>
              <div className="stepper">
                <button type="button" onClick={() => bump(id, -1)} disabled={count === 0} aria-label="Remove one">
                  −
                </button>
                <span className="mono">{count}</span>
                <button type="button" onClick={() => bump(id, 1)} aria-label="Add one">
                  +
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className={total > ipc ? "warn" : "budget"}>
        Total <b className="mono">{total}</b> IPC of <b className="mono">{ipc}</b> available
      </p>
      <div className="row">
        <button type="button" onClick={confirm} disabled={total === 0}>
          Confirm purchase
        </button>
        <button type="button" onClick={() => setStaged({})} disabled={total === 0}>
          Clear
        </button>
      </div>
      {pending.length > 0 && (
        <p className="muted">
          Bought this turn: {pending.map((p) => `${p.count} ${unitName(p.unit_type_id, state.unit_types)}`).join(", ")}.
          You place them in Mobilize.
        </p>
      )}
    </>
  );
}

function MoveBody({
  game,
  selection,
  setSelection,
  legalTargets,
}: {
  game: GameSessionHandle;
  selection: Selection;
  setSelection(s: Selection): void;
  legalTargets: string[];
}) {
  const state = game.session.state;
  if (selection?.kind !== "stack") {
    return (
      <p className="muted">
        Click one of your units with a dashed outline, then click a highlighted region. Units that already moved this
        phase have no outline.
      </p>
    );
  }
  return (
    <>
      <p>
        Moving <strong>{unitName(selection.unitTypeId, state.unit_types)}</strong> from {selection.regionId}.
      </p>
      {selection.max > 1 && (
        <div className="row stepper">
          <button
            type="button"
            onClick={() => setSelection({ ...selection, count: Math.max(1, selection.count - 1) })}
            disabled={selection.count <= 1}
          >
            −
          </button>
          <span>
            {selection.count} of {selection.max}
          </span>
          <button
            type="button"
            onClick={() => setSelection({ ...selection, count: Math.min(selection.max, selection.count + 1) })}
            disabled={selection.count >= selection.max}
          >
            +
          </button>
        </div>
      )}
      <p className="muted">
        {legalTargets.length === 0
          ? "No legal destinations."
          : `Legal destinations: ${legalTargets.join(", ")}.`}
      </p>
      <button type="button" onClick={() => setSelection(null)}>
        Cancel (Esc)
      </button>
    </>
  );
}

function CombatBody({ battles, onFight }: { battles: Battle[]; onFight(regionId: string): void }) {
  if (battles.length === 0) {
    return <p className="muted">No battles this turn.</p>;
  }
  return (
    <>
      <ul className="battles">
        {battles.map((b) => (
          <li key={b.region_id}>
            <button type="button" onClick={() => onFight(b.region_id)}>
              Fight
            </button>{" "}
            {b.region_id}: {factionName(b.attacker_faction_id)} attacks {factionName(b.defender_faction_id)} (
            {b.battle_type})
          </li>
        ))}
      </ul>
      <p className="muted">
        Fight opens the battle board. Ending the phase settles any battle you have not fought, with the cheapest units
        lost first and no retreat.
      </p>
    </>
  );
}

function MobilizeBody({
  game,
  pending,
  selection,
  setSelection,
  legalTargets,
}: {
  game: GameSessionHandle;
  pending: PurchaseLine[];
  selection: Selection;
  setSelection(s: Selection): void;
  legalTargets: string[];
}) {
  const state = game.session.state;
  if (pending.length === 0) {
    return <p className="muted">Nothing to place.</p>;
  }
  return (
    <>
      <p className="muted">Pick a unit, then click a highlighted region to place one.</p>
      <ul className="pending">
        {pending.map((line) => {
          const active = selection?.kind === "place" && selection.unitTypeId === line.unit_type_id;
          return (
            <li key={line.unit_type_id}>
              <button
                type="button"
                className={active ? "active" : ""}
                onClick={() => setSelection(active ? null : { kind: "place", unitTypeId: line.unit_type_id })}
              >
                <UnitToken unit={line.unit_type_id} faction={state.current_faction_id} size={48} />
                <span className="unit-name">{unitName(line.unit_type_id, state.unit_types)}</span>
                <b className="stack-count mono">×{line.count}</b>
              </button>
            </li>
          );
        })}
      </ul>
      {selection?.kind === "place" && legalTargets.length === 0 && (
        <p className="warn">No legal placement region for this unit.</p>
      )}
      <p className="warn">Units still unplaced when you end this phase are lost.</p>
    </>
  );
}
