import { useCallback, useEffect, useState } from "react";
import { describeStranded, fuelRemaining, planesMustLandMessage, strandedPlanes } from "../../../engine/air/air_fuel";
import { combatCargoCommit, strandedCargoGate } from "../../../engine/transport/cargo_rules";
import { mustPlaceMessage } from "../../../engine/placement/unplaced";
import type { Battle } from "../../../engine/combat/combat";
import type { PurchaseLine } from "../../../engine/model/types";
import type { Selection } from "../App";
import { UnitToken } from "../../theme/tokens/UnitToken";
import { playCampaignCue } from "../campaignAudio";
import { canStageAnother, purchasePhaseAdvance, UNCONFIRMED_BASKET_MESSAGE } from "../purchaseBasket";
import { factionName, phaseName, unitName } from "../session/event_text";
import type { GameSessionHandle } from "../session/use_game_session";

interface Props {
  game: GameSessionHandle;
  selection: Selection;
  setSelection(s: Selection): void;
  legalTargets: string[];
  pending: PurchaseLine[];
  /** Zoom to the territory, then open the attack card, then the battle. */
  onFight(regionId: string): void;
  /** Combat-move cargo still aboard: pan the camera to that sea zone. */
  onStrandedCargo?(seaZoneId: string): void;
}

export function PhasePanel({ game, selection, setSelection, legalTargets, pending, onFight, onStrandedCargo }: Props) {
  const { session } = game;
  const state = session.state;
  const faction = state.current_faction_id;
  const phase = state.current_phase;
  const legal = session.getLegalCommands(faction);
  const battles = phase === "combat" ? session.getPendingBattles(faction) : [];
  const stranded = phase === "noncombat_move" ? strandedPlanes(state, faction) : [];
  const mustReturn = phase === "noncombat_move" ? planesMustLandMessage(state, faction) : "";
  const mustPlace = phase === "mobilize" ? mustPlaceMessage(state, faction) : "";
  const doomed = stranded.filter((plane) => !plane.canReturn);
  const [stagedIpc, setStagedIpc] = useState(0);
  const [basketWarning, setBasketWarning] = useState(false);
  const noteStaged = useCallback((total: number) => {
    setStagedIpc((prev) => (prev === total ? prev : total));
  }, []);
  const purchaseGate = purchasePhaseAdvance(phase === "purchase" ? stagedIpc : 0);
  const cargoGate = phase === "combat_move" ? strandedCargoGate(state) : { advance: true, seaZoneId: "", warning: "" };

  return (
    <section className="panel phase-panel">
      <h2>
        {factionName(faction)}: {phaseName(phase)}
      </h2>

      {phase === "purchase" && <PurchaseBody game={game} pending={pending} onStagedTotal={noteStaged} />}

      {(phase === "combat_move" || phase === "noncombat_move") && (
        <MoveBody selection={selection} setSelection={setSelection} legalTargets={legalTargets} game={game} />
      )}

      {phase === "combat" && <CombatBody battles={battles} onFight={onFight} />}

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
          <button type="button" className="primary" onClick={() => onFight(battles[0].region_id)}>
            Fight next battle
          </button>
        )}
        {mustReturn !== "" && <p className="warn">{mustReturn}</p>}
        {cargoGate.warning !== "" && <p className="warn">{cargoGate.warning}</p>}
        {mustPlace !== "" && <p className="warn">{mustPlace}</p>}
        {doomed.length > 0 && (
          <p className="warn">{describeStranded(state, doomed)} will be lost when the phase ends.</p>
        )}
        {legal.includes("end_phase") && (
          <button
            type="button"
            className={battles.length > 0 || mustReturn !== "" || mustPlace !== "" ? "" : "primary"}
            disabled={mustReturn !== "" || mustPlace !== ""}
            onClick={() => {
              if (!purchaseGate.advance) {
                setBasketWarning(true);
                return;
              }
              const cargo = combatCargoCommit(state, onStrandedCargo);
              if (!cargo.advance) {
                return;
              }
              setBasketWarning(false);
              game.send("end_phase");
            }}
          >
            {mustReturn !== ""
              ? "Fly planes back first"
              : mustPlace !== ""
                ? "Place purchased units first"
                : battles.length > 0
                  ? "Auto-resolve the rest and end phase"
                  : "End phase"}
          </button>
        )}
        {basketWarning && purchaseGate.warning && (
          <div className="basket-block" role="dialog" aria-label="Unconfirmed purchase">
            <p>{UNCONFIRMED_BASKET_MESSAGE}</p>
            <button type="button" onClick={() => setBasketWarning(false)}>
              Back to shop
            </button>
          </div>
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

function PurchaseBody({
  game,
  pending,
  onStagedTotal,
}: {
  game: GameSessionHandle;
  pending: PurchaseLine[];
  onStagedTotal(total: number): void;
}) {
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
  useEffect(() => {
    onStagedTotal(total);
  }, [total, onStagedTotal]);
  const bump = (id: string, d: number) => {
    const cost = costs[id] ?? 0;
    if (d > 0 && !canStageAnother(cost, ipc, total)) return;
    if (d > 0) playCampaignCue("pickup");
    setStaged((s) => ({ ...s, [id]: Math.max(0, (s[id] ?? 0) + d) }));
  };

  const confirm = () => {
    const purchases = Object.entries(staged)
      .filter(([, n]) => n > 0)
      .map(([unit_type_id, count]) => ({ unit_type_id, count }));
    if (purchases.length === 0 || total > ipc) {
      return;
    }
    const result = game.send("purchase_units", { purchases });
    if (result.result_type === "ok") {
      setStaged({});
      playCampaignCue("snap");
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
                <button
                  type="button"
                  onClick={() => bump(id, 1)}
                  disabled={!canStageAnother(costs[id] ?? 0, ipc, total)}
                  aria-label="Add one"
                >
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
        <button type="button" onClick={confirm} disabled={total === 0 || total > ipc}>
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
      {state.unit_types[selection.unitTypeId]?.category === "air" && (
        <p>
          Fuel{" "}
          <b className="mono">
            {fuelRemaining(state, state.current_faction_id, selection.regionId, selection.unitTypeId)}
          </b>
        </p>
      )}
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
