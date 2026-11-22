import { airMovement, carrierDecks, fuelForDisplayEntry, type DeckPlane, sortieCost } from "../../../engine/air/air_fuel";
import { normalizeUnitTypeAndFaction, RegionUnitDisplay } from "../../../engine/presentation/region_unit_display";
import { UnitToken } from "../../theme/tokens/UnitToken";
import type { Selection } from "../App";
import type { StackEntry } from "../geometry";
import { stackKey } from "../geometry";
import { factionName, unitName } from "../session/event_text";
import { incomingPlanes } from "../shipHold";
import { isActiveFaction } from "../tokenStyle";
import type { GameSessionHandle } from "../session/use_game_session";

interface Props {
  game: GameSessionHandle;
  regionId: string;
  selection: Selection;
  hoverRegionId: string;
  legalTargets: readonly string[];
  onSelectStack(regionId: string, entry: StackEntry): void;
}

interface CargoCard {
  key: string;
  unitType: string;
  factionId: string;
  count: number;
  kind: "plane" | "cargo" | "incoming";
  transportId: string;
}

function parkedCards(planes: readonly DeckPlane[]): CargoCard[] {
  const cards = new Map<string, CargoCard>();
  for (const plane of planes) {
    const key = `plane|${plane.factionId}|${plane.unitType}`;
    const card = cards.get(key);
    if (card) {
      card.count += plane.count;
    } else {
      cards.set(key, {
        key,
        unitType: plane.unitType,
        factionId: plane.factionId,
        count: plane.count,
        kind: "plane",
        transportId: "",
      });
    }
  }
  return [...cards.values()];
}

/** Cargo aboard the ships in this sea: parked planes, transport loads, and planes ordered onto a carrier. */
export function DeckManifest({ game, regionId, selection, hoverRegionId, legalTargets, onSelectStack }: Props) {
  const state = game.session.state;
  const region = state.regions[regionId];
  if (region == null || !region.isSeaRegion()) {
    return null;
  }
  const cards: CargoCard[] = parkedCards(carrierDecks(state, regionId).flatMap((deck) => deck.parked));
  for (const entry of state.getUnitsInRegion(regionId)) {
    const transportId = String(entry.instance_id ?? "");
    if (transportId === "" || state.transport_instances[transportId] == null) {
      continue;
    }
    const factionId = String(entry.faction_id ?? "");
    for (const line of state.transport_instances[transportId].cargo ?? []) {
      const unitType = String(line.unit_type_id ?? "");
      const count = Math.max(0, Math.trunc(Number(line.count ?? 0)));
      if (unitType === "" || count <= 0) {
        continue;
      }
      const key = `cargo|${transportId}|${unitType}`;
      const card = cards.find((item) => item.key === key);
      if (card) {
        card.count += count;
      } else {
        cards.push({ key, unitType, factionId, count, kind: "cargo", transportId });
      }
    }
  }
  for (const plane of incomingPlanes(state, regionId)) {
    cards.push({
      key: `incoming|${plane.factionId}|${plane.unitType}`,
      unitType: plane.unitType,
      factionId: plane.factionId,
      count: plane.count,
      kind: "incoming",
      transportId: "",
    });
  }
  if (cards.length === 0) {
    return null;
  }
  const display = RegionUnitDisplay.buildDisplayEntries(state.getUnitsInRegion(regionId));
  const phase = state.current_phase;

  return (
    <section className="panel deck-manifest" aria-label="Cargo">
      <h2>Cargo</h2>
      <ul className="deck-list">
        {cards.map((card) => {
          const shown = normalizeUnitTypeAndFaction(card.unitType, card.factionId);
          const stack =
            card.kind === "cargo"
              ? {
                  unit_type_id: card.unitType,
                  faction_id: card.factionId,
                  count: card.count,
                  cargoOf: card.transportId,
                }
              : display.find(
                  (item) => item.unit_type_id === shown.unit_type_id && item.faction_id === shown.faction_id && !item.instance_id,
                );
          const active = card.kind !== "incoming" && isActiveFaction(shown.faction_id, state.current_faction_id);
          const fuel =
            card.kind === "plane" && active
              ? fuelForDisplayEntry(state, regionId, shown.unit_type_id, shown.faction_id)
              : null;
          const movement = card.kind === "plane" ? airMovement(state, card.unitType) : 0;
          const selected =
            stack != null &&
            selection?.kind === "stack" &&
            selection.regionId === regionId &&
            selection.key === stackKey(stack);
          const round =
            card.kind === "plane" && selected && phase === "combat_move" && legalTargets.includes(hoverRegionId)
              ? sortieCost(state, state.current_faction_id, card.unitType, regionId, hoverRegionId)
              : null;
          const label = card.kind === "cargo" ? `${card.count} aboard` : card.kind === "incoming" ? `${card.count} incoming` : `${card.count} on deck`;
          const body = (
            <>
              <UnitToken unit={shown.unit_type_id} faction={shown.faction_id} size={40} />
              <span className="stack-label">
                <span className="unit-name">{unitName(card.unitType, state.unit_types)}</span>
                <span className="stack-faction">{factionName(card.factionId)}</span>
                <span className="stack-cargo">{label}</span>
                {fuel != null && movement > 0 && (
                  <span className="fuel-pips" aria-label={`${fuel} / ${movement}`}>
                    {Array.from({ length: movement }, (_, index) => (
                      <i key={index} className={index < fuel ? "fuel-pip full" : "fuel-pip"} />
                    ))}
                  </span>
                )}
                {round != null && <span className="deck-round">ROUND-TRIP REQUIRED: {round}</span>}
              </span>
              <b className="stack-count mono">×{card.count}</b>
            </>
          );
          return (
            <li key={card.key}>
              {active && stack ? (
                <button type="button" className={selected ? "active" : ""} onClick={() => onSelectStack(regionId, stack)}>
                  {body}
                </button>
              ) : (
                <div className="deck-static">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
