import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NEWMAP_PATH, factionIdFromDisplay, prepareSavedMap } from "../../content/game_scene_session_builder";
import { fuelForDisplayEntry, offeredMoveDestinations } from "../../engine/air/air_fuel";
import { bombardLabel, bombardTargets } from "../../engine/combat/bombardChoice";
import { loadJson } from "../../engine/content/res";
import type { ActiveBattle } from "../../engine/model/battle";
import { RegionUnitDisplay } from "../../engine/presentation/region_unit_display";
import { BattleScreen } from "./BattleScreen";
import { playUiPanelFlick, soundManager } from "../../audio/sound_manager";
import { Soundboard } from "../audio/Soundboard";
import { playCampaignCue } from "./campaignAudio";
import { armCampaignMusic, setCampaignBed, setCampaignVolume } from "./campaignMusic";
import { CombatDarken, CombatIntro } from "./CombatIntro";
import {
  COMBAT_PAN_MS,
  COMBAT_ZOOM_MS,
  combatGoal,
  type MapCamera,
  panToTerritory,
} from "./combatCamera";
import { endCombatMoveGate } from "../../engine/movement/combat_move_gate";
import { movesOnlyInNoncombat, seaZoneCargoLabel, transportSeaZone } from "../../engine/transport/cargo_rules";
import { holdMarks } from "./shipHold";
import { EditorPanel } from "./editor/EditorPanel";
import { EditorStart } from "./editor/EditorStart";
import { EditorToolbar } from "./editor/EditorToolbar";
import { boardFrame } from "./editor/blankMap";
import { editorToMapJson, startingStacks } from "./editor/editorModel";
import { useMapEditor } from "./editor/useMapEditor";
import { duskChrome, factionChrome } from "./factionChrome";
import { type BoardView, boardViewOf, boardViewSearch } from "./boardView";
import { buildMapGeometry, type HighlightMode, type StackEntry, stackKey } from "./geometry";
import { committedMoves, peelHeld, type HeldMove } from "./combatRedirect";
import { projectMapJson } from "./map_space";
import { type CombatMarker, MapView } from "./MapView";
import { concealNeutralGarrison } from "./neutralGarrison";
import type { MasterLand } from "./svgLandLoader";
import { useMasterLand } from "./useMasterLand";
import { EventLog } from "./panels/EventLog";
import { PhasePanel } from "./panels/PhasePanel";
import { PhaseChip } from "../hud/PhaseChip";
import { PhaseDrawer } from "../hud/PhaseDrawer";
import { RegionInspector } from "../hud/RegionInspector";
import { RoomPill } from "./panels/RoomPill";
import { TurnBar } from "./panels/TurnBar";
import { unitName } from "./session/event_text";
import { rosterName } from "../theme/factionRoster";
import { isActiveFaction } from "./tokenStyle";
import { nextFacingHold, type FacingHold, type FacingStacks } from "./uprightSprites";
import { extractHostileFrontlineSegments, reliefRegions, scarTargets } from "./terrainRelief";
import { moveUnitsPayload } from "./stackMove";
import { MotionTestLevel } from "../../art/MotionTestLevel";
import { NativeBattlePreview } from "../../art/NativeBattlePreview";
import { UnitBakeReviewPanel } from "../../art/UnitBakeReviewPanel";
import { MainMenu } from "./menu/MainMenu";
import { readCampaignSaves, writeCampaignSave, type CampaignSave } from "./menu/campaignSave";
import { type PlayChoice } from "./session/play_map";
import { launchForScenario, legacyLaunch, type CampaignLaunchConfig } from "../../engine/types/ruleset";
import { NewCampaignModal, draftLaunch, type CampaignDraft } from "./menu/NewCampaignModal";
import { useCampaignSession } from "./session/use_campaign_session";

export type Selection =
  | {
      kind: "stack";
      regionId: string;
      key: string;
      unitTypeId: string;
      instanceId: string;
      /** Set when the stack is cargo leaving one transport. Empty for the ship itself. */
      cargoOf: string;
      max: number;
      count: number;
    }
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

function storedVolume(): number {
  try {
    const raw = window.localStorage.getItem("strategy-demo.volume");
    if (raw == null || raw.trim() === "") {
      return 1;
    }
    const stored = Number(raw);
    return Number.isFinite(stored) ? Math.min(1, Math.max(0, stored)) : 1;
  } catch {
    return 1;
  }
}

// Stable empties for editor mode, so the canvas does not see new objects every render.
const NO_HIGHLIGHT: HighlightMode = { kind: "none" };
const NO_MARKERS: CombatMarker[] = [];
const NEVER = () => false;

function chosenStack(regionId: string, entry: StackEntry, max: number, count: number): Selection {
  return {
    kind: "stack",
    regionId,
    key: stackKey(entry),
    unitTypeId: entry.unit_type_id,
    instanceId: entry.instance_id ?? "",
    cargoOf: entry.cargoOf ?? "",
    max,
    count,
  };
}

/** Piece counts per region, copied so later moves cannot change a combat-move snapshot. */
function facingStacksFrom(state: { region_units: Record<string, { faction_id?: string; count?: number; instance_id?: string }[]> }): FacingStacks {
  const out: FacingStacks = {};
  for (const regionId of Object.keys(state.region_units)) {
    const rows: { factionId: string; count: number }[] = [];
    for (const entry of state.region_units[regionId] ?? []) {
      const factionId = String(entry.faction_id ?? "");
      const count = Math.max(0, Math.trunc(Number(entry.count ?? (entry.instance_id ? 1 : 0))));
      if (factionId === "" || count <= 0) continue;
      const row = rows.find((item) => item.factionId === factionId);
      if (row) row.count += count;
      else rows.push({ factionId, count });
    }
    if (rows.length > 0) out[regionId] = rows;
  }
  return out;
}

/** The React Three Fiber board, behind `?view=3d`. Loaded on demand so Three.js stays out of the 2D bundle. */
const MapViewport3D = lazy(() => import("../viewport3d/MapViewport3D"));
/** The master copy of the first React Three Fiber board, behind `?view=vanilla` and the menu's Vanilla. */
const MapViewportVanilla = lazy(() => import("../viewport3d/vanilla/MapViewportVanilla"));
/** Vanilla with the Shogun II art pass, behind `?view=shogun` and the menu's Shogun. */
const MapViewportShogun = lazy(() => import("../viewport3d/shogun/MapViewportShogun"));
/** The diorama's units and play on the Shogun ground, behind `?view=shogun2`. */
const MapViewportShogunV2 = lazy(() => import("../viewport3d/shogun2/MapViewportShogunV2"));

const BOARD_VIEWPORTS = {
  "2d": MapView,
  "3d": MapViewport3D,
  vanilla: MapViewportVanilla,
  shogun: MapViewportShogun,
  shogun2: MapViewportShogunV2,
} as const;

export function App() {
  const { game, room, online, isMyTurn, battleFeed } = useCampaignSession();
  const { session, version } = game;
  const state = session.state;
  const faction = state.current_faction_id;
  const phase = state.current_phase;
  const facingBag = useRef<{ session: typeof session; hold: FacingHold } | null>(null);
  const facingKey = `${state.game_round}|${faction}`;
  const facingPrev = facingBag.current?.session === session ? facingBag.current.hold : null;
  const facingHold = nextFacingHold(
    facingPrev,
    facingPrev != null,
    phase,
    facingKey,
    !facingPrev || (phase === "combat_move" && (!facingPrev.locked || facingPrev.key !== facingKey))
      ? facingStacksFrom(state)
      : facingPrev.stacks,
  );
  facingBag.current = { session, hold: facingHold };

  // The map is drawn in the land SVG's coordinates; demomap01.json predates it and is projected on load.
  // A saved version replaces the board for play. The editor's "Reset to demo map" stays on the file.
  const demoMapJson = useMemo(() => projectMapJson(loadJson(NEWMAP_PATH)), []);
  const playMapJson = game.map ?? demoMapJson;
  const geometry = useMemo(() => buildMapGeometry(playMapJson), [playMapJson]);
  const { land: fileLand, error: landError } = useMasterLand();
  const [coast, setCoast] = useState<MasterLand | "file" | "none">("file");
  const [coastForPlay, setCoastForPlay] = useState(false);
  const [editing, setEditing] = useState(false);
  const artQuery = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const spriteEditor = artQuery.get("bake") === "1";
  const fieldTest = artQuery.get("field") === "1";
  const [boardView, setBoardView] = useState<BoardView>(() => boardViewOf(artQuery.get("view")));
  const chooseBoard = useCallback((view: BoardView) => {
    setBoardView(view);
    try {
      // Keep the address in step, so a reload opens the same board.
      const { pathname, search, hash } = window.location;
      window.history.replaceState(window.history.state, "", `${pathname}${boardViewSearch(search, view)}${hash}`);
    } catch {
      // The board still changes for this visit.
    }
  }, []);
  const [menuOpen, setMenuOpen] = useState(!(spriteEditor || fieldTest));
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [draft, setDraft] = useState<CampaignDraft>({
    scenarioId: "SCENARIO_1942_QUICK",
    ruleset: launchForScenario("SCENARIO_1942_QUICK").ruleset,
    mapId: "demo",
    seed: "12345",
  });
  const [boardGate, setBoardGate] = useState(false);
  const [look, setLook] = useState<"field" | "dusk">(() => {
    try {
      return window.localStorage.getItem("strategy-demo.look") === "dusk" ? "dusk" : "field";
    } catch {
      return "field";
    }
  });
  const [volume, setVolume] = useState(storedVolume);
  const [playerFaction, setPlayerFaction] = useState("ussr");
  const [saveTick, setSaveTick] = useState(0);
  const land =
    editing || coastForPlay ? (coast === "file" ? fileLand : coast === "none" ? null : coast) : fileLand;
  const editor = useMapEditor(demoMapJson, land, editing, setCoast);
  const editorStacks = useMemo(() => startingStacks(editor.map), [editor.map]);
  const editorOwners = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of editor.map.regions) {
      const owner = factionIdFromDisplay(r.starting_owner);
      out[r.id] = owner === "neutral" || owner === "independent" ? "" : owner;
    }
    return out;
  }, [editor.map]);
  const saves = useMemo(() => readCampaignSaves(), [saveTick]);
  const board = editing ? boardFrame(editor.map) : null;
  // The map editor draws on the 2D canvas, so it keeps the 2D map.
  const Viewport = editing ? MapView : BOARD_VIEWPORTS[boardView];

  const stashSave = useCallback((): CampaignSave => {
    return {
      version: 1,
      savedAt: Date.now(),
      label: `${game.mapName} · round ${session.state.game_round}`,
      mapId: game.mapId,
      mapName: game.mapName,
      seed: game.seed,
      map: game.map,
      snapshot: game.capture(),
      launch: { scenarioId: session.state.scenarioId, ruleset: { ...session.state.rulesetConfig } },
    };
  }, [game, session]);

  useEffect(() => {
    setCampaignVolume(volume);
  }, [volume]);

  useEffect(() => {
    if (menuOpen || editing) {
      return;
    }
    const handle = window.setTimeout(() => {
      writeCampaignSave(stashSave());
      setSaveTick((n) => n + 1);
    }, 600);
    return () => window.clearTimeout(handle);
  }, [menuOpen, editing, stashSave, game.version]);

  const openMenu = useCallback(() => {
    writeCampaignSave(stashSave());
    setSaveTick((n) => n + 1);
    setEditing(false);
    setBoardGate(false);
    setCoastForPlay(false);
    setSelection(null);
    setSelectedRegionId("");
    setMenuOpen(true);
  }, [stashSave]);

  const beginCampaign = useCallback(
    (choice: PlayChoice, seed: number, launch?: CampaignLaunchConfig) => {
      game.newGame(seed, choice, launch);
      setEditing(false);
      setBoardGate(false);
      setCoastForPlay(false);
      setSelection(null);
      setSelectedRegionId("");
      setMenuOpen(false);
    },
    [game],
  );

  const resumeSave = useCallback(
    (save: CampaignSave) => {
      const choice: PlayChoice = { id: save.mapId, name: save.mapName, map: save.map };
      game.newGame(save.seed, choice, legacyLaunch());
      game.restore(save.snapshot);
      game.hydrateLaunch(save.launch);
      setEditing(false);
      setBoardGate(false);
      setCoastForPlay(false);
      setSelection(null);
      setSelectedRegionId("");
      setMenuOpen(false);
    },
    [game],
  );

  const playtest = useCallback(() => {
    const json = editorToMapJson(editor.map, { round: false });
    const stored = editor.archiveMap("Playtest", json);
    if (stored.error !== "") {
      return;
    }
    game.newGame(game.seed, {
      id: stored.id,
      name: "Playtest",
      map: projectMapJson(prepareSavedMap(json)),
    });
    setEditing(false);
    setBoardGate(false);
    setCoastForPlay(true);
    setSelection(null);
    setSelectedRegionId("");
    setMenuOpen(false);
  }, [editor, game]);

  const [selectedRegionId, setSelectedRegionId] = useState("");
  /** Bumped when a capped fan opens the region inspector, so the panel can take focus. */
  const resolveDrop = useRef<(clientX: number, clientY: number) => string>(() => "");
  const registerDropResolver = useCallback((fn: (clientX: number, clientY: number) => string) => {
    resolveDrop.current = fn;
  }, []);
  const moveDrag = useRef<{
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
  } | null>(null);
  const registerMoveDrag = useCallback((api: typeof moveDrag.current) => {
    moveDrag.current = api;
  }, []);
  const redirectHold = useRef<{ regionId: string; entry: StackEntry; orders: HeldMove[]; take: number }[] | null>(null);
  const [hoverRegionId, setHoverRegionId] = useState("");
  const [warningSea, setWarningSea] = useState("");
  const [selection, setSelection] = useState<Selection>(null);
  const [squad, setSquad] = useState<{ regionId: string; entries: { entry: StackEntry; count: number }[] } | null>(null);
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

  // Strategist 1 on the map. The combat phase fades across to strategist 2.
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
  const relief = useMemo(() => {
    if (editing) {
      return { frontlines: [], scars: [] };
    }
    const box = land?.viewBox ?? geometry.bounds;
    return {
      frontlines: extractHostileFrontlineSegments(reliefRegions(geometry.regions), state, {
        left: box.x,
        right: box.x + box.w,
      }),
      scars: scarTargets(state),
    };
  }, [editing, geometry, land, state, version]);

  const owners = useMemo(() => {
    const out: Record<string, string> = {};
    for (const id of Object.keys(state.regions)) {
      out[id] = state.regions[id].owner_faction_id;
    }
    return out;
  }, [state, version]);

  const stacks = useMemo(() => {
    const atWar = new Set<string>();
    const battleId = state.active_battle?.region_id ?? "";
    if (battleId !== "") {
      atWar.add(battleId);
    }
    if (state.current_phase === "combat_move" || state.current_phase === "combat") {
      for (const order of state.phase_orders) {
        atWar.add(order.toRegionId);
      }
    }
    for (const id of Object.keys(state.territories_fought_this_round)) {
      if (state.territories_fought_this_round[id]) {
        atWar.add(id);
      }
    }
    const out: Record<string, StackEntry[]> = {};
    for (const id of Object.keys(state.region_units)) {
      const region = state.regions[id];
      const owner = region?.owner_faction_id ?? "";
      if (region != null && concealNeutralGarrison(owner, region.isLandRegion(), atWar.has(id))) {
        continue;
      }
      out[id] = RegionUnitDisplay.buildDisplayEntries(state.region_units[id]);
    }
    return out;
  }, [state, version]);

  const destinationsFor = (regionId: string, unitTypeId: string, instanceId: string, cargoOf = "") => {
    if (cargoOf !== "") {
      return session.getLegalUnloadDestinations(cargoOf, faction);
    }
    const moves = offeredMoveDestinations(
      state,
      phase,
      faction,
      regionId,
      unitTypeId,
      session.getLegalMoveDestinations(regionId, unitTypeId, faction, instanceId),
    );
    const extra: string[] = [];
    if (instanceId === "" && state.unit_types[unitTypeId]?.category === "land") {
      extra.push(...session.getLegalLoadDestinations(regionId, unitTypeId, faction));
    }
    if (instanceId !== "") {
      extra.push(...session.getLegalUnloadDestinations(instanceId, faction));
    }
    return [...new Set([...moves, ...extra])];
  };

  const legalTargets = useMemo(() => {
    if (squad && squad.regionId === selectedRegionId && squad.entries.length > 0) {
      const shared = new Set<string>();
      for (const item of squad.entries) {
        for (const id of destinationsFor(squad.regionId, item.entry.unit_type_id, item.entry.instance_id ?? "", item.entry.cargoOf ?? "")) {
          shared.add(id);
        }
      }
      return [...shared];
    }
    if (selection?.kind === "stack") {
      return destinationsFor(selection.regionId, selection.unitTypeId, selection.instanceId, selection.cargoOf);
    }
    if (selection?.kind === "place") {
      return session.getLegalMobilizeRegions(faction, selection.unitTypeId);
    }
    return [];
  }, [squad, selectedRegionId, selection, session, faction, phase, version]);

  const highlight: HighlightMode = useMemo(() => {
    if (squad && squad.regionId === selectedRegionId && legalTargets.length > 0) {
      return {
        kind: "move",
        from: squad.regionId,
        legal: legalTargets,
        hover: "",
        tone: phase === "noncombat_move" ? "move" : "attack",
      };
    }
    if (selection?.kind === "stack") {
      const naval = state.unit_types[selection.unitTypeId]?.category === "sea";
      return {
        kind: "move",
        from: selection.regionId,
        legal: legalTargets,
        hover: "",
        tone: phase === "noncombat_move" ? "move" : "attack",
        hostile: naval ? legalTargets.filter((id) => state.holdsEnemyNavalUnit(id, faction)) : undefined,
      };
    }
    if (selection?.kind === "place") {
      return { kind: "mobilize", legal: legalTargets, hover: "" };
    }
    return { kind: "none" };
  }, [squad, selectedRegionId, selection, legalTargets, phase]);

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
    if (squad && squad.regionId === selectedRegionId && regionId !== squad.regionId) {
      const going = squad.entries.filter((item) =>
        destinationsFor(squad.regionId, item.entry.unit_type_id, item.entry.instance_id ?? "", item.entry.cargoOf ?? "").includes(regionId),
      );
      if (going.length > 0) {
        for (const item of going) {
          commitMove(squad.regionId, item.entry, regionId, item.count);
        }
        setSquad(null);
        setSelection(null);
        setSelectedRegionId(regionId);
      }
      return;
    }
    if (selection?.kind === "stack" && selection.cargoOf !== "") {
      if (!isMyTurn) {
        setSelectedRegionId(regionId);
        return;
      }
      const entry: StackEntry = {
        unit_type_id: selection.unitTypeId,
        faction_id: faction,
        count: selection.count,
        cargoOf: selection.cargoOf,
      };
      if (legalTargets.includes(regionId)) {
        commitMove(selection.regionId, entry, regionId, selection.count);
      } else {
        setSelection(null);
        setSelectedRegionId(regionId === selectedRegionId ? "" : regionId);
      }
      return;
    }
    const placing = selection?.kind === "place" && legalTargets.includes(regionId);
    const moving = selection?.kind === "stack" && legalTargets.includes(regionId);
    if (!isMyTurn && (placing || moving)) {
      setSelectedRegionId(regionId);
      return;
    }
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
        soundManager.play(phase === "combat_move" && state.isRegionHostileTo(regionId, faction) ? "battle_arrow_lock" : "token_drop");
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
    if (regionId === selectedRegionId) {
      setSelection(null);
      setSquad(null);
      return;
    }
    setSelection(null);
    setSquad(null);
    setSelectedRegionId(regionId);
  };

  /** How many of this stack the current faction can still move this phase. */
  const movableCount = (regionId: string, entry: StackEntry): number => {
    if (!MOVEMENT_PHASES.includes(phase) || !isActiveFaction(entry.faction_id, faction)) {
      return 0;
    }
    if (entry.cargoOf) {
      if (phase === "combat_move" && movesOnlyInNoncombat(state, entry.unit_type_id)) {
        return 0;
      }
      const aboard = (state.transport_instances[entry.cargoOf]?.cargo ?? []).reduce(
        (sum, line) =>
          sum + (String(line.unit_type_id ?? "") === entry.unit_type_id ? Math.max(0, Math.trunc(Number(line.count ?? 0))) : 0),
        0,
      );
      if (aboard <= 0 || session.getLegalUnloadDestinations(entry.cargoOf, faction).length === 0) {
        return 0;
      }
      return Math.min(entry.count, aboard);
    }
    const base = entry.instance_id
      ? state.hasInstanceMoved(entry.instance_id)
        ? 0
        : 1
      : state.movableStackCount(faction, regionId, entry.unit_type_id);
    if (base > 0 || !entry.instance_id || (phase !== "combat_move" && phase !== "noncombat_move")) {
      return base;
    }
    return session.getLegalUnloadDestinations(entry.instance_id, faction).length > 0 ? 1 : 0;
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
    if (!isMyTurn) {
      setSelectedRegionId(regionId);
      return;
    }
    const max = movableCount(regionId, entry);
    setSelectedRegionId(regionId);
    setSelection(max <= 0 ? null : chosenStack(regionId, entry, max, max));
  };

  /** Move `count` of a stack. The map drag, its split popover, and an inspector drop all come through here. */
  const commitMove = (regionId: string, entry: StackEntry, target: string, count: number, onto?: StackEntry | null, bombard?: string) => {
    if (!isMyTurn) {
      return;
    }
    const max = movableCount(regionId, entry);
    if (max <= 0) {
      settleRedirect(regionId, entry, false);
      setSelection(null);
      return;
    }
    const legal = destinationsFor(regionId, entry.unit_type_id, entry.instance_id ?? "", entry.cargoOf ?? "");
    if (!legal.includes(target)) {
      settleRedirect(regionId, entry, false);
      setSelection(null);
      return;
    }
    if (entry.cargoOf) {
      const transportId = entry.cargoOf;
      const sea = transportSeaZone(state, transportId);
      const hostile = phase === "combat_move" && state.isRegionHostileTo(target, entry.faction_id);
      const units = [{ unit_type_id: entry.unit_type_id, count: Math.min(max, Math.max(1, count)) }];
      const result = hostile
        ? game.send("designate_amphibious", {
            transport_instance_id: transportId,
            origin_sea_zone_id: sea,
            target_region_id: target,
            units,
          })
        : game.send("unload_transport", {
            transport_instance_id: transportId,
            to_region_id: target,
            units,
          });
      if (result.result_type === "ok") {
        settleRedirect(regionId, entry, true);
        setSelection(null);
        setSelectedRegionId(target);
        soundManager.play(hostile ? "battle_arrow_lock" : "token_drop");
        return;
      }
      settleRedirect(regionId, entry, false);
      return;
    }
    const category = state.unit_types[entry.unit_type_id]?.category;
    if (category === "land" && state.regions[target]?.isSeaRegion()) {
      const ontoCarrier = Math.trunc(Number(state.unit_types[onto?.unit_type_id ?? ""]?.special?.fighter_capacity ?? 0)) > 0;
      if (ontoCarrier) {
        settleRedirect(regionId, entry, false);
        setSelection(null);
        return;
      }
      const transportId =
        onto?.unit_type_id === "transport" && onto.instance_id
          ? onto.instance_id
          : session.findTransportForLoad(regionId, target, entry.unit_type_id, entry.faction_id);
      if (transportId === "") {
        settleRedirect(regionId, entry, false);
        setSelection(null);
        return;
      }
      const loaded = game.send("load_transport", {
        transport_instance_id: transportId,
        from_region_id: regionId,
        units: [{ unit_type_id: entry.unit_type_id, count: Math.min(max, Math.max(1, count)) }],
      });
      if (loaded.result_type === "ok") {
        settleRedirect(regionId, entry, true);
        setSelection(null);
        setSelectedRegionId(target);
        soundManager.play("token_drop");
        return;
      }
      settleRedirect(regionId, entry, false);
      return;
    }
    if (entry.instance_id && entry.unit_type_id === "transport" && state.regions[target]?.isLandRegion()) {
      const transportId = entry.instance_id;
      const sea = transportSeaZone(state, transportId);
      const hostile = phase === "combat_move" && state.isRegionHostileTo(target, entry.faction_id);
      const result = hostile
        ? game.send("designate_amphibious", {
            transport_instance_id: transportId,
            origin_sea_zone_id: sea,
            target_region_id: target,
          })
        : game.send("unload_transport", {
            transport_instance_id: transportId,
            to_region_id: target,
            units: (state.transport_instances[transportId]?.cargo ?? []).filter(
              (line) => phase !== "combat_move" || !state.unit_types[line.unit_type_id]?.special?.noncombat_move_only && !state.unit_types[line.unit_type_id]?.special?.is_aa,
            ),
          });
      if (result.result_type === "ok") {
        settleRedirect(regionId, entry, true);
        setSelection(null);
        setSelectedRegionId(target);
        soundManager.play(hostile ? "battle_arrow_lock" : "token_drop");
        return;
      }
      settleRedirect(regionId, entry, false);
      return;
    }
    const result = game.send(
      "move_units",
      moveUnitsPayload(regionId, entry, target, Math.min(max, Math.max(1, count)), bombard),
    );
    if (result.result_type === "ok") {
      settleRedirect(regionId, entry, true);
      setSelection(null);
      setSelectedRegionId(target);
      soundManager.play(
        phase === "combat_move" && state.isRegionHostileTo(target, entry.faction_id) ? "battle_arrow_lock" : "token_drop",
      );
      return;
    }
    settleRedirect(regionId, entry, false);
    setSelection(null);
  };

  const stackOrders = (regionId: string, entry: StackEntry): HeldMove[] => {
    if (phase !== "combat_move" || entry.cargoOf) {
      return [];
    }
    return committedMoves(state.phase_orders, faction, regionId, entry.unit_type_id, entry.instance_id ?? "");
  };

  const reissueOrders = (regionId: string, entry: StackEntry, orders: readonly HeldMove[]) => {
    for (const order of orders) {
      if (order.count <= 0) {
        continue;
      }
      const unit: Record<string, unknown> = { unit_type_id: entry.unit_type_id, count: order.count };
      if (order.instanceId !== "") {
        unit.instance_id = order.instanceId;
      }
      game.send("move_units", { moves: [{ from_region_id: regionId, to_region_id: order.toRegionId, units: [unit] }] });
    }
  };

  const restoreRedirect = () => {
    const held = redirectHold.current;
    redirectHold.current = null;
    if (!held) {
      return;
    }
    for (const piece of held) {
      reissueOrders(piece.regionId, piece.entry, piece.orders);
    }
  };

  const openCommitted = (regionId: string, entry: StackEntry, count: number) => {
    const orders = stackOrders(regionId, entry);
    const ordered = orders.reduce((sum, order) => sum + order.count, 0);
    const take = Math.min(ordered, Math.max(0, count - movableCount(regionId, entry)));
    if (take <= 0) {
      return;
    }
    const list = redirectHold.current ?? [];
    list.push({ regionId, entry, orders, take });
    redirectHold.current = list;
    let guard = 0;
    while (stackOrders(regionId, entry).length > 0 && guard < 12) {
      const next = stackOrders(regionId, entry)[0];
      if (!next) {
        break;
      }
      game.cancelPhaseOrder(next.id);
      guard += 1;
    }
  };

  const settleRedirect = (regionId: string, entry: StackEntry, moved: boolean) => {
    const list = redirectHold.current;
    if (!list) {
      return;
    }
    const index = list.findIndex((item) => item.regionId === regionId && stackKey(item.entry) === stackKey(entry));
    if (index < 0) {
      return;
    }
    const [piece] = list.splice(index, 1);
    if (list.length === 0) {
      redirectHold.current = null;
    }
    reissueOrders(piece.regionId, piece.entry, moved ? peelHeld(piece.orders, piece.take) : piece.orders);
  };

  /** A stack dragged out of the inspector and dropped on `target`: the whole movable stack. */
  const dropStack = (regionId: string, entry: StackEntry, target: string) => {
    commitMove(regionId, entry, target, movableCount(regionId, entry));
  };

  const armDrag = (regionId: string, entry: StackEntry, count: number) => {
    if (!isMyTurn) {
      return;
    }
    openCommitted(regionId, entry, count);
    const max = movableCount(regionId, entry);
    if (max > 0) soundManager.play("token_pickup");
    setSelectedRegionId(regionId);
    setSelection(max <= 0 ? null : chosenStack(regionId, entry, max, Math.min(max, Math.max(1, count))));
  };

  const selectStack = (regionId: string, entry: StackEntry) => {
    if (!isMyTurn) {
      setSelectedRegionId(regionId);
      return;
    }
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
    soundManager.play("token_pickup");
    setSelection(chosenStack(regionId, entry, max, max));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelection(null);
        setSelectedRegionId("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (phase !== "combat_move" || endCombatMoveGate(state).advance) {
      setWarningSea("");
    }
  }, [phase, version, state]);

  const focusStrandedTransport = (seaZoneId: string) => {
    setWarningSea(seaZoneId);
    soundManager.play("stinger_war_room");
    const camera = cameraRef.current;
    const shape = geometry.regions.find((region) => region.id === seaZoneId);
    if (!camera || !shape) {
      return;
    }
    const snap = camera.snapshot();
    if (snap.width <= 1 || snap.height <= 1 || snap.fitK <= 0) {
      return;
    }
    const goal = combatGoal(snap.view, shape.bounds, snap.width, snap.height, snap.fitK, "zoom", shape.anchor, window.devicePixelRatio || 1);
    void panToTerritory(seaZoneId, goal.k, camera, shape.bounds);
  };

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
          const goal = combatGoal(snap.view, shape.bounds, snap.width, snap.height, snap.fitK, mode, shape.anchor, window.devicePixelRatio || 1);
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
    if (!online && result.result_type === "ok" && session.state.active_battle) {
      setBattleOnScreen(session.state.active_battle);
    }
  };

  useEffect(() => {
    if (!online) {
      return;
    }
    const battle = session.state.active_battle;
    if (battle) {
      setBattleOnScreen(battle);
      return;
    }
    if (!isMyTurn) {
      setBattleOnScreen(null);
    }
  }, [online, isMyTurn, version, session]);

  const covered = approach !== null || battleOnScreen !== null;

  return (
    <>
    <div
      className={menuOpen ? "campaign menu-open" : "campaign"}
      data-look={look}
      style={look === "dusk" ? duskChrome() : factionChrome(faction)}
      inert={covered ? true : undefined}
      onClickCapture={(event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const button = target.closest("button");
        if (!button || button.closest(".sfx-toggle, .region-panel, .pending-orders")) return;
        if (!button.closest(".phase-panel, .turn-bar, .editor-panel, .editor-toolbar, .main-menu, .editor-start, .campaign-modal")) return;
        playUiPanelFlick();
      }}
    >
      <TurnBar
        game={game}
        editing={editing}
        versions={editor.versions}
        onToggleEditing={() => {
          setMenuOpen(false);
          setBoardGate(false);
          setEditing((e) => !e);
        }}
        onMenu={openMenu}
        playerFaction={playerFaction}
        room={room}
        launch={draftLaunch(draft)}
        onNewCampaign={() => setCampaignOpen(true)}
      />
      <div className="main">
        <Suspense fallback={<div className="map-wrap" />}>
        <Viewport
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
          relief={relief}
          isUnmoved={editing ? NEVER : isUnmoved}
          onRegionClick={onRegionClick}
          captureClick={squad?.regionId === selectedRegionId}
          onBackgroundClick={() => {
            setSquad(null);
            setSelection(null);
            setSelectedRegionId("");
          }}
          onRegionHover={(id) => {
            const label = id === "" ? "" : seaZoneCargoLabel(state, id);
            setHoverRegionId((prev) => {
              const prevLabel = prev === "" ? "" : seaZoneCargoLabel(state, prev);
              if (label === prevLabel && (label === "" || prev === id)) {
                return prev;
              }
              return label === "" ? "" : id;
            });
          }}
          onStackClick={(regionId, entry) => selectStack(regionId, entry)}
          onOpenInspector={(regionId) => {
            setSelectedRegionId(regionId);
          }}
          registerDropResolver={registerDropResolver}
          registerMoveDrag={registerMoveDrag}
          movableMax={(regionId, entry) => {
            if (!isMyTurn) {
              return 0;
            }
            const ordered =
              phase === "combat_move"
                ? committedMoves(state.phase_orders, faction, regionId, entry.unit_type_id, entry.instance_id ?? "").reduce(
                    (sum, order) => sum + order.count,
                    0,
                  )
                : 0;
            return movableCount(regionId, entry) + ordered;
          }}
          legalMovesFor={(regionId, entry) =>
            destinationsFor(regionId, entry.unit_type_id, entry.instance_id ?? "", entry.cargoOf ?? "")
          }
          onArmDrag={armDrag}
          onDragCount={(count) => setSelection((s) => (s?.kind === "stack" ? { ...s, count } : s))}
          onDragCancel={() => {
            restoreRedirect();
            setSelection(null);
          }}
          onDropMove={commitMove}
          bombardTargetsFor={(regionId, entry, destination) => {
            if (phase !== "combat_move") {
              return [];
            }
            return bombardTargets(state, entry.faction_id || faction, destination, entry.unit_type_id).map((id) => ({
              id,
              label: bombardLabel(id),
            }));
          }}
          onDropBombard={(regionId, entry, destination, count, targetId, onto) =>
            commitMove(regionId, entry, destination, count, onto, targetId)
          }
          unitTitle={(entry) => {
            const name = unitName(entry.unit_type_id, session.state.unit_types);
            const historic = rosterName(entry.unit_type_id, entry.faction_id);
            return historic ? `${historic} (${name})` : name;
          }}
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
          sameTeam={(a, b) => state.sameTeam(a, b)}
          facingStacks={editing ? undefined : facingHold.stacks}
          activeFactionId={faction}
          fuelFor={(regionId, entry) =>
            isActiveFaction(entry.faction_id, faction)
              ? fuelForDisplayEntry(state, regionId, entry.unit_type_id, entry.faction_id)
              : null
          }
          isLoaded={(entry) => {
            const iid = entry.instance_id ?? "";
            if (iid === "") {
              return false;
            }
            const cargo = state.transport_instances[iid]?.cargo;
            return Array.isArray(cargo) && cargo.length > 0;
          }}
          holdFor={(regionId, entry) => holdMarks(state, regionId, entry)}
          cargoCount={(entry) => {
            const iid = entry.instance_id ?? "";
            if (iid === "") {
              return 0;
            }
            return (state.transport_instances[iid]?.cargo ?? []).reduce(
              (sum, line) => sum + Math.max(0, Math.trunc(Number(line.count ?? 0))),
              0,
            );
          }}
          warningRegionId={warningSea}
          editor={editing ? editor.binding : undefined}
          bindCamera={bindCamera}
          isHostileTarget={(regionId) =>
            phase === "combat_move" &&
            (state.regions[regionId]?.isSeaRegion()
              ? state.holdsEnemyNavalUnit(regionId, faction)
              : state.isRegionHostileTo(regionId, faction))
          }
          menuBackdrop={menuOpen}
          referenceImage={editing ? editor.referenceUrl : null}
          frame={board}
          suspended={approach?.stage === "darken" || approach?.stage === "briefing" || battleOnScreen !== null}
          inBattle={approach !== null || battleOnScreen !== null}
        >
          {editing && !boardGate && <EditorToolbar editor={editor} />}
          {!editing && !menuOpen && (
            <>
              <PhaseDrawer phase={phase}>
                <PhasePanel
                  game={game}
                  selection={selection}
                  setSelection={setSelection}
                  legalTargets={legalTargets}
                  pending={pendingForFaction}
                  commandsEnabled={isMyTurn}
                  onFight={approachBattle}
                  onStrandedCargo={focusStrandedTransport}
                />
              </PhaseDrawer>
              <RegionInspector
                game={game}
                regionId={selectedRegionId}
                selectedKey={selection?.kind === "stack" ? selection.key : ""}
                movableCount={(regionId, entry) => {
                  const ordered =
                    phase === "combat_move"
                      ? committedMoves(state.phase_orders, faction, regionId, entry.unit_type_id, entry.cargoOf ? "skip" : (entry.instance_id ?? "")).reduce(
                          (sum, order) => sum + order.count,
                          0,
                        )
                      : 0;
                  return movableCount(regionId, entry) + (entry.cargoOf ? 0 : ordered);
                }}
                moveDrag={moveDrag}
                squadOn={squad?.regionId === selectedRegionId}
                onToggleSquad={(entries) => {
                  if (entries == null) {
                    setSquad(null);
                    setSelection(null);
                    return;
                  }
                  setSelection(null);
                  setSquad({ regionId: selectedRegionId, entries });
                }}
                onClose={() => {
                  setSquad(null);
                  setSelection(null);
                  setSelectedRegionId("");
                }}
              />
              <PhaseChip
                game={game}
                commandsEnabled={isMyTurn}
                onFight={approachBattle}
                onStrandedCargo={focusStrandedTransport}
              />
              <div className="hud-log">
                <EventLog log={game.log} />
              </div>
              {hoverRegionId !== "" && seaZoneCargoLabel(state, hoverRegionId) !== "" && (
                <p className="cargo-hover">{seaZoneCargoLabel(state, hoverRegionId)}</p>
              )}
            </>
          )}
        </Viewport>
        </Suspense>
        {editing && (
          <aside className="sidebar">
            <EditorPanel editor={editor} onPlaytest={playtest} />
          </aside>
        )}
      </div>
      {menuOpen && (
        <MainMenu
          mapName={game.mapName}
          versions={editor.versions}
          saves={saves}
          room={room}
          volume={volume}
          look={look}
          draft={draft}
          board={boardView}
          onBoard={chooseBoard}
          onOpenBoard={(view) => {
            chooseBoard(view);
            setMenuOpen(false);
          }}
          onOpenCampaign={() => setCampaignOpen(true)}
          onVolume={(value) => {
            setVolume(value);
            setCampaignVolume(value);
            try {
              window.localStorage.setItem("strategy-demo.volume", String(value));
            } catch {
              // The slider still moves. The next visit starts at full volume.
            }
          }}
          onLook={(next) => {
            setLook(next);
            try {
              window.localStorage.setItem("strategy-demo.look", next);
            } catch {
              // The look still changes for this visit.
            }
          }}
          onNewCampaign={beginCampaign}
          onResume={resumeSave}
          onSaveNow={() => {
            writeCampaignSave(stashSave());
            setSaveTick((n) => n + 1);
          }}
          onOpenEditor={() => {
            setMenuOpen(false);
            setEditing(true);
            setBoardGate(true);
          }}
        />
      )}
      {editing && boardGate && (
        <EditorStart
          versions={editor.versions}
          onBlank={(width, height, referenceUrl, emptyOcean) => {
            editor.openBlank(width, height, !emptyOcean);
            editor.setReference(referenceUrl);
            setBoardGate(false);
          }}
          onDemo={() => {
            editor.resetToDemo();
            setBoardGate(false);
          }}
          onVersion={(id) => {
            editor.loadVersion(id);
            editor.setReference(null);
            setBoardGate(false);
          }}
          onMap={(map) => {
            editor.openMap(map);
            setBoardGate(false);
          }}
          onBack={() => {
            setEditing(false);
            setBoardGate(false);
            setMenuOpen(true);
          }}
        />
      )}
      {campaignOpen && (
        <NewCampaignModal
          draft={draft}
          versions={editor.versions}
          playerFaction={playerFaction}
          onDraft={setDraft}
          onPlayerFaction={setPlayerFaction}
          onImportMap={(name, map) => editor.archiveMap(name, projectMapJson(prepareSavedMap(map))).error}
          onStart={(choice, seed, launch) => {
            beginCampaign(choice, seed, launch);
            setCampaignOpen(false);
          }}
          onClose={() => setCampaignOpen(false)}
        />
      )}
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
    <Soundboard />
    {spriteEditor && <UnitBakeReviewPanel />}
    {import.meta.env.DEV && new URLSearchParams(window.location.search).get("anim") === "1" && <MotionTestLevel />}
    {fieldTest && <NativeBattlePreview />}
    {battleOnScreen && (
      <div className="combat-cover">
        <BattleScreen
          key={battleOnScreen.region_id}
          game={game}
          battle={battleOnScreen}
          regionName={state.regions[battleOnScreen.region_id]?.name || battleOnScreen.region_id}
          spectating={online && !isMyTurn}
          online={online}
          feed={battleFeed}
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
