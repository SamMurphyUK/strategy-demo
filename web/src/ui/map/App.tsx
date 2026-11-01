import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NEWMAP_PATH } from "../../content/game_scene_session_builder";
import { fuelForDisplayEntry, offeredMoveDestinations } from "../../engine/air/air_fuel";
import { loadJson } from "../../engine/content/res";
import type { ActiveBattle } from "../../engine/model/battle";
import { RegionUnitDisplay } from "../../engine/presentation/region_unit_display";
import { factionIdFromDisplay } from "../../content/game_scene_session_builder";
import { BattleScreen } from "./BattleScreen";
import { moveCue, playCampaignCue } from "./campaignAudio";
import { armCampaignMusic, setCampaignBed } from "./campaignMusic";
import { CombatDarken, CombatIntro } from "./CombatIntro";
import {
  COMBAT_PAN_MS,
  COMBAT_ZOOM_MS,
  combatGoal,
  type MapCamera,
} from "./combatCamera";
import { EditorPanel } from "./editor/EditorPanel";
import { EditorToolbar } from "./editor/EditorToolbar";
import { startingStacks } from "./editor/editorModel";
import { useMapEditor } from "./editor/useMapEditor";
import { buildMapGeometry, type HighlightMode, type StackEntry, stackKey } from "./geometry";
import { projectMapJson } from "./map_space";
import { type CombatMarker, MapView } from "./MapView";
import { useMasterLand } from "./useMasterLand";
import { EventLog } from "./panels/EventLog";
import { PendingOrders } from "./panels/PendingOrders";
import { PhasePanel } from "./panels/PhasePanel";
import { RegionPanel } from "./panels/RegionPanel";
import { TurnBar } from "./panels/TurnBar";
import { unitName } from "./session/event_text";
import { isActiveFaction } from "./tokenStyle";
import { moveUnitsPayload } from "./stackMove";
import { useGameSession } from "./session/use_game_session";

export type Selection =
  | { kind: "stack"; regionId: string; key: string; unitTypeId: string; instanceId: string; max: number; count: number }
  | { kind: "place"; unitTypeId: string }
  | null;

interface ApproachPlan {
  regionId: string;
  attackerId: string;
  defenderId: string;
  regionName: string;
  stage: "move" | "darken" | "briefing";
}

const MOVEMENT_PHASES = ["combat_move", "noncombat_move"];

// Stable empties for editor mode, so the canvas does not see new objects every render.
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
  // A saved version replaces the board for play. The editor's "Reset to demo map" stays on the file.
  const demoMapJson = useMemo(() => projectMapJson(loadJson(NEWMAP_PATH)), []);
  const playMapJson = game.map ?? demoMapJson;
  const geometry = useMemo(() => buildMapGeometry(playMapJson), [playMapJson]);
  const { land, error: landError } = useMasterLand();
  const [editing, setEditing] = useState(false);
  const editor = useMapEditor(demoMapJson, land, editing);
  const editorStacks = useMemo(() => startingStacks(editor.map), [editor.map]);
  const editorOwners = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of editor.map.regions) {
      const owner = factionIdFromDisplay(r.starting_owner);
      out[r.id] = owner === "neutral" || owner === "independent" ? "" : owner;
    }
    return out;
  }, [editor.map]);

  const [selectedRegionId, setSelectedRegionId] = useState("");
  /** Bumped when a capped fan opens the region inspector, so the panel can take focus. */
  const [inspectorFocus, setInspectorFocus] = useState(0);
  const resolveDrop = useRef<(clientX: number, clientY: number) => string>(() => "");
  const registerDropResolver = useCallback((fn: (clientX: number, clientY: number) => string) => {
    resolveDrop.current = fn;
  }, []);
  const [hoverRegionId, setHoverRegionId] = useState("");
  const [selection, setSelection] = useState<Selection>(null);
  // The engine's open battle, kept on screen after it finishes until the player leaves the board.
  const [battleOnScreen, setBattleOnScreen] = useState<ActiveBattle | null>(null);
  const activeBattle = state.active_battle;
  if (activeBattle && battleOnScreen?.region_id !== activeBattle.region_id) {
    setBattleOnScreen(activeBattle);
  }
  // The map stays mounted under the battle so the zoom from the first fight is still there for the next.
  const [approach, setApproach] = useState<ApproachPlan | null>(null);
  const approachRef = useRef<ApproachPlan | null>(null);
  approachRef.current = approach;
  const cameraRef = useRef<MapCamera | null>(null);
  const bindCamera = useCallback((camera: MapCamera | null) => {
    cameraRef.current = camera;
  }, []);
  const openedCombat = useRef(false);
  const approachTicket = useRef(0);

  // Any phase or faction change invalidates an in-progress move or placement.
  useEffect(() => {
    setSelection(null);
  }, [phase, faction, game.seed]);

  // Strategy march on the map. The combat phase fades across to the battle march.
  useEffect(() => {
    setCampaignBed(editing ? "off" : phase === "combat" ? "battle" : "map");
  }, [editing, phase]);

  useEffect(() => {
    const arm = () => armCampaignMusic();
    window.addEventListener("pointerdown", arm);
    window.addEventListener("keydown", arm);
    return () => {
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
  }, []);

  // The first battle of a combat phase zooms in. Later battles pan at that zoom.
  useEffect(() => {
    if (phase !== "combat") {
      openedCombat.current = false;
      approachTicket.current += 1;
      approachRef.current = null;
      setApproach(null);
    }
  }, [phase, faction]);

  // A new board has different regions, so a selection from the previous map cannot carry over.
  useEffect(() => {
    setSelectedRegionId("");
    setHoverRegionId("");
    setSelection(null);
    setBattleOnScreen(null);
    approachTicket.current += 1;
    approachRef.current = null;
    setApproach(null);
    openedCombat.current = false;
  }, [game.mapId]);

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

  const destinationsFor = (regionId: string, unitTypeId: string, instanceId: string) =>
    offeredMoveDestinations(
      state,
      phase,
      faction,
      regionId,
      unitTypeId,
      session.getLegalMoveDestinations(regionId, unitTypeId, faction, instanceId),
    );

  const legalTargets = useMemo(() => {
    if (selection?.kind === "stack") {
      return destinationsFor(selection.regionId, selection.unitTypeId, selection.instanceId);
    }
    if (selection?.kind === "place") {
      return session.getLegalMobilizeRegions(faction, selection.unitTypeId);
    }
    return [];
  }, [selection, session, faction, phase, version]);

  const highlight: HighlightMode = useMemo(() => {
    if (selection?.kind === "stack") {
      return {
        kind: "move",
        from: selection.regionId,
        legal: legalTargets,
        hover: hoverRegionId,
        tone: phase === "noncombat_move" ? "move" : "attack",
      };
    }
    if (selection?.kind === "place") {
      return { kind: "mobilize", legal: legalTargets, hover: hoverRegionId };
    }
    return { kind: "none" };
  }, [selection, legalTargets, hoverRegionId, phase]);

  const combatMarkers: CombatMarker[] = useMemo(() => {
    if (phase !== "combat_move" || faction === "") {
      return [];
    }
    return RegionUnitDisplay.regionsWithCombatPools(state, faction).map((regionId) => ({
      regionId,
      count: RegionUnitDisplay.combatPoolUnitCount(state, regionId, faction),
    }));
  }, [state, phase, faction, version]);

  const battleIcons = useMemo(() => {
    if (phase !== "combat" || faction === "") {
      return [];
    }
    return session.getPendingBattles(faction).map((battle) => ({
      regionId: battle.region_id,
      count: RegionUnitDisplay.combatPoolUnitCount(state, battle.region_id, faction),
    }));
  }, [session, state, phase, faction, version]);

  const isUnmoved = useCallback(
    (regionId: string, entry: StackEntry) => {
      if (!MOVEMENT_PHASES.includes(phase) || !isActiveFaction(entry.faction_id, faction)) {
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
        playCampaignCue(moveCue(String(state.unit_types[selection.unitTypeId]?.category ?? ""), phase));
      }
      return;
    }
    if (selection?.kind === "place" && legalTargets.includes(regionId)) {
      const result = game.send("place_units", {
        placements: [{ region_id: regionId, units: [{ unit_type_id: selection.unitTypeId, count: 1 }] }],
      });
      if (result.result_type === "ok") {
        playCampaignCue("mobilize");
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

  /** How many of this stack the current faction can still move this phase. */
  const movableCount = (regionId: string, entry: StackEntry): number => {
    if (!MOVEMENT_PHASES.includes(phase) || !isActiveFaction(entry.faction_id, faction)) {
      return 0;
    }
    return entry.instance_id
      ? state.hasInstanceMoved(entry.instance_id)
        ? 0
        : 1
      : state.movableStackCount(faction, regionId, entry.unit_type_id);
  };

  // Which of land, air or sea each unit type is, for grouping stacks on the map.
  const unitCategories = useMemo(() => {
    const out: Record<string, string> = {};
    for (const id of Object.keys(state.unit_types)) {
      out[id] = String(state.unit_types[id].category);
    }
    return out;
  }, [state]);

  /** A stack picked in the region inspector (the start of a drag): selected, never toggled off. */
  const pickStack = (regionId: string, entry: StackEntry) => {
    const max = movableCount(regionId, entry);
    setSelectedRegionId(regionId);
    setSelection(
      max <= 0
        ? null
        : { kind: "stack", regionId, key: stackKey(entry), unitTypeId: entry.unit_type_id, instanceId: entry.instance_id ?? "", max, count: max },
    );
  };

  /** Move `count` of a stack. The map drag, its split popover, and an inspector drop all come through here. */
  const commitMove = (regionId: string, entry: StackEntry, target: string, count: number) => {
    const max = movableCount(regionId, entry);
    if (max <= 0) {
      setSelection(null);
      return;
    }
    const legal = destinationsFor(regionId, entry.unit_type_id, entry.instance_id ?? "");
    if (!legal.includes(target)) {
      setSelection(null);
      return;
    }
    const result = game.send(
      "move_units",
      moveUnitsPayload(regionId, entry, target, Math.min(max, Math.max(1, count))),
    );
    if (result.result_type === "ok") {
      setSelection(null);
      setSelectedRegionId(target);
      playCampaignCue(moveCue(String(state.unit_types[entry.unit_type_id]?.category ?? ""), phase));
    }
  };

  /** A stack dragged out of the inspector and dropped on `target`: the whole movable stack. */
  const dropStack = (regionId: string, entry: StackEntry, target: string) => {
    commitMove(regionId, entry, target, movableCount(regionId, entry));
  };

  const armDrag = (regionId: string, entry: StackEntry, count: number) => {
    const max = movableCount(regionId, entry);
    if (max > 0) playCampaignCue("pickup");
    setSelectedRegionId(regionId);
    setSelection(
      max <= 0
        ? null
        : {
            kind: "stack",
            regionId,
            key: stackKey(entry),
            unitTypeId: entry.unit_type_id,
            instanceId: entry.instance_id ?? "",
            max,
            count: Math.min(max, Math.max(1, count)),
          },
    );
  };

  const selectStack = (regionId: string, entry: StackEntry) => {
    const key = stackKey(entry);
    if (selection?.kind === "stack" && selection.regionId === regionId && selection.key === key) {
      setSelection(null);
      return;
    }
    setSelectedRegionId(regionId);
    const max = movableCount(regionId, entry);
    if (max <= 0) {
      setSelection(null);
      return;
    }
    playCampaignCue("pickup");
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

  const approachBattle = (regionId: string) => {
    if (approachRef.current || battleOnScreen) return;
    const battle = session.getPendingBattles(faction).find((item) => item.region_id === regionId);
    if (!battle) return;
    const plan: ApproachPlan = {
      regionId,
      attackerId: battle.attacker_faction_id || faction,
      defenderId: battle.defender_faction_id,
      regionName: state.regions[regionId]?.name || regionId,
      stage: "move",
    };
    const ticket = ++approachTicket.current;
    approachRef.current = plan;
    setApproach(plan);
    void (async () => {
      const camera = cameraRef.current;
      const shape = geometry.regions.find((region) => region.id === regionId);
      if (camera && shape) {
        const snap = camera.snapshot();
        if (snap.width > 1 && snap.height > 1 && snap.fitK > 0) {
          const mode = openedCombat.current ? "pan" : "zoom";
          const goal = combatGoal(snap.view, shape.bounds, snap.width, snap.height, snap.fitK, mode, shape.anchor);
          await camera.moveTo(goal, mode === "pan" ? COMBAT_PAN_MS : COMBAT_ZOOM_MS);
          if (ticket !== approachTicket.current) return;
          openedCombat.current = true;
        }
      }
      if (ticket !== approachTicket.current) return;
      const dark: ApproachPlan = { ...plan, stage: "darken" };
      approachRef.current = dark;
      setApproach(dark);
    })();
  };

  const showBriefing = () => {
    if (approachRef.current?.stage !== "darken") return;
    const next = { ...approachRef.current, stage: "briefing" as const };
    approachRef.current = next;
    setApproach(next);
    playCampaignCue("assault");
  };

  const beginBattle = () => {
    const plan = approachRef.current;
    if (!plan) return;
    approachRef.current = null;
    setApproach(null);
    const result = game.send("start_battle", { region_id: plan.regionId });
    if (result.result_type === "ok" && session.state.active_battle) {
      setBattleOnScreen(session.state.active_battle);
    }
  };

  const covered = approach !== null || battleOnScreen !== null;

  return (
    <>
    <div className="campaign" inert={covered ? true : undefined}>
      <TurnBar
        game={game}
        editing={editing}
        versions={editor.versions}
        onToggleEditing={() => setEditing((e) => !e)}
      />
      <div className="main">
        <MapView
          geometry={editing ? editor.geometry : geometry}
          land={land}
          landError={landError}
          owners={editing ? editorOwners : owners}
          stacks={editing ? editorStacks : stacks}
          selectedRegionId={editing ? (editor.selected?.id ?? "") : selectedRegionId}
          selectedStack={!editing && selection?.kind === "stack" ? { regionId: selection.regionId, key: selection.key } : null}
          highlight={editing ? NO_HIGHLIGHT : highlight}
          combatMarkers={editing ? NO_MARKERS : combatMarkers}
          battleIcons={editing ? undefined : battleIcons}
          isUnmoved={editing ? NEVER : isUnmoved}
          onRegionClick={onRegionClick}
          onRegionHover={setHoverRegionId}
          onStackClick={(regionId, entry) => selectStack(regionId, entry)}
          onOpenInspector={(regionId) => {
            setSelectedRegionId(regionId);
            setInspectorFocus((n) => n + 1);
          }}
          registerDropResolver={registerDropResolver}
          movableMax={movableCount}
          legalMovesFor={(regionId, entry) => destinationsFor(regionId, entry.unit_type_id, entry.instance_id ?? "")}
          onArmDrag={armDrag}
          onDragCount={(count) => setSelection((s) => (s?.kind === "stack" ? { ...s, count } : s))}
          onDragCancel={() => setSelection(null)}
          onDropMove={commitMove}
          unitTitle={(entry) => unitName(entry.unit_type_id, session.state.unit_types)}
          movement={
            editing
              ? null
              : {
                  phase,
                  regionIds: Object.keys(state.regions),
                  orders: state.phase_orders.map((order) => ({
                    id: order.id,
                    faction: order.faction,
                    fromRegionId: order.fromRegionId,
                    toRegionId: order.toRegionId,
                    path: order.path,
                    unitType: order.unitType,
                    shipInstanceIds: order.shipInstanceIds,
                    count: order.count,
                    attack: phase === "combat_move" && state.isRegionHostileTo(order.toRegionId, order.faction),
                  })),
                }
          }
          unitCategories={unitCategories}
          activeFactionId={faction}
          fuelFor={(regionId, entry) => fuelForDisplayEntry(state, regionId, entry.unit_type_id, entry.faction_id)}
          isLoaded={(entry) => {
            const iid = entry.instance_id ?? "";
            if (iid === "") {
              return false;
            }
            const cargo = state.transport_instances[iid]?.cargo;
            return Array.isArray(cargo) && cargo.length > 0;
          }}
          editor={editing ? editor.binding : undefined}
          bindCamera={bindCamera}
          suspended={approach?.stage === "darken" || approach?.stage === "briefing" || battleOnScreen !== null}
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
                onFight={approachBattle}
              />
              <RegionPanel
                game={game}
                regionId={selectedRegionId}
                selection={selection}
                focusNonce={inspectorFocus}
                onSelectStack={selectStack}
                onDragStart={(entry) => pickStack(selectedRegionId, entry)}
                onDragEnd={(entry, clientX, clientY) => {
                  const target = resolveDrop.current(clientX, clientY);
                  if (target !== "" && target !== selectedRegionId) {
                    dropStack(selectedRegionId, entry, target);
                  }
                }}
              />
              <EventLog log={game.log} />
            </>
          )}
        </aside>
      </div>
      {!editing && <PendingOrders game={game} onCancelled={() => setSelection(null)} />}
    </div>
    {approach?.stage === "darken" && <CombatDarken onDone={showBriefing} />}
    {approach?.stage === "briefing" && (
      <CombatIntro
        attackerId={approach.attackerId}
        defenderId={approach.defenderId}
        regionName={approach.regionName}
        onBegin={beginBattle}
      />
    )}
    {battleOnScreen && (
      <div className="combat-cover">
        <BattleScreen
          key={battleOnScreen.region_id}
          game={game}
          battle={battleOnScreen}
          regionName={state.regions[battleOnScreen.region_id]?.name || battleOnScreen.region_id}
          onExit={() => {
            setBattleOnScreen(null);
            setSelectedRegionId(battleOnScreen.region_id);
          }}
        />
      </div>
    )}
    </>
  );
}
