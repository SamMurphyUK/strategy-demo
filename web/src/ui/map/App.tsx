import { useCallback, useEffect, useMemo, useState } from "react";
import { loadJson } from "../engine/content/res";
import { NEWMAP_PATH } from "../content/game_scene_session_builder";
import { RegionUnitDisplay } from "../engine/presentation/region_unit_display";
import { textureUrl } from "./assets";
import { buildMapGeometry, type HighlightMode, type StackEntry, stackKey } from "./map/geometry";
import { type CombatMarker, MapView } from "./map/MapView";
import { EventLog } from "./panels/EventLog";
import { PhasePanel } from "./panels/PhasePanel";
import { RegionPanel } from "./panels/RegionPanel";
import { TurnBar } from "./panels/TurnBar";
import { useGameSession } from "./session/use_game_session";

export type Selection =
  | { kind: "stack"; regionId: string; key: string; unitTypeId: string; instanceId: string; max: number; count: number }
  | { kind: "place"; unitTypeId: string }
  | null;

const MOVEMENT_PHASES = ["combat_move", "noncombat_move"];

export function App() {
  const game = useGameSession(12345);
  const { session, version } = game;
  const state = session.state;
  const faction = state.current_faction_id;
  const phase = state.current_phase;

  const geometry = useMemo(() => buildMapGeometry(loadJson(NEWMAP_PATH)), []);
  const baseMapUrl = useMemo(() => textureUrl(geometry.baseMap), [geometry]);

  const [selectedRegionId, setSelectedRegionId] = useState("");
  const [hoverRegionId, setHoverRegionId] = useState("");
  const [selection, setSelection] = useState<Selection>(null);

  // Any phase or faction change invalidates an in-progress move or placement.
  useEffect(() => {
    setSelection(null);
  }, [phase, faction, game.seed]);

  // `state` is mutated in place by the session; `version` is the dependency that changes.
  const owners = useMemo(() => {
    const out: Record<string, string> = {};
    for (const id of Object.keys(state.regions)) {
      out[id] = state.regions[id].owner_faction_id;
    }
    return out;
  }, [state, version]);

  const stacks = useMemo(() => {
    const out: Record<string, StackEntry[]> = {};
    for (const id of Object.keys(state.region_units)) {
      out[id] = RegionUnitDisplay.buildDisplayEntries(state.region_units[id]);
    }
    return out;
  }, [state, version]);

  const legalTargets = useMemo(() => {
    if (selection?.kind === "stack") {
      return session.getLegalMoveDestinations(selection.regionId, selection.unitTypeId, faction, selection.instanceId);
    }
    if (selection?.kind === "place") {
      return session.getLegalMobilizeRegions(faction, selection.unitTypeId);
    }
    return [];
  }, [selection, session, faction, version]);

  const highlight: HighlightMode = useMemo(() => {
    if (selection?.kind === "stack") {
      return { kind: "move", from: selection.regionId, legal: legalTargets, hover: hoverRegionId };
    }
    if (selection?.kind === "place") {
      return { kind: "mobilize", legal: legalTargets, hover: hoverRegionId };
    }
    return { kind: "none" };
  }, [selection, legalTargets, hoverRegionId]);

  const combatMarkers: CombatMarker[] = useMemo(() => {
    if (phase !== "combat_move" || faction === "") {
      return [];
    }
    return RegionUnitDisplay.regionsWithCombatPools(state, faction).map((regionId) => ({
      regionId,
      count: RegionUnitDisplay.combatPoolUnitCount(state, regionId, faction),
    }));
  }, [state, phase, faction, version]);

  const isUnmoved = useCallback(
    (regionId: string, entry: StackEntry) => {
      if (!MOVEMENT_PHASES.includes(phase) || entry.faction_id !== faction.toLowerCase()) {
        return false;
      }
      if (entry.instance_id) {
        return !state.hasInstanceMoved(entry.instance_id);
      }
      return state.movableStackCount(faction, regionId, entry.unit_type_id) > 0;
    },
    [state, phase, faction, version],
  );

  const pendingForFaction = state.pending_purchases[faction] ?? [];

  const onRegionClick = (regionId: string) => {
    if (selection?.kind === "stack" && legalTargets.includes(regionId)) {
      const unit: Record<string, unknown> = { unit_type_id: selection.unitTypeId, count: selection.count };
      if (selection.instanceId !== "") {
        unit.instance_id = selection.instanceId;
      }
      const result = game.send("move_units", {
        moves: [{ from_region_id: selection.regionId, to_region_id: regionId, units: [unit] }],
      });
      if (result.result_type === "ok") {
        setSelection(null);
        setSelectedRegionId(regionId);
      }
      return;
    }
    if (selection?.kind === "place" && legalTargets.includes(regionId)) {
      const result = game.send("place_units", {
        placements: [{ region_id: regionId, units: [{ unit_type_id: selection.unitTypeId, count: 1 }] }],
      });
      if (result.result_type === "ok") {
        const left = (session.state.pending_purchases[faction] ?? []).some(
          (line) => line.unit_type_id === selection.unitTypeId && line.count > 0,
        );
        if (!left) {
          setSelection(null);
        }
      }
      setSelectedRegionId(regionId);
      return;
    }
    if (selection?.kind === "stack") {
      setSelection(null);
    }
    setSelectedRegionId(regionId === selectedRegionId ? "" : regionId);
  };

  const selectStack = (regionId: string, entry: StackEntry) => {
    const key = stackKey(entry);
    if (selection?.kind === "stack" && selection.regionId === regionId && selection.key === key) {
      setSelection(null);
      return;
    }
    setSelectedRegionId(regionId);
    if (!MOVEMENT_PHASES.includes(phase) || entry.faction_id !== faction.toLowerCase()) {
      setSelection(null);
      return;
    }
    const max = entry.instance_id
      ? state.hasInstanceMoved(entry.instance_id)
        ? 0
        : 1
      : state.movableStackCount(faction, regionId, entry.unit_type_id);
    if (max <= 0) {
      setSelection(null);
      return;
    }
    setSelection({
      kind: "stack",
      regionId,
      key,
      unitTypeId: entry.unit_type_id,
      instanceId: entry.instance_id ?? "",
      max,
      count: max,
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelection(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <TurnBar game={game} />
      <div className="main">
        <MapView
          geometry={geometry}
          baseMapUrl={baseMapUrl}
          owners={owners}
          stacks={stacks}
          selectedRegionId={selectedRegionId}
          selectedStack={selection?.kind === "stack" ? { regionId: selection.regionId, key: selection.key } : null}
          highlight={highlight}
          combatMarkers={combatMarkers}
          isUnmoved={isUnmoved}
          onRegionClick={onRegionClick}
          onRegionHover={setHoverRegionId}
          onStackClick={(regionId, entry) => selectStack(regionId, entry)}
        />
        <aside className="sidebar">
          <PhasePanel
            game={game}
            selection={selection}
            setSelection={setSelection}
            legalTargets={legalTargets}
            pending={pendingForFaction}
          />
          <RegionPanel
            game={game}
            regionId={selectedRegionId}
            selection={selection}
            onSelectStack={selectStack}
          />
          <EventLog log={game.log} />
        </aside>
      </div>
    </div>
  );
}
