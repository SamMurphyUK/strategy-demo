import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fuelForDisplayEntry } from "../../../engine/air/air_fuel";
import { transportLoadedLabel } from "../../../engine/transport/cargo_rules";
import { RegionUnitDisplay } from "../../../engine/presentation/region_unit_display";
import type { Selection } from "../App";
import { UnitToken } from "../../theme/tokens/UnitToken";
import { type StackEntry, stackKey } from "../geometry";
import { factionName, unitName } from "../session/event_text";
import type { GameSessionHandle } from "../session/use_game_session";
import { orderStacks } from "../unitStacks";

interface Props {
  game: GameSessionHandle;
  regionId: string;
  selection: Selection;
  /** Bumped when a capped fan asks the inspector to take focus. */
  focusNonce: number;
  onSelectStack(regionId: string, entry: StackEntry): void;
  /** A row has started to drag: select that stack so its legal destinations light up. */
  onDragStart(entry: StackEntry): void;
  /** The drag ended at this client point. The map decides which region is underneath. */
  onDragEnd(entry: StackEntry, clientX: number, clientY: number): void;
}

/** The pointer has to travel this far from a row before it counts as dragging the unit out. */
const DRAG_START_PX = 5;

export function RegionPanel({ game, regionId, selection, focusNonce, onSelectStack, onDragStart, onDragEnd }: Props) {
  const state = game.session.state;
  const region = state.regions[regionId];
  const root = useRef<HTMLElement>(null);
  const press = useRef<{ key: string; startX: number; startY: number; dragging: boolean } | null>(null);
  const [drag, setDrag] = useState<{ key: string; entry: StackEntry; x: number; y: number } | null>(null);

  useEffect(() => {
    if (focusNonce > 0 && region) {
      root.current?.scrollIntoView({ block: "nearest" });
      root.current?.focus();
    }
  }, [focusNonce, regionId]);

  if (!region) {
    return (
      <section className="panel region-panel" id="region-inspector">
        <h2>Region</h2>
        <p className="muted">Click a region to inspect it.</p>
      </section>
    );
  }

  const entries = orderStacks(RegionUnitDisplay.buildDisplayEntries(state.getUnitsInRegion(regionId)), region.type === "sea");
  const tags = [
    region.type === "sea" ? "Sea zone" : "Land",
    region.ipc_value > 0 ? `${region.ipc_value} IPC` : "",
    region.has_factory ? "Factory" : "",
    region.is_capital ? "Capital" : "",
  ].filter(Boolean);
  const neighbours = state.getAdjacentRegions(regionId);

  return (
    <section className="panel region-panel" id="region-inspector" ref={root} tabIndex={-1}>
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
                ? transportLoadedLabel(state, entry.instance_id)
                : "";
            const fuel = fuelForDisplayEntry(state, regionId, entry.unit_type_id, entry.faction_id);
            return (
              <li key={key}>
                <button
                  type="button"
                  className={active ? "active" : ""}
                  title="Click to select. Drag onto a region to order it there."
                  onPointerDown={(e) => {
                    if (e.button !== 0) {
                      return;
                    }
                    press.current = { key, startX: e.clientX, startY: e.clientY, dragging: false };
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    const p = press.current;
                    if (!p || p.key !== key) {
                      return;
                    }
                    if (!p.dragging && Math.hypot(e.clientX - p.startX, e.clientY - p.startY) >= DRAG_START_PX) {
                      p.dragging = true;
                      onDragStart(entry);
                    }
                    if (p.dragging) {
                      setDrag({ key, entry, x: e.clientX, y: e.clientY });
                    }
                  }}
                  onPointerUp={(e) => {
                    const p = press.current;
                    press.current = null;
                    setDrag(null);
                    if (!p || p.key !== key) {
                      return;
                    }
                    if (p.dragging) {
                      onDragEnd(entry, e.clientX, e.clientY);
                    } else {
                      onSelectStack(regionId, entry);
                    }
                  }}
                  onPointerCancel={() => {
                    press.current = null;
                    setDrag(null);
                  }}
                >
                  <UnitToken unit={entry.unit_type_id} faction={entry.faction_id} size={40} />
                  <span className="stack-label">
                    <span className="unit-name">{unitName(entry.unit_type_id, state.unit_types)}</span>
                    <span className="stack-faction">{factionName(entry.faction_id)}</span>
                    {fuel != null && <span className="stack-fuel mono">fuel {fuel}</span>}
                    {cargo && <span className="stack-cargo">{cargo}</span>}
                  </span>
                  <b className="stack-count mono">×{entry.count}</b>
                </button>
                {drag?.key === key &&
                  createPortal(
                    <div className="unit-drag-ghost" style={{ left: drag.x, top: drag.y }}>
                      <UnitToken unit={entry.unit_type_id} faction={entry.faction_id} size={36} />
                    </div>,
                    document.body,
                  )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="muted">Borders: {neighbours.length > 0 ? neighbours.join(", ") : "none"}</p>
    </section>
  );
}
