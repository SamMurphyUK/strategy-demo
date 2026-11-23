import { useCallback, useEffect, useRef, useState } from "react";
import { describeStranded, fuelRemaining, planesMustLandMessage, strandedPlanes } from "../../../engine/air/air_fuel";
import { endCombatMoveGate } from "../../../engine/movement/combat_move_gate";
import { mustPlaceMessage } from "../../../engine/placement/unplaced";
import type { Battle } from "../../../engine/combat/combat";
import type { PurchaseLine } from "../../../engine/model/types";
import type { Selection } from "../App";
import { UnitToken } from "../../theme/tokens/UnitToken";
import { playCampaignCue } from "../campaignAudio";
import { purchasePhaseAdvance, stagedUnits, stageStep, UNCONFIRMED_BASKET_MESSAGE } from "../purchaseBasket";
import { factoryBlockReason, factoryLabel, factoryPrice, factoryRoom, FACTORY_KINDS, isFactoryKind } from "../../../engine/placement/factoryRules";
import { buildCapacityOf, maxAffordable } from "../../../engine/placement/productionCap";
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
  /** False while the opponent owns the active faction. */
  commandsEnabled?: boolean;
}

export function PhasePanel({
  game,
  selection,
  setSelection,
  legalTargets,
  pending,
  onFight,
  onStrandedCargo,
  commandsEnabled = true,
}: Props) {
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
  const moveGate = phase === "combat_move" ? endCombatMoveGate(state) : { advance: true, regionId: "", warning: "", code: "" as const };

  return (
    <section className="panel phase-panel">
      <h2>
        {factionName(faction)}: {phaseName(phase)}
      </h2>
      {!commandsEnabled && (
        <p className="opponent-turn" role="status">
          OPPONENT TURN ({factionName(faction)})
        </p>
      )}

      {phase === "purchase" && (
        <PurchaseBody game={game} pending={pending} onStagedTotal={noteStaged} commandsEnabled={commandsEnabled} />
      )}

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
          Income this turn: <strong>{session.economy.calculateIncome(faction)} IO</strong> from owned land.
        </p>
      )}

      <div className="phase-actions">
        {legal.includes("start_battle") && battles.length > 0 && (
          <button type="button" className="primary" disabled={!commandsEnabled} onClick={() => onFight(battles[0].region_id)}>
            Fight next battle
          </button>
        )}
        {mustReturn !== "" && <p className="warn">{mustReturn}</p>}
        {moveGate.warning !== "" && <p className="warn">{moveGate.warning}</p>}
        {mustPlace !== "" && <p className="warn">{mustPlace}</p>}
        {doomed.length > 0 && (
          <p className="warn">{describeStranded(state, doomed)} will be lost when the phase ends.</p>
        )}
        {legal.includes("end_phase") && (
          <button
            type="button"
            className={battles.length > 0 || mustReturn !== "" || mustPlace !== "" ? "" : "primary"}
            disabled={mustReturn !== "" || mustPlace !== "" || !commandsEnabled}
            onClick={() => {
              if (!purchaseGate.advance) {
                setBasketWarning(true);
                return;
              }
              if (!moveGate.advance) {
                onStrandedCargo?.(moveGate.regionId);
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
          <button type="button" className="primary" disabled={!commandsEnabled} onClick={() => game.send("end_turn")}>
            Collect income and end turn
          </button>
        )}
      </div>
    </section>
  );
}

type ShopTab = "land" | "air" | "sea" | "industrial";

const SHOP_TABS: ShopTab[] = ["land", "air", "sea", "industrial"];
const SHOP_LABEL: Record<ShopTab, string> = {
  land: "Land",
  air: "Air",
  sea: "Sea",
  industrial: "Industry",
};

function shopTabOf(id: string, unit: { category?: string; special?: Record<string, unknown> } | undefined): ShopTab {
  if (isFactoryKind(id)) {
    return "industrial";
  }
  const category = String(unit?.category ?? "");
  if (category === "air") {
    return "air";
  }
  if (category === "sea") {
    return "sea";
  }
  if (category === "structure" || category === "industrial" || category === "building" || unit?.special?.is_facility === true) {
    return "industrial";
  }
  return "land";
}

function PurchaseBody({
  game,
  pending,
  onStagedTotal,
  commandsEnabled,
}: {
  game: GameSessionHandle;
  pending: PurchaseLine[];
  onStagedTotal(total: number): void;
  commandsEnabled: boolean;
}) {
  const { session } = game;
  const state = session.state;
  const faction = state.current_faction_id;
  const costs = session.getCostTable();
  for (const kind of FACTORY_KINDS) {
    costs[kind] = factoryPrice(state, kind);
  }
  if (state.rulesetConfig.facilitiesAndPatrols) {
    for (const [regionId, tokens] of Object.entries(state.repairTokens)) {
      if (tokens > 0 && state.regions[regionId]?.owner_faction_id === faction) {
        costs[`repair:${regionId}`] = 1;
      }
    }
  }
  const [staged, setStaged] = useState<Record<string, number>>({});
  const stagedRef = useRef(staged);

  useEffect(() => {
    stagedRef.current = {};
    setStaged({});
  }, [faction, game.seed]);

  const [tab, setTab] = useState<ShopTab>("land");
  const total = Object.entries(staged).reduce((sum, [id, n]) => sum + (costs[id] ?? 0) * n, 0);
  const ipc = state.getFactionIpc(faction);
  const bought = (pending ?? []).reduce(
    (sum, line) => sum + (isFactoryKind(line.unit_type_id) ? 0 : Math.max(0, Math.trunc(line.count))),
    0,
  );
  const cap = buildCapacityOf(state, faction);
  const unitStaged = Object.entries(staged).reduce(
    (sum, [id, count]) => sum + (isFactoryKind(id) || id.startsWith("repair:") ? 0 : Math.max(0, count)),
    0,
  );
  const queued = unitStaged + bought;
  const slots = Math.max(0, cap.maxUnits - bought);
  const slotsLeft = Math.max(0, cap.maxUnits - queued);
  useEffect(() => {
    onStagedTotal(total);
  }, [total, onStagedTotal]);
  const bump = (id: string, d: number) => {
    if (d > 0 && id.startsWith("repair:")) {
      const damage = Math.max(0, Math.trunc(state.repairTokens[id.slice("repair:".length)] ?? 0));
      if ((stagedRef.current[id] ?? 0) + 1 > damage) {
        return;
      }
    }
    if (d > 0 && isFactoryKind(id)) {
      const taken = { ...stagedRef.current };
      for (const line of pending ?? []) {
        if (isFactoryKind(line.unit_type_id)) {
          taken[line.unit_type_id] = (taken[line.unit_type_id] ?? 0) + line.count;
        }
      }
      if (factoryRoom(state, faction, id, taken) < 1) {
        return;
      }
    }
    const next = stageStep(stagedRef.current, id, d, costs, ipc, isFactoryKind(id) || id.startsWith("repair:") ? Number.POSITIVE_INFINITY : slots);
    if (next === stagedRef.current) {
      return;
    }
    stagedRef.current = next;
    if (d > 0) {
      playCampaignCue("pickup");
    }
    setStaged(next);
  };

  const confirm = () => {
    const purchases = Object.entries(staged)
      .filter(([id, n]) => n > 0 && !id.startsWith("repair:"))
      .map(([unit_type_id, count]) => ({ unit_type_id, count }));
    const repairs = Object.entries(staged)
      .filter(([id, n]) => id.startsWith("repair:") && n > 0)
      .map(([id, tokens]) => ({ region_id: id.slice("repair:".length), tokens }));
    if ((purchases.length === 0 && repairs.length === 0) || total > ipc) {
      return;
    }
    const result = game.send("purchase_units", { purchases, ...(repairs.length > 0 ? { repairs } : {}) });
    if (result.result_type === "ok") {
      setStaged({});
      playCampaignCue("snap");
    }
  };

  return (
    <>
      <p className={slotsLeft === 1 ? "shop-readout is-tight" : "shop-readout"}>
        Treasury <b className="mono">{ipc}</b> IO
        <span>
          Build slots <b className="mono">{queued}/{cap.maxUnits}</b>
        </span>
      </p>
      <div className="shop-tabs" role="tablist" aria-label="Purchase categories">
        {SHOP_TABS.map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {SHOP_LABEL[id]}
          </button>
        ))}
      </div>
      <ul className="catalog">
        {(tab === "industrial"
          ? [...FACTORY_KINDS, ...Object.keys(costs).filter((id) => id.startsWith("repair:"))]
          : Object.keys(costs).filter((id) => !isFactoryKind(id) && !id.startsWith("repair:") && shopTabOf(id, state.unit_types[id]) === tab)
        ).map((id) => {
            const ut = state.unit_types[id];
            const count = staged[id] ?? 0;
            const taken = { ...staged };
            for (const line of pending ?? []) {
              if (isFactoryKind(line.unit_type_id)) {
                taken[line.unit_type_id] = (taken[line.unit_type_id] ?? 0) + line.count;
              }
            }
            const repairId = id.startsWith("repair:") ? id.slice("repair:".length) : "";
            const blocked = isFactoryKind(id) ? factoryBlockReason(state, faction, id) : null;
            const room = repairId !== ""
              ? Math.max(0, Math.trunc(state.repairTokens[repairId] ?? 0) - count)
              : isFactoryKind(id)
                ? factoryRoom(state, faction, id, taken)
                : slots - stagedUnits(Object.fromEntries(Object.entries(staged).filter(([key]) => !isFactoryKind(key) && !key.startsWith("repair:"))));
            const max = blocked ? 0 : count + maxAffordable(costs[id] ?? 0, ipc - total, Math.max(0, room));
            return (
              <li key={id} className={`${count > 0 ? "unit-card staged" : "unit-card"}${blocked ? " is-blocked" : ""}`} title={blocked ?? undefined}>
                <UnitToken unit={id} faction={faction} size={48} />
                <div className="unit-card-info">
                  <span className="unit-name">
                    {repairId !== ""
                      ? `Repair ${state.regions[repairId]?.name || repairId}`
                      : isFactoryKind(id)
                        ? factoryLabel(id)
                        : unitName(id, state.unit_types)}
                  </span>
                  <span className="unit-stats mono">
                    {repairId !== "" || isFactoryKind(id)
                      ? `${costs[id]} IO`
                      : `${costs[id]} IO · ${ut.attack}/${ut.defense}/${ut.movement}`}
                  </span>
                  <span className="unit-max mono">max {max}</span>
                </div>
                <div className="stepper">
                  <button type="button" onClick={() => bump(id, -1)} disabled={count === 0 || blocked != null} aria-label="Remove one">
                    −
                  </button>
                  <span className="mono">{count}</span>
                  <button
                    type="button"
                    onClick={() => bump(id, 1)}
                    disabled={blocked != null || !commandsEnabled || count >= max}
                    aria-label="Add one"
                  >
                    +
                  </button>
                </div>
              </li>
            );
          })}
      </ul>
      {tab !== "industrial" && Object.keys(costs).every((id) => shopTabOf(id, state.unit_types[id]) !== tab) && (
        <p className="muted">Nothing in this list.</p>
      )}
      <p className={total > ipc ? "warn" : "budget"}>
        Total <b className="mono">{total}</b> IO of <b className="mono">{ipc}</b> available
      </p>
      <div className="row">
        <button type="button" onClick={confirm} disabled={!commandsEnabled || total === 0 || total > ipc}>
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
