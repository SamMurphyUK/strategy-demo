import { RegionUnitDisplay } from "../../../engine/presentation/region_unit_display";
import type { Selection } from "../App";
import { UnitToken } from "../../theme/tokens/UnitToken";
import { type StackEntry, stackKey } from "../geometry";
import { factionName, unitName } from "../session/event_text";
import type { GameSessionHandle } from "../session/use_game_session";

interface Props {
  game: GameSessionHandle;
  regionId: string;
  selection: Selection;
  onSelectStack(regionId: string, entry: StackEntry): void;
}

export function RegionPanel({ game, regionId, selection, onSelectStack }: Props) {
  const state = game.session.state;
  const region = state.regions[regionId];
  if (!region) {
    return (
      <section className="panel region-panel">
        <h2>Region</h2>
        <p className="muted">Click a region to inspect it.</p>
      </section>
    );
  }

  const entries = RegionUnitDisplay.buildDisplayEntries(state.getUnitsInRegion(regionId));
  const tags = [
    region.type === "sea" ? "Sea zone" : "Land",
    region.ipc_value > 0 ? `${region.ipc_value} IPC` : "",
    region.has_factory ? "Factory" : "",
    region.is_capital ? "Capital" : "",
  ].filter(Boolean);
  const neighbours = state.getAdjacentRegions(regionId);

  return (
    <section className="panel region-panel">
      <h2>{regionId}</h2>
      <p className="region-tags">
        {factionName(region.owner_faction_id)} · {tags.join(" · ")}
      </p>
      {entries.length === 0 ? (
        <p className="muted">No units.</p>
      ) : (
        <ul className="stack-list">
          {entries.map((entry) => {
            const key = stackKey(entry);
            const active = selection?.kind === "stack" && selection.regionId === regionId && selection.key === key;
            const cargo =
              entry.instance_id && RegionUnitDisplay.isContainerUnit(state, entry.unit_type_id)
                ? RegionUnitDisplay.cargoSummaryLines(state, entry.instance_id).join(", ")
                : "";
            return (
              <li key={key}>
                <button
                  type="button"
                  className={active ? "active" : ""}
                  onClick={() => onSelectStack(regionId, entry)}
                >
                  <UnitToken unit={entry.unit_type_id} faction={entry.faction_id} size={40} />
                  <span className="stack-label">
                    <span className="unit-name">{unitName(entry.unit_type_id, state.unit_types)}</span>
                    <span className="stack-faction">{factionName(entry.faction_id)}</span>
                    {cargo && <span className="stack-cargo">cargo: {cargo}</span>}
                  </span>
                  <b className="stack-count mono">×{entry.count}</b>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="muted">Borders: {neighbours.length > 0 ? neighbours.join(", ") : "none"}</p>
    </section>
  );
}
