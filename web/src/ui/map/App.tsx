import { useCallback, useEffect, useMemo, useState } from "react";
import { NEWMAP_PATH } from "../../content/game_scene_session_builder";
import { loadJson } from "../../engine/content/res";
import type { ActiveBattle } from "../../engine/model/battle";
import { RegionUnitDisplay } from "../../engine/presentation/region_unit_display";
import { factionIdFromDisplay } from "../../content/game_scene_session_builder";
import { BattleScreen } from "./BattleScreen";
import { EditorPanel } from "./editor/EditorPanel";
import { EditorToolbar } from "./editor/EditorToolbar";
import { useMapEditor } from "./editor/useMapEditor";
import { buildMapGeometry, type HighlightMode, type StackEntry, stackKey } from "./geometry";
import { projectMapJson } from "./map_space";
import { type CombatMarker, MapView } from "./MapView";
import { useMasterLand } from "./useMasterLand";
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

// Stable empties for editor mode, so the canvas does not see new objects every render.
const NO_STACKS: Record<string, StackEntry[]> = {};
const NO_HIGHLIGHT: HighlightMode = { kind: "none" };
const NO_MARKERS: CombatMarker[] = [];
const NEVER = () => false;

export function App() {
  const game = useGameSession(12345);
  const { session, version } = game;
  const state = session.state;
  const faction = state.current_faction_id;
  const phase = state.current_phase;

  // The map is drawn in the land SVG's coordinates; demomap01.json predates it and is projected on load.
  const worldMapJson = useMemo(() => projectMapJson(loadJson(NEWMAP_PATH)), []);
  const geometry = useMemo(() => buildMapGeometry(worldMapJson), [worldMapJson]);
  const { land, error: landError } = useMasterLand();
  const [editing, setEditing] = useState(false);
  const editor = useMapEditor(worldMapJson, land, editing);
  const editorOwners = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of editor.map.regions) {
      const owner = factionIdFromDisplay(r.starting_owner);
      out[r.id] = owner === "neutral" || owner === "independent" ? "" : owner;
    }
    return out;
  }, [editor.map]);

  const [selectedRegionId, setSelectedRegionId] = useState("");
  const [hoverRegionId, setHoverRegionId] = useState("");
  const [selection, setSelection] = useState<Selection>(null);
  // The engine's open battle, kept on screen after it finishes until the player leaves the board.
  const [battleOnScreen, setBattleOnScreen] = useState<ActiveBattle | null>(null);
  const activeBattle = state.active_battle;
  if (activeBattle && battleOnScreen?.region_id !== activeBattle.region_id) {
    setBattleOnScreen(activeBattle);
  }

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

  // The battle canvas and the map are never mounted together.
  if (battleOnScreen) {
    const regionId = battleOnScreen.region_id;
    return (
      <BattleScreen
        key={regionId}
        game={game}
        battle={battleOnScreen}
        regionName={state.regions[regionId]?.name || regionId}
        onExit={() => {
          setBattleOnScreen(null);
          setSelectedRegionId(regionId);
        }}
      />
    );
  }

  return (
    <div className="campaign">
      <TurnBar game={game} editing={editing} onToggleEditing={() => setEditing((e) => !e)} />
      <div className="main">
        <MapView
          geometry={editing ? editor.geometry : geometry}
          land={land}
          landError={landError}
          owners={editing ? editorOwners : owners}
          stacks={editing ? NO_STACKS : stacks}
          selectedRegionId={editing ? (editor.selected?.id ?? "") : selectedRegionId}
          selectedStack={!editing && selection?.kind === "stack" ? { regionId: selection.regionId, key: selection.key } : null}
          highlight={editing ? NO_HIGHLIGHT : highlight}
          combatMarkers={editing ? NO_MARKERS : combatMarkers}
          isUnmoved={editing ? NEVER : isUnmoved}
          onRegionClick={onRegionClick}
          onRegionHover={setHoverRegionId}
          onStackClick={(regionId, entry) => selectStack(regionId, entry)}
          editor={editing ? editor.binding : undefined}
        >
          {editing && <EditorToolbar editor={editor} />}
        </MapView>
        <aside className="sidebar">
          {editing ? (
            <EditorPanel editor={editor} />
          ) : (
            <>
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
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
