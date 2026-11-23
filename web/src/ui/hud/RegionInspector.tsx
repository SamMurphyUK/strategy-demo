import { type CSSProperties, type PointerEvent, type RefObject, useEffect, useRef, useState } from "react";
import { fuelRemaining } from "../../engine/air/air_fuel";
import { RegionUnitDisplay } from "../../engine/presentation/region_unit_display";
import { factionPalette } from "../theme/factionPalette";
import { UnitToken } from "../theme/tokens/UnitToken";
import type { StackEntry } from "../map/geometry";
import { stackKey } from "../map/geometry";
import { factionName, unitName } from "../map/session/event_text";
import type { GameSessionHandle } from "../map/session/use_game_session";
import { cargoStacks } from "../map/shipHold";
import { sortMedallions, territoryStatus } from "./medallionOrder";

interface MoveDragApi {
  start(spec: {
    regionId: string;
    entry: StackEntry;
    count: number;
    group?: { entry: StackEntry; count: number }[];
    clientX: number;
    clientY: number;
  }): void;
  move(clientX: number, clientY: number): void;
  end(clientX: number, clientY: number): void;
}

interface Props {
  game: GameSessionHandle;
  regionId: string;
  selectedKey: string;
  movableCount(regionId: string, entry: StackEntry): number;
  moveDrag: RefObject<MoveDragApi | null>;
  squadOn: boolean;
  onToggleSquad(entries: { entry: StackEntry; count: number }[] | null): void;
  onClose(): void;
}

const DRAG_PX = 6;
const SHIP = new Set(["transport", "carrier"]);

function movementPips(game: GameSessionHandle, regionId: string, entry: StackEntry, movable: number): string {
  const state = game.session.state;
  const printed = Math.max(0, Math.trunc(state.unit_types[entry.unit_type_id]?.movement ?? 0));
  if (state.unit_types[entry.unit_type_id]?.category === "air") {
    const left = fuelRemaining(state, entry.faction_id, regionId, entry.unit_type_id);
    return `${Math.max(0, left)}/${printed}`;
  }
  return `${movable > 0 ? printed : 0}/${printed}`;
}

function cargoOfShip(game: GameSessionHandle, entry: StackEntry): StackEntry[] {
  const id = entry.instance_id ?? "";
  if (id === "" || !SHIP.has(entry.unit_type_id)) {
    return [];
  }
  const state = game.session.state;
  const counts = new Map<string, number>();
  for (const line of state.transport_instances[id]?.cargo ?? []) {
    const unitType = String(line.unit_type_id ?? "");
    const count = Math.max(0, Math.trunc(Number(line.count ?? 0)));
    if (unitType === "" || count <= 0) {
      continue;
    }
    counts.set(unitType, (counts.get(unitType) ?? 0) + count);
  }
  return [...counts.entries()].map(([unitType, count]) => ({
    unit_type_id: unitType,
    faction_id: entry.faction_id,
    count,
    cargoOf: id,
  }));
}

export function RegionInspector({ game, regionId, selectedKey, movableCount, moveDrag, squadOn, onToggleSquad, onClose }: Props) {
  const state = game.session.state;
  const faction = state.current_faction_id;
  const phase = state.current_phase;
  const [shown, setShown] = useState(regionId);
  const [dragging, setDragging] = useState(false);
  const press = useRef<{ key: string; entry: StackEntry; count: number; x: number; y: number; dragging: boolean; group?: { entry: StackEntry; count: number }[] } | null>(null);

  useEffect(() => {
    if (regionId !== "") {
      setShown(regionId);
    }
  }, [regionId]);

  const region = shown === "" ? null : state.regions[shown];
  const open = regionId !== "" && region != null;
  const ground = region
    ? RegionUnitDisplay.buildDisplayEntries(state.getUnitsInRegion(shown)).map((entry) => ({
        unit_type_id: String(entry.unit_type_id ?? ""),
        faction_id: String(entry.faction_id ?? ""),
        count: Math.max(0, Math.trunc(Number(entry.count ?? 0))),
        instance_id: entry.instance_id ? String(entry.instance_id) : undefined,
      }))
    : [];
  const entries = region ? sortMedallions(state, faction, [...ground, ...cargoStacks(state, shown)], (entry) => movableCount(shown, entry) > 0) : [];
  const occupied = entries.length > 0;
  const status = region ? territoryStatus(state, faction, region.owner_faction_id, entries) : "FRIENDLY";
  const cover = region?.land_cover ? region.land_cover.toLowerCase() : region?.type === "sea" ? "sea" : "open";
  const squad = entries
    .filter((entry) => entry.faction_id === faction && movableCount(shown, entry) > 0 && (phase === "combat_move" || phase === "noncombat_move"))
    .map((entry) => ({ entry, count: movableCount(shown, entry) }));
  const squadTotal = squad.reduce((sum, item) => sum + item.count, 0);

  const begin = (event: PointerEvent<HTMLElement>, entry: StackEntry, count: number, group?: { entry: StackEntry; count: number }[]) => {
    if (event.button !== 0 || count <= 0) {
      return;
    }
    event.stopPropagation();
    press.current = { key: group ? "all" : stackKey(entry), entry, count, x: event.clientX, y: event.clientY, dragging: false, group };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const move = (event: PointerEvent<HTMLElement>, entry: StackEntry) => {
    const held = press.current;
    if (!held || held.key !== (held.group ? "all" : stackKey(entry))) {
      return;
    }
    if (!held.dragging && Math.hypot(event.clientX - held.x, event.clientY - held.y) >= DRAG_PX) {
      held.dragging = true;
      setDragging(true);
      moveDrag.current?.start({
        regionId: shown,
        entry: held.entry,
        count: held.count,
        group: held.group,
        clientX: event.clientX,
        clientY: event.clientY,
      });
    }
    if (held.dragging) {
      moveDrag.current?.move(event.clientX, event.clientY);
    }
  };

  const end = (event: PointerEvent<HTMLElement>, entry: StackEntry) => {
    const held = press.current;
    press.current = null;
    setDragging(false);
    if (!held || held.key !== (held.group ? "all" : stackKey(entry)) || !held.dragging) {
      return;
    }
    moveDrag.current?.end(event.clientX, event.clientY);
  };

  return (
    <div className={`hud-inspector-slot${occupied ? " is-full" : " is-pill"}`}>
      <section
        className={`hud-inspector${open ? " is-open" : ""}${dragging ? " is-passing" : ""}`}
        aria-label="Region inspector"
        aria-hidden={!open}
      >
        {region && (
          <div key={shown} className="hud-inspector-body">
            <button type="button" className="hud-close" aria-label="Close region" onClick={onClose}>
              ×
            </button>
            {squadTotal > 0 && (
              <button
                type="button"
                className={squadOn ? "hud-select-all active" : "hud-select-all"}
                aria-pressed={squadOn}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleSquad(squadOn ? null : squad);
                }}
              >
                Select all
              </button>
            )}
            <div className="hud-emblem" style={{ borderColor: factionPalette(region.owner_faction_id).ring }}>
              <b>{region.type === "sea" ? (region.name.match(/\d+/)?.[0] ?? region.name) : region.name}</b>
              <span>{status}</span>
              <span>
                {region.ipc_value} IO · {cover}
                {region.has_factory ? (region.major_factory ? " · Major complex" : " · Minor complex") : ""}
              </span>
              <span>{factionName(region.owner_faction_id)}</span>
            </div>
            {occupied && (
              <div className="hud-medallions">
                {entries.map((entry) => {
                  const key = stackKey(entry);
                  const movable = movableCount(shown, entry);
                  const owned = entry.faction_id === faction;
                  const canDrag = owned && movable > 0 && (phase === "combat_move" || phase === "noncombat_move");
                  const cargo = cargoOfShip(game, entry);
                  const ring = factionPalette(entry.faction_id).ring;
                  return (
                    <article
                      key={key}
                      className={`hud-medallion${canDrag ? " is-movable" : ""}${owned ? "" : " is-locked"}${selectedKey === key || (squadOn && canDrag) ? " is-selected" : ""}`}
                      style={{ "--rim": ring } as CSSProperties}
                      onPointerDown={(event) => canDrag && begin(event, entry, event.shiftKey ? movable : 1)}
                      onPointerMove={(event) => move(event, entry)}
                      onPointerUp={(event) => end(event, entry)}
                    >
                      <span className="hud-roundel" style={{ background: factionPalette(entry.faction_id).primary }} />
                      <UnitToken unit={entry.unit_type_id} faction={entry.faction_id} size={48} />
                      <span className="hud-unit-label">{unitName(entry.unit_type_id, state.unit_types)}</span>
                      <span className="hud-pips mono">{movementPips(game, shown, entry, movable)}</span>
                      <button
                        type="button"
                        className="hud-count"
                        aria-label={`Drag all ${entry.count}`}
                        onPointerDown={(event) => {
                          if (!canDrag) {
                            return;
                          }
                          begin(event, entry, movable);
                        }}
                        onPointerMove={(event) => move(event, entry)}
                        onPointerUp={(event) => end(event, entry)}
                      >
                        ×{entry.count}
                      </button>
                      {!owned && <span className="hud-lock" aria-hidden="true">Lock</span>}
                      {cargo.map((line) => (
                        <button
                          key={stackKey(line)}
                          type="button"
                          className="hud-cargo"
                          aria-label={`Drag ${unitName(line.unit_type_id, state.unit_types)}`}
                          onPointerDown={(event) => begin(event, line, event.shiftKey ? line.count : 1)}
                          onPointerMove={(event) => move(event, line)}
                          onPointerUp={(event) => end(event, line)}
                        >
                          <UnitToken unit={line.unit_type_id} faction={line.faction_id} size={22} />
                        </button>
                      ))}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
