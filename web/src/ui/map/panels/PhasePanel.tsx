import { useEffect, useState } from "react";
import type { PurchaseLine } from "../../engine/model/types";
import type { Selection } from "../App";
import { unitArtUrl } from "../assets";
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

  return (
    <section className="panel phase-panel">
      <h2>
        {factionName(faction)}: {phaseName(phase)}
      </h2>

      {phase === "purchase" && <PurchaseBody game={game} pending={pending} />}

      {(phase === "combat_move" || phase === "noncombat_move") && (
        <MoveBody selection={selection} setSelection={setSelection} legalTargets={legalTargets} game={game} />
      )}

      {phase === "combat" && <CombatBody game={game} />}

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
        {legal.includes("end_phase") && (
          <button type="button" className="primary" onClick={() => game.send("end_phase")}>
            {phase === "combat" ? "Resolve battles and end phase" : "End phase"}
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
      <table className="catalog">
        <thead>
          <tr>
            <th>Unit</th>
            <th>Cost</th>
            <th>A/D/M</th>
            <th>Buy</th>
          </tr>
        </thead>
        <tbody>
          {Object.keys(costs).map((id) => {
            const ut = state.unit_types[id];
            const art = unitArtUrl(id, faction);
            return (
              <tr key={id}>
                <td className="unit-cell">
                  {art && <img src={art} alt="" width={22} height={22} />}
                  {unitName(id, state.unit_types)}
                </td>
                <td>{costs[id]}</td>
                <td>
                  {ut.attack}/{ut.defense}/{ut.movement}
                </td>
                <td className="stepper">
                  <button type="button" onClick={() => bump(id, -1)} disabled={!staged[id]}>
                    −
                  </button>
                  <span>{staged[id] ?? 0}</span>
                  <button type="button" onClick={() => bump(id, 1)}>
                    +
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className={total > ipc ? "warn" : ""}>
        Total {total} IPC of {ipc} available
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

function CombatBody({ game }: { game: GameSessionHandle }) {
  const { session } = game;
  const battles = session.getPendingBattles(session.state.current_faction_id);
  if (battles.length === 0) {
    return <p className="muted">No battles this turn.</p>;
  }
  return (
    <>
      <ul className="battles">
        {battles.map((b) => (
          <li key={b.region_id}>
            {b.region_id}: {factionName(b.attacker_faction_id)} attacks {factionName(b.defender_faction_id)} (
            {b.battle_type})
          </li>
        ))}
      </ul>
      <p className="muted">Ending the phase fights every battle to the finish. Results appear in the event log.</p>
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
          const art = unitArtUrl(line.unit_type_id, state.current_faction_id);
          return (
            <li key={line.unit_type_id}>
              <button
                type="button"
                className={active ? "active" : ""}
                onClick={() => setSelection(active ? null : { kind: "place", unitTypeId: line.unit_type_id })}
              >
                {art && <img src={art} alt="" width={22} height={22} />}
                {line.count} × {unitName(line.unit_type_id, state.unit_types)}
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
