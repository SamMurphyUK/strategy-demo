import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DRAG_PITCH_OFFSET, dragPitchStep, soundManager } from "../../audio/sound_manager";
import { factionPalette } from "../theme/factionPalette";
import { getTokenArtVersion, subscribeTokenArt } from "../theme/tokens/tokenArt";
import { facilityAnchorOf, type HighlightMode, type MapGeometry, type Rect, type StackEntry, stackKey, type Vec2 } from "./geometry";
import { pickHold, seatStack, type HoldMark, type HoldShip } from "./shipHold";
import { effectiveUnitSlots, roughShape, TOKEN_WORLD } from "./unitSlots";
import { buildCutterPaths, buildRegionPaths, pickCounter, pickFrontCounter, pickPlus, pickRegion } from "./hitTest";
import {
  drawBattleIcons,
  drawFootIcons,
  drawStandingBattleIcons,
  drawEditorOverlay,
  drawEditorUnits,
  drawCoastSurf,
  drawGameOverlay,
  drawHoverMark,
  drawMoveGuide,
  drawOperationalArrows,
  drawTerrain,
  shoreStencilFor,
  shoreVeilFor,
  type EditorOverlay,
  type GameOverlay,
  layoutRegions,
  type RegionLayout,
  type TerrainScene,
  TOKEN_PX,
} from "./mapRenderer";
import type { OperationalOrder } from "./operationalArrows";
import { BAKE_PAINT, type Baked, TerrainBake } from "./mapBake";
import type { BoardLayer } from "./boardLayer";
import { clipperFor } from "./regionClip";
import type { MasterLand } from "./svgLandLoader";
import { clampMoveCount, finishUnitDrag, guideOriginScreen } from "./moveDrag";
import { SplitStackPopover } from "./splitPopover";
import { unitLabel } from "./unitStacks";
import { beginCampaignFigures, takeCampaignFigures, type FacingStacks } from "./uprightSprites";
import { INFANTRY_IDLE_TICK_SECONDS, QUICK_TICK_SECONDS } from "../../art/quickUnitDraw";
import { createVehicleStage, type VehicleStage } from "../../art/fieldVehicleStage";
import { unitLean } from "./boardTune";
import { getBoardTune, getBoardTuneRev, subscribeBoardTune } from "./boardTuneStore";
import { CoastTuner } from "./CoastTuner";
import { getCoastTuneRev, subscribeCoastTune } from "./coastTuneStore";
import { getFigureScaleRev, subscribeFigureScale } from "./figureScaleStore";
import { stampFigures, takeFigureSheetDirty } from "./figureSheet";
import { getDrawFlags, noteIdle, notePaint, publishDrawSample, subscribeDrawFlags } from "./renderDebug";
import { easeInOutCubic, type MapCamera, viewCenter, viewFor } from "./combatCamera";
import {
  battleScarDescriptors,
  type FrontlineSegment,
  type ScarTarget,
  smokeFrame,
} from "./terrainRelief";
import {
  fitView,
  panView,
  projectionScales,
  tiltFactor,
  type View,
  visibleCopies,
  worldTokenPx,
  worldToScreen,
  anchorSpan,
  dampZoomK,
  maxZoomK,
  MIN_ZOOM_FACTOR,
  screenToWorld,
  wheelZoomFactor,
  wrapView,
  wrapWorldX,
  zoomAt,
  terrainHoldPlacement,
} from "./viewMath";
import { lodForZoom, type MapLod, SPRITE_FADE_MS, UPRIGHT_HIT_PX } from "./zoomLod";

export interface CombatMarker {
  regionId: string;
  count: number;
}

/** What the map editor plugs into the canvas. All points are world coordinates. */
export interface EditorBinding {
  overlay: Omit<EditorOverlay, "regions" | "paths">;
  /** Set once a Prune Box is drawn: the floating confirmation over it. */
  prunePrompt?: { box: { minX: number; minY: number; maxX: number; maxY: number }; count: number; confirm(): void; cancel(): void } | null;
  /** A draggable handle under the pointer (a vertex or the anchor), or null. */
  pickHandle(world: Vec2, tolWorld: number): unknown | null;
  onClick(world: Vec2, regionId: string, tolWorld: number, mods: { shift: boolean }): void;
  onDoubleClick(world: Vec2, tolWorld: number): void;
  onHover(world: Vec2 | null, tolWorld: number): void;
  onDrag(handle: unknown, world: Vec2, tolWorld: number): void;
  onDragEnd(handle: unknown): void;
  /** True when a press-and-drag should draw a straight cut (the knife with no line started). */
  swipeable(): boolean;
  /** A freehand stroke starts (the pointer moved far enough from where it went down). */
  strokeBegin(): void;
  /** The world points of the stroke so far; `pxToWorld` is world units per screen pixel. `done` on release. */
  onStroke(points: Vec2[], pxToWorld: number, done: boolean): void;
  /** Paint or erase one sample of a sea-lattice stroke. `done` commits the undo step. False when nothing can be painted, so the press can pan instead. */
  onLattice?(world: Vec2, mods: { erase: boolean; shift: boolean; done: boolean; underId?: string }): boolean;
}

export interface MapViewProps {
  geometry: MapGeometry;
  land: MasterLand | null;
  landError: string;
  owners: Record<string, string>;
  stacks: Record<string, StackEntry[]>;
  selectedRegionId: string;
  selectedStack: { regionId: string; key: string } | null;
  highlight: HighlightMode;
  combatMarkers: CombatMarker[];
  isUnmoved(regionId: string, entry: StackEntry): boolean;
  onRegionClick(regionId: string): void;
  /** Pointer went up on map space that is not a region, after a press shorter than the pan threshold. */
  onBackgroundClick?(): void;
  /**
   * The next click is a destination, not a new selection.
   * Select all sets this so a click on a defended territory is not swallowed by the token there.
   */
  captureClick?: boolean;
  onRegionHover(regionId: string): void;
  onStackClick(regionId: string, entry: StackEntry, key: string): void;
  /** Unit type id to land, air or sea, from the scenario data. Without it the standard unit ids decide. */
  unitCategories?: Record<string, string>;
  /** The faction whose turn it is: its count pills are gold. */
  activeFactionId?: string;
  /** Remaining fuel for an air token. Null for every other unit. */
  fuelFor?(regionId: string, entry: StackEntry): number | null;
  /** A transport with cargo aboard gets a dot on its token. */
  isLoaded?(entry: StackEntry): boolean;
  /** Pieces aboard, drawn as the cargo pill. */
  cargoCount?(entry: StackEntry): number;
  /** Transport cargo seats. Null means this piece draws no circles. */
  holdFor?(regionId: string, entry: StackEntry): HoldMark[] | null;
  /** Sea zone to ring while combat-move cargo is still aboard. */
  warningRegionId?: string;
  /** A capped fan or its [+] was clicked: select the region and open the inspector. */
  onOpenInspector?(regionId: string): void;
  /** Registers the function that turns a screen point into the region under it, for a drag out of the inspector. */
  registerDropResolver?(resolve: (clientX: number, clientY: number) => string): void;
  /** How many of this stack the current faction can still move. 0 means the token cannot be dragged. */
  movableMax?(regionId: string, entry: StackEntry): number;
  /** Legal destinations for a stack, asked once when a drag starts. */
  legalMovesFor?(regionId: string, entry: StackEntry): string[];
  /** The drag has crossed the click threshold: select the stack at this count. */
  onArmDrag?(regionId: string, entry: StackEntry, count: number): void;
  /** The live count changed while the line is on screen. */
  onDragCount?(count: number): void;
  /** The drag or the split popover was dismissed without a move. */
  onDragCancel?(): void;
  /** Drop committed: move `count` of the stack onto `target`. `onto` is the ship under the pointer. */
  onDropMove?(
    regionId: string,
    entry: StackEntry,
    target: string,
    count: number,
    onto?: StackEntry | null,
  ): void;
  /** Bombard choices for a combat-move drop. Empty means the drop attacks. */
  bombardTargetsFor?(regionId: string, entry: StackEntry, target: string): { id: string; label: string }[];
  onDropBombard?(
    regionId: string,
    entry: StackEntry,
    target: string,
    count: number,
    bombard: string,
    onto?: StackEntry | null,
  ): void;
  /** The inspector starts, moves, and ends a drag with the same guide as a token on the map. */
  registerMoveDrag?(
    api: {
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
    } | null,
  ): void;
  /** Display name for a stack in the split popover. Falls back to the type id. */
  unitTitle?(entry: StackEntry): string;
  /** Movement-phase orders drawn as operational arrows. Null in the editor. */
  movement?: { phase: string; orders: readonly OperationalOrder[]; regionIds: readonly string[] } | null;
  /** Sword badges that stay up through the combat phase, one per battle that is not finished. */
  battleIcons?: readonly { regionId: string; count: number }[];
  /** Hostile borders and territories carrying battle scars. Empty in the editor. */
  relief?: { frontlines: readonly FrontlineSegment[]; scars: readonly ScarTarget[] } | null;
  editor?: EditorBinding;
  /** Floating controls drawn over the map (the editor toolbar). */
  children?: ReactNode;
  /** The campaign drives the camera into a battle, then leaves it where it landed. */
  bindCamera?(camera: MapCamera | null): void;
  /** Skip painting while a battle covers the map. The camera state stays. */
  suspended?: boolean;
  /** Battle (or the approach into one) swaps the room tone for the outdoor bed. */
  inBattle?: boolean;
  /** Factions that share a side. Zoomed-in sprites face the nearest region this rejects. */
  sameTeam?(a: string, b: string): boolean;
  /** Piece counts from the start of the current faction's combat move. */
  facingStacks?: FacingStacks;
  /** Slow autonomous pan while the main menu covers the board. */
  menuBackdrop?: boolean;
  /** Tracing sheet for a blank map, drawn over the board. */
  referenceImage?: string | null;
  /** Camera frame for a blank board. Absent frames the land mask. */
  frame?: Rect | null;
  /** A board drawn under the canvases (the 3D viewport). It takes the ground; this view keeps the rest. */
  board?: BoardLayer | null;
}

let blankBake: Baked | null = null;

/** Stands in for the base map while a board layer draws the ground. Nothing reads its pixels. */
function unusedBake(): Baked {
  if (!blankBake) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    blankBake = { canvas, scale: 1 };
  }
  return blankBake;
}

/** A press shorter than this is a click. Panning starts at 5px so a camera drag never selects a region. */
const DRAG_THRESHOLD_PX = 5;
/** The knife turns a drag into a freehand stroke after this much travel, then samples every STROKE_STEP_PX. */
const STROKE_START_PX = 6;
const STROKE_STEP_PX = 3;
export const SNAP_PX = 8;
const HANDLE_PX = 10;
const WORLD_FALLBACK: Rect = { x: 0, y: 0, w: 800, h: 504 };

type Drag =
  | { kind: "pan"; startX: number; startY: number; view: View; moved: boolean }
  | { kind: "handle"; handle: unknown }
  | { kind: "unit" }
  | { kind: "swipe"; from: Vec2; points: Vec2[]; moved: boolean; startX: number; startY: number; lastX: number; lastY: number }
  | { kind: "lattice"; erase: boolean };

/** A friendly stack being pulled. `originWorld` is on the primary copy, so the guide can hop wraps. */
interface UnitGesture {
  regionId: string;
  key: string;
  entry: StackEntry;
  originWorld: Vec2;
  max: number;
  count: number;
  adjusted: boolean;
  moved: boolean;
  armed: boolean;
  pointer: Vec2;
  legal: string[];
  startX: number;
  startY: number;
  wheel: number;
  /** Every stack in a select-all drag. Absent when one stack is pulled. */
  group?: { entry: StackEntry; count: number }[];
}

/** A drop that still needs a count. `x` and `y` are canvas pixels. */
interface SplitPrompt {
  regionId: string;
  key: string;
  entry: StackEntry;
  target: string;
  max: number;
  count: number;
  x: number;
  y: number;
  legal: string[];
}

/** One wheel notch while a stack is held. Smaller trackpad deltas accumulate until they cross this. */
const WHEEL_STEP = 40;
/** The glide is finished once the live zoom is this close to the wheel target. */
const ZOOM_EPSILON = 0.0005;
/** After the glide stops, wait this long before upgrading the coast bitmap. */
const BAKE_SETTLE_MS = 120;
/** The menu drift, in map units. The same figure-eight the camera used to walk. */
const MENU_DRIFT_X = 36;
const MENU_DRIFT_Y = 18;
/** Painted past the screen so that drift can slide the picture. It covers the drift up to a zoom of about 6. */
const MENU_MARGIN_X = 220;
const MENU_MARGIN_Y = 110;

/** Text fields keep their keys. A range slider is not one of them, so Z still closes the tuner. */
function isTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) {
    return false;
  }
  if (el.isContentEditable) {
    return true;
  }
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
    return true;
  }
  if (el.tagName !== "INPUT") {
    return false;
  }
  const type = (el as HTMLInputElement).type.toLowerCase();
  return type === "" || type === "text" || type === "search" || type === "url" || type === "tel" || type === "email" || type === "password" || type === "number";
}

function strokeWarningRing(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  layouts: readonly RegionLayout[],
  regionId: string,
  pulse: number,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const layout of layouts) {
    if (layout.region.id !== regionId) {
      continue;
    }
    ctx.beginPath();
    ctx.arc(layout.anchor.x, layout.anchor.y, 34 + 10 * pulse, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(180, 48, 36, ${0.35 + 0.5 * pulse})`;
    ctx.stroke();
  }
}

export function MapView(props: MapViewProps) {
  const { geometry, land, editor } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const slideRef = useRef<HTMLDivElement>(null);
  /** The menu picture with its color filter already applied, so the drift does not filter again. */
  const menuPlate = useRef<HTMLCanvasElement | null>(null);
  const referenceRef = useRef<HTMLImageElement | null>(null);
  const arrowRef = useRef<HTMLCanvasElement>(null);
  const vectorRef = useRef<SVGSVGElement>(null);
  const vectorStage = useRef<VehicleStage | null>(null);
  const chromeRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [hoverStack, setHoverStack] = useState<{ regionId: string; key: string; copyDx: number } | null>(null);
  const refreshArrowsRef = useRef<() => void>(() => {});
  const hoverRef = useRef("");
  const [gesture, setGesture] = useState<UnitGesture | null>(null);
  const [split, setSplit] = useState<SplitPrompt | null>(null);
  const [bombard, setBombard] = useState<{
    regionId: string;
    entry: StackEntry;
    target: string;
    count: number;
    x: number;
    y: number;
    choices: { id: string; label: string }[];
    onto: StackEntry | null;
    listing: boolean;
  } | null>(null);
  const unitRef = useRef<UnitGesture | null>(null);
  const splitRef = useRef<SplitPrompt | null>(null);
  splitRef.current = split;
  const splitPanel = useRef<HTMLDivElement>(null);
  const bombardPanel = useRef<HTMLDivElement>(null);

  const askOrDrop = (
    regionId: string,
    entry: StackEntry,
    target: string,
    count: number,
    onto: StackEntry | null | undefined,
    x: number,
    y: number,
  ) => {
    const offered = live.current.props.bombardTargetsFor?.(regionId, entry, target) ?? [];
    if (offered.length > 0) {
      setBombard({
        regionId,
        entry,
        target,
        count,
        x,
        y,
        choices: offered,
        onto: onto ?? null,
        listing: false,
      });
      return;
    }
    live.current.props.onDropMove?.(regionId, entry, target, count, onto ?? undefined);
  };
  const tokenArtRev = useSyncExternalStore(subscribeTokenArt, getTokenArtVersion); // counters repaint when their art changes

  const bounds: Rect = props.frame ?? land?.viewBox ?? (geometry.bounds.w > 0 ? geometry.bounds : WORLD_FALLBACK);
  const fitK = size.w > 0 ? fitView(bounds, size.w, size.h).k : 1;
  const userMoved = useRef(false);
  const lodHold = useRef<MapLod>(0);
  const spriteGate = useRef<MapLod | null>(null);
  const spriteFade = useRef<{ toSprites: boolean; start: number } | null>(null);
  const [spriteClock, setSpriteClock] = useState(0);
  const [tuneOpen, setTuneOpen] = useState(false);
  const coastRev = useSyncExternalStore(subscribeCoastTune, getCoastTuneRev);
  const boardRev = useSyncExternalStore(subscribeBoardTune, getBoardTuneRev);
  const figureRev = useSyncExternalStore(subscribeFigureScale, getFigureScaleRev);
  const drawFlags = useSyncExternalStore(subscribeDrawFlags, getDrawFlags);
  const cameraLock = useRef(false);
  const cameraJob = useRef<{ cancel: () => void } | null>(null);
  const wheelZoom = useRef({
    active: false,
    targetK: 1,
    anchorScreen: { x: 0, y: 0 } as Vec2,
    anchorWorld: { x: 0, y: 0 } as Vec2,
    raf: 0,
    generation: 0,
    lastFrame: 0,
    settledAt: Number.NEGATIVE_INFINITY,
    bakeTimer: 0,
  });
  const [bakeTick, setBakeTick] = useState(0);
  const [tunerCenter, setTunerCenter] = useState({ x: 0, y: 0 });
  const panGlide = useRef({ next: null as View | null, raf: 0, dirty: false });
  const terrainHoldView = useRef<View | null>(null);
  const needsBakeSettle = useRef(false);
  const abortBakeSettle = () => {
    const zoom = wheelZoom.current;
    window.clearTimeout(zoom.bakeTimer);
    zoom.bakeTimer = 0;
  };
  const flushPanView = (): View | null => {
    const pan = panGlide.current;
    if (pan.raf !== 0) {
      cancelAnimationFrame(pan.raf);
      pan.raf = 0;
    }
    if (!pan.dirty || !pan.next) {
      return null;
    }
    pan.dirty = false;
    const next = pan.next;
    pan.next = null;
    setView(next);
    return next;
  };
  const stopWheelZoom = () => {
    const zoom = wheelZoom.current;
    zoom.generation += 1;
    if (zoom.raf !== 0) {
      cancelAnimationFrame(zoom.raf);
    }
    zoom.raf = 0;
    zoom.active = false;
    abortBakeSettle();
    zoom.settledAt = Number.NEGATIVE_INFINITY;
  };
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const waypointRegion = useRef("");

  // True shapes: each cutter boolean-clipped against the land SVG. Cached per cutter, so dragging one
  // vertex re-clips only the regions that share it. Without the land, the rough cutters stand in.
  const clipped = useMemo(() => (land ? clipperFor(land.polygons).clipAll(geometry.regions) : null), [land, geometry]);
  const paths = useMemo(() => buildRegionPaths(geometry.regions, clipped), [geometry, clipped]);
  const cutterPaths = useMemo(() => buildCutterPaths(geometry.regions), [geometry]);
  const exact = clipped !== null;
  /** In the editor only the chosen layer (land or sea) can be hovered or clicked, and the other is faded. */
  const only = editor ? editor.overlay.layer : null;
  // Tokens are a fixed size in the world, so they scale with the map and hold their formation at every zoom;
  // only the extremes are clamped (see worldTokenPx).
  const unitScale = worldTokenPx(view.k, TOKEN_WORLD) / TOKEN_PX;
  const mapLod: MapLod = editor ? 0 : lodForZoom(view.k, lodHold.current);
  if (!editor) {
    lodHold.current = mapLod;
    if (spriteGate.current === null) {
      spriteGate.current = mapLod;
    } else if (spriteGate.current !== mapLod) {
      const wasSprites = spriteGate.current === 2;
      spriteGate.current = mapLod;
      if (wasSprites !== (mapLod === 2)) {
        spriteFade.current = { toSprites: mapLod === 2, start: performance.now() };
      }
    }
  }
  let unitFade = !editor && mapLod === 2 ? 1 : 0;
  const handoff = editor ? null : spriteFade.current;
  if (handoff && spriteClock >= 0) {
    const t = Math.min(1, (performance.now() - handoff.start) / SPRITE_FADE_MS);
    unitFade = handoff.toSprites ? t : 1 - t;
    if (t >= 1) {
      spriteFade.current = null;
    }
  }
  const uprightReach = unitFade >= 0.5 ? UPRIGHT_HIT_PX : 0;
  const tokenHitPx = TOKEN_PX * unitScale * 0.5 + 4;
  const plusHitPx = Math.max(4, TOKEN_PX * unitScale * 0.22);
  /** A region's unit slots: hand-placed, or generated from its true shape. Cached per shape by the generator. */
  const slotsFor = (region: (typeof geometry.regions)[number]) =>
    effectiveUnitSlots(region, clipped?.get(region.id) ?? roughShape(region));
  // The game world wraps sideways: the base map is blitted once per visible copy, and units and shields are
  // laid out for each. The editor edits a single copy, so its coordinates stay true.
  const wrap = !editor;
  // The menu paints a margin around the fitted camera and slides that picture. The camera itself stays put.
  const menuScales = projectionScales(view.k);
  const paintView: View = props.menuBackdrop
    ? { k: view.k, x: view.x - MENU_MARGIN_X / menuScales.sx, y: view.y - MENU_MARGIN_Y / menuScales.sy }
    : view;
  const paintW = size.w + (props.menuBackdrop ? MENU_MARGIN_X * 2 : 0);
  const paintH = size.h + (props.menuBackdrop ? MENU_MARGIN_Y * 2 : 0);
  const copies = visibleCopies(paintView, paintW, bounds, wrap);
  const layouts = copies.flatMap((dx) =>
    layoutRegions(geometry.regions, props.stacks, { ...paintView, x: paintView.x - dx }, unitScale, {
      slotsFor,
      categories: props.unitCategories,
      copyDx: dx,
    }),
  );
  const bakeRef = useRef<{ rev: number; bake: TerrainBake } | null>(null);
  if (bakeRef.current?.rev !== BAKE_PAINT) {
    bakeRef.current = { rev: BAKE_PAINT, bake: new TerrainBake() };
  }
  // Coast and terrain, kept so the idle tick can redraw the figures without blurring the shore again.
  const terrainHold = useRef<HTMLCanvasElement | null>(null);
  const spritesSettled = useRef(false);
  const spriteFrame = useRef<{
    scene: TerrainScene;
    overlay: GameOverlay;
    warningRegionId: string;
  } | null>(null);
  useEffect(() => {
    soundManager.updateAmbience(tiltFactor(view.k), props.inBattle === true);
  }, [view.k, props.inBattle]);

  useEffect(() => {
    if (editor || spriteFade.current === null) return;
    let raf = 0;
    const step = () => {
      const fade = spriteFade.current;
      if (!fade) return;
      if (performance.now() - fade.start >= SPRITE_FADE_MS) {
        spriteFade.current = null;
        setSpriteClock((n) => n + 1);
        return;
      }
      setSpriteClock(performance.now());
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [mapLod, editor]);

  // Handlers read the latest values through this ref, so listeners are attached once.
  const live = useRef({ view, size, layouts, paths, props, fitK, bounds, exact, only, wrap, tokenHitPx, plusHitPx, uprightReach });
  live.current = { view, size, layouts, paths, props, fitK, bounds, exact, only, wrap, tokenHitPx, plusHitPx, uprightReach };
  const commitTunerCenter = (nextView?: View) => {
    const { view: current, size: canvas } = live.current;
    const used = nextView ?? current;
    if (canvas.w <= 0 || canvas.h <= 0) {
      return;
    }
    setTunerCenter(viewCenter(used, canvas.w, canvas.h));
  };
  const scheduleBakeSettle = () => {
    const zoom = wheelZoom.current;
    window.clearTimeout(zoom.bakeTimer);
    if (!needsBakeSettle.current || zoom.active) {
      zoom.bakeTimer = 0;
      return;
    }
    if (drag.current?.kind === "pan" && drag.current.moved) {
      zoom.bakeTimer = 0;
      return;
    }
    const generation = zoom.generation;
    zoom.bakeTimer = window.setTimeout(() => {
      const latest = wheelZoom.current;
      if (latest.generation !== generation || latest.active) {
        return;
      }
      if (drag.current?.kind === "pan" && drag.current.moved) {
        return;
      }
      latest.bakeTimer = 0;
      latest.settledAt = Number.NEGATIVE_INFINITY;
      commitTunerCenter();
      setBakeTick((n) => n + 1);
    }, BAKE_SETTLE_MS);
  };
  const bakeSettleRef = useRef({ abort: abortBakeSettle, schedule: scheduleBakeSettle });
  bakeSettleRef.current = { abort: abortBakeSettle, schedule: scheduleBakeSettle };

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      setSize({ w: Math.floor(entry.contentRect.width), h: Math.floor(entry.contentRect.height) });
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  // Fit until the user takes over, including once the land mask arrives and changes the bounds.
  // The title screen starts from the fitted board, then the drift below takes it.
  useEffect(() => {
    if (size.w > 0 && (props.menuBackdrop || !userMoved.current)) {
      setView(fitView(bounds, size.w, size.h));
    }
  }, [props.menuBackdrop, size.w, size.h, bounds.x, bounds.y, bounds.w, bounds.h]);

  // The menu keeps the live map moving: a slow figure-eight, sliding the painted margin.
  useEffect(() => {
    const slide = slideRef.current;
    if (!props.menuBackdrop || size.w === 0) {
      if (slide) {
        slide.style.transform = "";
      }
      return;
    }
    const { sx, sy } = projectionScales(fitView(bounds, size.w, size.h).k);
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      const node = slideRef.current;
      if (node) {
        const x = -Math.sin(t * 0.07) * MENU_DRIFT_X * sx;
        const y = -Math.sin(t * 0.05) * MENU_DRIFT_Y * sy;
        node.style.transform = `translate(${x}px, ${y}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (slideRef.current) {
        slideRef.current.style.transform = "";
      }
    };
  }, [props.menuBackdrop, size.w, size.h, bounds.x, bounds.y, bounds.w, bounds.h]);

  useEffect(() => {
    const url = props.referenceImage;
    if (!url) {
      referenceRef.current = null;
      return;
    }
    let gone = false;
    const img = new Image();
    img.onload = () => {
      if (gone) {
        return;
      }
      referenceRef.current = img;
      setView((current) => ({ ...current }));
    };
    img.src = url;
    return () => {
      gone = true;
    };
  }, [props.referenceImage]);

  // A view left over from the old 24× cap is pulled back as soon as the map is on screen.
  useEffect(() => {
    if (size.w === 0 || cameraLock.current) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const cap = maxZoomK(fitK, dpr);
    setView((v) => (v.k > cap ? zoomAt(v, { x: size.w / 2, y: size.h / 2 }, cap / v.k, fitK, dpr) : v));
  }, [fitK, size.w, size.h]);

  useEffect(() => {
    const api: MapCamera = {
      snapshot() {
        const { view: current, fitK: fitted, size: canvas } = live.current;
        return { view: { ...current }, fitK: fitted, width: canvas.w, height: canvas.h };
      },
      moveTo(goal, ms) {
        stopWheelZoom();
        cameraJob.current?.cancel();
        userMoved.current = true;
        cameraLock.current = true;
        const fromK = live.current.view.k;
        const w0 = live.current.size.w || 1;
        const h0 = live.current.size.h || 1;
        const fromCenter = viewCenter(live.current.view, w0, h0);
        return new Promise((resolve) => {
          const start = performance.now();
          let raf = 0;
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            cancelAnimationFrame(raf);
            cameraLock.current = false;
            if (cameraJob.current?.cancel === finish) cameraJob.current = null;
            resolve();
          };
          cameraJob.current = { cancel: finish };
          const step = (now: number) => {
            if (settled) return;
            const t = ms <= 0 ? 1 : Math.min(1, (now - start) / ms);
            const e = easeInOutCubic(t);
            const w = live.current.size.w || w0;
            const h = live.current.size.h || h0;
            const cap = maxZoomK(live.current.fitK, window.devicePixelRatio || 1);
            const k = Math.min(fromK + (goal.k - fromK) * e, cap);
            const cx = fromCenter.x + (goal.center.x - fromCenter.x) * e;
            const cy = fromCenter.y + (goal.center.y - fromCenter.y) * e;
            let next = viewFor({ x: cx, y: cy }, k, w, h);
            if (live.current.wrap) next = wrapView(next, w, live.current.bounds);
            setView(next);
            if (t < 1) raf = requestAnimationFrame(step);
            else finish();
          };
          raf = requestAnimationFrame(step);
        });
      },
    };
    props.bindCamera?.(api);
    return () => {
      cameraJob.current?.cancel();
      props.bindCamera?.(null);
    };
  }, [props.bindCamera]);

  useEffect(() => {
    const svg = vectorRef.current;
    if (!svg) {
      return;
    }
    const stage = createVehicleStage(svg);
    vectorStage.current = stage;
    return () => {
      stage.clear();
      vectorStage.current = null;
    };
  }, []);

  const paintCampaignVectors = (dpr: number, cssW: number, cssH: number, fade: number, scene: TerrainScene | null) => {
    const frame = takeCampaignFigures();
    const stage = vectorStage.current;
    // The sheet stamps one shared picture for each kind. Off, every figure is its own SVG node.
    const sheet = getDrawFlags().sheet;
    const lean = unitLean(scene?.view.k ?? live.current.view.k, getBoardTune());
    if (stage && cssW > 0 && cssH > 0) {
      stage.setShoreVeil(scene && !sheet ? shoreVeilFor(scene) : null);
      stage.sync(
        { cssWidth: cssW, cssHeight: cssH, camX: 0, camY: 0, viewScale: 1, figureLean: lean },
        sheet ? [] : frame.vectors,
        null,
      );
      if (vectorRef.current) {
        vectorRef.current.style.opacity = fade < 1 ? String(Math.max(0, fade)) : "";
      }
    }
    const chrome = chromeRef.current;
    const cctx = chrome?.getContext("2d");
    if (!chrome || !cctx) {
      return;
    }
    const pixelW = Math.round(cssW * dpr);
    const pixelH = Math.round(cssH * dpr);
    if (pixelW > 0 && (chrome.width !== pixelW || chrome.height !== pixelH)) {
      chrome.width = pixelW;
      chrome.height = pixelH;
    }
    cctx.setTransform(1, 0, 0, 1, 0, 0);
    cctx.clearRect(0, 0, chrome.width, chrome.height);
    cctx.globalAlpha = Math.max(0, Math.min(1, fade));
    if (sheet) {
      stampFigures(cctx, frame.vectors, dpr, scene ? shoreStencilFor(scene) : null, lean);
    }
    for (const paint of frame.chrome) {
      paint(cctx);
    }
    cctx.globalAlpha = 1;
  };

  const movementKey = props.movement
    ? `${props.movement.phase}:${props.movement.orders.map((order) => `${order.id}:${order.count}:${order.toRegionId}`).join(";")}`
    : "";
  const frameKey = props.frame ? `${props.frame.x}:${props.frame.y}:${props.frame.w}:${props.frame.h}` : "";

  useEffect(() => {
    if (!tuneOpen) {
      return;
    }
    let frames = 0;
    let windowStart = performance.now();
    let lastFrame = windowStart;
    // The slowest frame stays on the panel for three seconds, so a zoom can be read after it ends.
    let worst = 0;
    let worstAt = 0;
    let raf = 0;
    const step = (now: number) => {
      frames += 1;
      const gap = now - lastFrame;
      lastFrame = now;
      if (gap >= worst || now - worstAt > 3000) {
        worst = gap;
        worstAt = now;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const id = window.setInterval(() => {
      const now = performance.now();
      const span = now - windowStart;
      const canvas = canvasRef.current;
      publishDrawSample({
        fps: span > 0 ? (frames * 1000) / span : 0,
        worstMs: worst,
        frameMs: frames > 0 ? span / frames : 0,
        lod: lodHold.current,
        zoom: live.current.view.k,
        px: canvas ? `${live.current.size.w}×${live.current.size.h} · ${canvas.width}×${canvas.height}` : "",
      });
      windowStart = now;
      frames = 0;
    }, 250);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(id);
    };
  }, [tuneOpen]);

  useEffect(() => {
    if (!tuneOpen) {
      return;
    }
    if (wheelZoom.current.active) {
      return;
    }
    if (drag.current?.kind === "pan" && drag.current.moved) {
      return;
    }
    commitTunerCenter();
  }, [tuneOpen, size.w, size.h]);

  useEffect(() => {
    if (props.suspended) {
      spritesSettled.current = false;
      return;
    }
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || size.w === 0) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const pixelW = Math.round(paintW * dpr);
    const pixelH = Math.round(paintH * dpr);
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }
    const paintStarted = performance.now();
    let landMs = 0;
    let shoreMs = 0;
    let figureMs = 0;
    let arrowMs = 0;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    // The cached base map. A wheel glide keeps the current sheet; geometry and ownership still rebuild.
    const glide = wheelZoom.current;
    const panLive = drag.current?.kind === "pan" && drag.current.moved;
    const holdResolution =
      glide.active || glide.bakeTimer !== 0 || performance.now() - glide.settledAt < BAKE_SETTLE_MS;
    // A board layer draws the ground. This canvas then carries the washes and the counters only.
    const board = editor ? null : (props.board ?? null);
    const boardGround = board?.active === true;
    const baked = boardGround
      ? unusedBake()
      : bakeRef.current!.bake.ensure(
          { bounds, land, regions: geometry.regions, paths, shapes: clipped, exact, owners: props.owners },
          paintView.k * dpr,
          holdResolution,
        );
    const moveTone = props.movement?.phase === "noncombat_move" ? "move" : "attack";
    const dragHighlight: HighlightMode | null = gesture?.moved
      ? { kind: "move", from: gesture.regionId, legal: gesture.legal, hover: waypointRegion.current, tone: moveTone }
      : split
        ? { kind: "move", from: split.regionId, legal: split.legal, hover: split.target, tone: moveTone }
        : null;
    const scene: TerrainScene = {
      baked,
      bounds,
      copies,
      width: paintW,
      height: paintH,
      dpr,
      view: paintView,
      land,
      regions: geometry.regions,
      paths,
      shapes: clipped,
      exact,
      owners: props.owners,
      highlight: dragHighlight ?? props.highlight,
      selectedRegionId: props.selectedRegionId,
      hoverRegionId: gesture?.moved ? waypointRegion.current : "",
      dim: only === null ? null : only === "land" ? "sea" : "land",
      frontlines: editor ? [] : (props.relief?.frontlines ?? []),
      lod: mapLod,
      unitFade,
      stampAvoid:
        mapLod >= 1
          ? Object.fromEntries(
              geometry.regions
                .filter((region) => region.type === "land")
                .map((region) => [region.id, [region.anchor, facilityAnchorOf(region), ...slotsFor(region)]]),
            )
          : undefined,
      backdrop: boardGround,
      scars: editor || boardGround
        ? []
        : (props.relief?.scars ?? []).flatMap((scar) => {
            const region = geometry.regions.find((item) => item.id === scar.regionId);
            if (!region || region.type !== "land") {
              return [];
            }
            const frame = smokeFrame(performance.now());
            return [
              battleScarDescriptors(region.id, region.anchor, [region.anchor, ...slotsFor(region)], scar.ember)[frame],
            ];
          }),
    };
    const hold = terrainHold.current;
    const holdView = terrainHoldView.current;
    const holdOk =
      !!hold &&
      holdView !== null &&
      hold.width === canvas.width &&
      hold.height === canvas.height;
    const interacting =
      !editor &&
      !boardGround &&
      !props.menuBackdrop &&
      holdOk &&
      (panLive || glide.active || glide.bakeTimer !== 0);
    if (interacting && hold && holdView) {
      needsBakeSettle.current = true;
      drawTerrain(ctx, { ...scene, skipCliffs: true });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const blit = terrainHoldPlacement(holdView, paintView, paintW, paintH, dpr);
      ctx.drawImage(hold, blit.dx, blit.dy, blit.dw, blit.dh);
    } else {
      needsBakeSettle.current = false;
      drawTerrain(ctx, scene);
    }
    const surfTime = performance.now() / 1000;
    const refImg = referenceRef.current;
    if (!interacting && refImg && props.frame && refImg.complete && refImg.naturalWidth > 0) {
      const { sx, sy } = projectionScales(paintView.k);
      const xs = dpr * sx;
      const ys = dpr * sy;
      ctx.save();
      ctx.setTransform(xs, 0, 0, ys, -paintView.x * xs, -paintView.y * ys);
      ctx.globalAlpha = 0.4;
      ctx.drawImage(refImg, props.frame.x, props.frame.y, props.frame.w, props.frame.h);
      ctx.restore();
    }
    const settled = !editor && mapLod === 2 && unitFade >= 1;
    spritesSettled.current = settled;
    const overlay: GameOverlay = {
      layouts,
      owners: props.owners,
      selectedStack: gesture?.moved
        ? { regionId: gesture.regionId, key: gesture.key }
        : split
          ? { regionId: split.regionId, key: split.key }
          : props.selectedStack,
      isUnmoved: props.isUnmoved,
      combatMarkers: props.combatMarkers,
      unitScale,
      hoverStack,
      activeFactionId: props.activeFactionId ?? "",
      fuelFor: props.fuelFor,
      isLoaded: props.isLoaded,
      cargoCount: props.cargoCount,
      holdFor: props.holdFor,
      categories: props.unitCategories,
      idleTime: settled ? performance.now() / 1000 : undefined,
      sameTeam: props.sameTeam,
      facingStacks: props.facingStacks,
    };
    if (!editor) {
      spriteFrame.current = {
        scene,
        overlay,
        warningRegionId: props.warningRegionId ?? "",
      };
    }
    if (!interacting && !boardGround && drawFlags.shore) {
      const shoreStarted = performance.now();
      drawCoastSurf(ctx, scene, surfTime);
      shoreMs = performance.now() - shoreStarted;
    }
    if (!editor && !interacting) {
      let nextHold = terrainHold.current;
      if (!nextHold) {
        nextHold = document.createElement("canvas");
        terrainHold.current = nextHold;
      }
      if (nextHold.width !== canvas.width || nextHold.height !== canvas.height) {
        nextHold.width = canvas.width;
        nextHold.height = canvas.height;
      }
      const holdCtx = nextHold.getContext("2d");
      if (holdCtx) {
        holdCtx.setTransform(1, 0, 0, 1, 0, 0);
        // Over a board layer this canvas is mostly clear, so the last picture has to go first.
        holdCtx.clearRect(0, 0, nextHold.width, nextHold.height);
        holdCtx.drawImage(canvas, 0, 0);
      }
      terrainHoldView.current = { ...paintView };
    }
    landMs = performance.now() - paintStarted - shoreMs;
    if (drawFlags.figures) {
      const figuresStarted = performance.now();
      if (editor) {
        beginCampaignFigures();
        drawEditorUnits(ctx, scene, overlay);
        drawEditorOverlay(ctx, scene, { ...editor.overlay, regions: geometry.regions, paths: cutterPaths });
        paintCampaignVectors(dpr, paintW, paintH, 0, scene);
      } else {
        beginCampaignFigures();
        drawGameOverlay(ctx, scene, overlay);
        paintCampaignVectors(dpr, paintW, paintH, unitFade, scene);
      }
      figureMs = performance.now() - figuresStarted;
    } else {
      beginCampaignFigures();
      paintCampaignVectors(dpr, paintW, paintH, 0, null);
      if (editor) {
        drawEditorOverlay(ctx, scene, { ...editor.overlay, regions: geometry.regions, paths: cutterPaths });
      }
    }
    const arrows = arrowRef.current;
    const arrowCtx = arrows?.getContext("2d");
    if (arrows && arrowCtx) {
      if (arrows.width !== pixelW || arrows.height !== pixelH) {
        arrows.width = pixelW;
        arrows.height = pixelH;
      }
      arrowCtx.setTransform(1, 0, 0, 1, 0, 0);
      arrowCtx.clearRect(0, 0, arrows.width, arrows.height);
      const arrowsStarted = performance.now();
      if (!editor && drawFlags.arrows) {
        const movement = props.movement;
        const planned =
          movement && movement.orders.length > 0
            ? drawOperationalArrows(arrowCtx, scene, movement.phase, movement.orders, movement.regionIds, layouts)
            : [];
        if (gesture?.moved) {
          const from = guideOriginScreen(gesture.originWorld, gesture.pointer, paintView, bounds, true);
          drawMoveGuide(arrowCtx, dpr, from, gesture.pointer, factionPalette(gesture.entry.faction_id).ring);
        }
        if (movement && planned.some((arrow) => arrow.battle)) {
          drawBattleIcons(arrowCtx, scene, planned, movement.orders);
        }
        if (movement && planned.some((arrow) => !arrow.battle)) {
          drawFootIcons(arrowCtx, scene, planned, movement.orders);
        }
        if (props.battleIcons && props.battleIcons.length > 0) {
          drawStandingBattleIcons(arrowCtx, scene, props.battleIcons);
        }
        drawHoverMark(arrowCtx, scene, hoverRef.current);
        if (props.warningRegionId) {
          const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
          strokeWarningRing(arrowCtx, dpr, layouts, props.warningRegionId, pulse);
        }
      }
      arrowMs = performance.now() - arrowsStarted;
    }
    if (props.menuBackdrop && !boardGround) {
      // The menu color filter would rerun on every slide. It is drawn into the picture once instead.
      const dusk = document.querySelector(".campaign")?.getAttribute("data-look") === "dusk";
      let plate = menuPlate.current;
      if (!plate) {
        plate = document.createElement("canvas");
        menuPlate.current = plate;
      }
      if (plate.width !== canvas.width || plate.height !== canvas.height) {
        plate.width = canvas.width;
        plate.height = canvas.height;
      }
      const plateCtx = plate.getContext("2d");
      if (plateCtx) {
        plateCtx.setTransform(1, 0, 0, 1, 0, 0);
        plateCtx.filter = dusk ? "saturate(0.75) contrast(0.85) brightness(0.55)" : "contrast(0.72) brightness(0.55)";
        plateCtx.drawImage(canvas, 0, 0);
        plateCtx.filter = "none";
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.filter = "none";
        ctx.drawImage(plate, 0, 0);
      }
    }
    if (board) {
      board.frame({
        view: paintView,
        width: paintW,
        height: paintH,
        dpr,
        fitK,
        maxK: maxZoomK(fitK, dpr),
        copies,
        layouts,
        tokenPx: TOKEN_PX * unitScale,
        unitFade,
        layers: [canvas, chromeRef.current, arrowRef.current].filter((layer): layer is HTMLCanvasElement => layer != null),
      });
    }
    notePaint({ paintMs: performance.now() - paintStarted, landMs, shoreMs, figureMs, arrowMs });
  }, [
    props.board?.active,
    size.w,
    size.h,
    view.x,
    view.y,
    view.k,
    mapLod,
    spriteClock,
    tokenArtRev,
    coastRev,
    boardRev,
    figureRev,
    unitFade,
    geometry,
    land,
    props.stacks,
    props.owners,
    props.highlight,
    movementKey,
    props.combatMarkers,
    props.relief,
    props.selectedRegionId,
    props.selectedStack?.regionId,
    props.selectedStack?.key,
    props.warningRegionId,
    props.battleIcons,
    frameKey,
    props.activeFactionId,
    gesture,
    split,
    hoverStack,
    props.suspended,
    props.menuBackdrop,
    drawFlags,
    bakeTick,
  ]);

  // At the token zoom the picture is still. At the tactical zoom, redraw figures only when an idle frame changes.
  useEffect(() => {
    let lastQuick = -1;
    let lastInfantry = -1;
    const tick = () => {
      if (
        document.hidden ||
        cameraLock.current ||
        drag.current ||
        wheelZoom.current.active ||
        wheelZoom.current.bakeTimer !== 0
      ) {
        return;
      }
      const frame = spriteFrame.current;
      const warningId = frame?.warningRegionId ?? "";
      const settled = spritesSettled.current;
      const now = performance.now() / 1000;
      const quick = Math.floor(now / QUICK_TICK_SECONDS);
      const infantry = Math.floor(now / INFANTRY_IDLE_TICK_SECONDS);
      const flags = getDrawFlags();
      const frameChanged = flags.anims && flags.figures && settled && (quick !== lastQuick || infantry !== lastInfantry);
      if (frameChanged) {
        lastQuick = quick;
        lastInfantry = infantry;
      }
      // A figure was waiting on its picture and the file has arrived.
      const arrived = flags.figures && flags.sheet && settled && takeFigureSheetDirty();
      if (warningId !== "") {
        refreshArrowsRef.current();
      }
      if (!frameChanged && !arrived) {
        return;
      }
      const canvas = canvasRef.current;
      const hold = terrainHold.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx || !hold || !frame) {
        return;
      }
      if (hold.width !== canvas.width || hold.height !== canvas.height) {
        return;
      }
      const idleStarted = performance.now();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(hold, 0, 0);
      if (settled) {
        const scars = (frame.scene.backdrop ? [] : (live.current.props.relief?.scars ?? [])).flatMap((scar) => {
          const region = frame.scene.regions.find((item) => item.id === scar.regionId);
          if (!region || region.type !== "land") {
            return [];
          }
          const slots = effectiveUnitSlots(region, frame.scene.shapes?.get(region.id) ?? roughShape(region));
          return battleScarDescriptors(region.id, region.anchor, [region.anchor, ...slots], scar.ember)[smokeFrame(now * 1000)];
        });
        beginCampaignFigures();
        drawGameOverlay(ctx, { ...frame.scene, scars }, {
          ...frame.overlay,
          idleTime: frameChanged ? now : frame.overlay.idleTime,
        });
        paintCampaignVectors(
          frame.scene.dpr,
          frame.scene.width,
          frame.scene.height,
          frame.scene.unitFade ?? 1,
          frame.scene,
        );
        noteIdle(performance.now() - idleStarted);
      }
      live.current.props.board?.touch();
    };
    const id = window.setInterval(tick, 125);
    return () => window.clearInterval(id);
  }, [mapLod]);

  /** A pointer's world point folded onto the primary copy of the wrapped world, for picking regions. */
  const pickWorld = (w: Vec2): Vec2 => (live.current.wrap ? { x: wrapWorldX(w.x, live.current.bounds), y: w.y } : w);

  const pickUnit = (ls: RegionLayout[], sp: Vec2) => {
    const { tokenHitPx: hit, uprightReach: reach } = live.current;
    // The upright picture is wider and taller than the token, and a squad stands out to either side.
    return reach > 0 ? pickFrontCounter(ls, sp, Math.max(hit, 48), Math.max(reach, 52)) : pickCounter(ls, sp, hit);
  };

  /** Transport circles, front to back. The token size matches the hit radius the overlay was drawn with. */
  const holdShips = (ls: RegionLayout[]): HoldShip[] => {
    const { tokenHitPx, uprightReach, props } = live.current;
    const d = Math.max(1, (tokenHitPx - 4) * 2);
    const upright = uprightReach > 0;
    const ships: HoldShip[] = [];
    for (const layout of ls) {
      for (const counter of layout.counters) {
        const entry = counter.slot.entry;
        if (entry.unit_type_id !== "transport" || !entry.instance_id) {
          continue;
        }
        const marks = props.holdFor?.(layout.region.id, entry) ?? null;
        if (marks == null) {
          continue;
        }
        ships.push({
          regionId: layout.region.id,
          entry,
          x: counter.x,
          y: counter.y,
          d,
          upright,
          marks,
        });
      }
    }
    return ships;
  };

  /** The ship under the pointer when its region is the drop target, otherwise the token there. */
  const shipUnder = (ls: RegionLayout[], sp: Vec2, target: string): StackEntry | null => {
    const hold = pickHold(holdShips(ls), sp.x, sp.y);
    if (hold && hold.ship.regionId === target) {
      return hold.ship.entry;
    }
    const token = pickUnit(ls, sp);
    if (token && token.counter.regionId === target) {
      return token.counter.slot.entry;
    }
    return null;
  };
  const shipUnderRef = useRef(shipUnder);
  shipUnderRef.current = shipUnder;

  const pointer = (e: { clientX: number; clientY: number }): Vec2 => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (cameraLock.current) {
        return;
      }
      const pulling = unitRef.current;
      if (pulling) {
        pulling.wheel += e.deltaY;
        let changed = false;
        while (pulling.wheel >= WHEEL_STEP) {
          pulling.wheel -= WHEEL_STEP;
          const next = clampMoveCount(pulling.count - 1, pulling.max);
          changed = changed || next !== pulling.count;
          pulling.count = next;
        }
        while (pulling.wheel <= -WHEEL_STEP) {
          pulling.wheel += WHEEL_STEP;
          const next = clampMoveCount(pulling.count + 1, pulling.max);
          changed = changed || next !== pulling.count;
          pulling.count = next;
        }
        if (changed) {
          pulling.adjusted = true;
          soundManager.play("split_wheel_tick");
          if (pulling.moved) {
            setGesture({ ...pulling, pointer: { ...pulling.pointer }, originWorld: { ...pulling.originWorld } });
            live.current.props.onDragCount?.(pulling.count);
          }
        }
        return;
      }
      userMoved.current = true;
      const zoom = wheelZoom.current;
      const { fitK, view } = live.current;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const minK = fitK * MIN_ZOOM_FACTOR;
      const maxK = maxZoomK(fitK, dpr);
      const baseK = zoom.active ? zoom.targetK : view.k;
      bakeSettleRef.current.abort();
      needsBakeSettle.current = true;
      zoom.targetK = Math.min(maxK, Math.max(minK, baseK * wheelZoomFactor(e.deltaY, e.deltaMode)));
      zoom.anchorScreen = p;
      zoom.anchorWorld = screenToWorld(view, p);
      zoom.active = true;
      if (zoom.raf !== 0) {
        return;
      }
      zoom.lastFrame = performance.now();
      const generation = zoom.generation;
      const step = (now: number) => {
        const state = wheelZoom.current;
        if (state.generation !== generation || cameraLock.current || !state.active) {
          state.raf = 0;
          return;
        }
        const current = live.current;
        const dt = now - state.lastFrame;
        state.lastFrame = now;
        const liveView = current.view;
        const dprNow = window.devicePixelRatio || 1;
        let nextK = dampZoomK(liveView.k, state.targetK, dt);
        if (Math.abs(state.targetK - liveView.k) < ZOOM_EPSILON || Math.abs(state.targetK - nextK) < ZOOM_EPSILON) {
          nextK = state.targetK;
        }
        const stepFactor = liveView.k > 0 ? nextK / liveView.k : 1;
        let zoomed = zoomAt(liveView, state.anchorScreen, stepFactor, current.fitK, dprNow);
        if (current.wrap) {
          zoomed = wrapView(zoomed, current.size.w, current.bounds);
        }
        setView(zoomed);
        if (Math.abs(state.targetK - zoomed.k) < ZOOM_EPSILON) {
          state.active = false;
          state.raf = 0;
          state.settledAt = performance.now();
          bakeSettleRef.current.schedule();
          return;
        }
        state.raf = requestAnimationFrame(step);
      };
      zoom.raf = requestAnimationFrame(step);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      const zoom = wheelZoom.current;
      zoom.generation += 1;
      if (zoom.raf !== 0) {
        cancelAnimationFrame(zoom.raf);
      }
      zoom.raf = 0;
      window.clearTimeout(zoom.bakeTimer);
      const pan = panGlide.current;
      if (pan.raf !== 0) {
        cancelAnimationFrame(pan.raf);
        pan.raf = 0;
      }
    };
  }, []);

  const publishGesture = (g: UnitGesture) => {
    setGesture({ ...g, pointer: { ...g.pointer }, originWorld: { ...g.originWorld }, legal: g.legal });
  };

  const clearGesture = () => {
    unitRef.current = null;
    if (drag.current?.kind === "unit") {
      drag.current = null;
    }
    setGesture(null);
  };

  const armGesture = (g: UnitGesture) => {
    if (g.armed) {
      return;
    }
    g.armed = true;
    g.moved = true;
    const propsNow = live.current.props;
    if (g.group && g.group.length > 0) {
      for (const item of g.group) {
        propsNow.onArmDrag?.(g.regionId, item.entry, item.count);
      }
      let shared: string[] | null = null;
      for (const item of g.group) {
        const next = propsNow.legalMovesFor?.(g.regionId, item.entry) ?? [];
        shared = shared == null ? [...next] : shared.filter((id) => next.includes(id));
      }
      g.legal = shared ?? [];
      return;
    }
    propsNow.onArmDrag?.(g.regionId, g.entry, g.count);
    g.legal = propsNow.legalMovesFor?.(g.regionId, g.entry) ?? g.legal;
    const max = propsNow.movableMax?.(g.regionId, g.entry);
    if (max != null && max > 0) {
      g.max = max;
      g.count = Math.min(g.count, max);
    }
  };

  /** A press that did not travel: the same as a click before dragging existed. */
  const resolveClick = (e: { clientX: number; clientY: number; shiftKey?: boolean }) => {
    const sp = pointer(e);
    const { view: v, layouts: ls, paths: ps, props: p, exact: ex, only: layer, plusHitPx: plusHit } = live.current;
    const world = screenToWorld(v, sp);
    if (p.editor) {
      p.editor.onClick(world, pickRegion(p.geometry.regions, ps, p.land, pickWorld(world), ex, layer), SNAP_PX / v.k, {
        shift: e.shiftKey ?? false,
      });
      return;
    }
    const id = pickRegion(p.geometry.regions, ps, p.land, pickWorld(world), ex);
    const armed = p.highlight.kind === "move" ? p.highlight : null;
    if (p.captureClick) {
      if (id !== "") {
        p.onRegionClick(id);
      } else {
        p.onBackgroundClick?.();
      }
      return;
    }
    if (armed && id !== "" && id !== armed.from && armed.legal.includes(id)) {
      p.onRegionClick(id);
      return;
    }
    const plus = pickPlus(ls, sp, plusHit);
    if (plus) {
      p.onOpenInspector?.(plus.region.id);
      return;
    }
    const hold = pickHold(holdShips(ls), sp.x, sp.y);
    if (hold) {
      const entry = hold.mark ? seatStack(hold.mark) : hold.ship.entry;
      p.onStackClick(hold.ship.regionId, entry, stackKey(entry));
      return;
    }
    const picked = pickUnit(ls, sp);
    if (picked) {
      if (picked.layout.capped) {
        p.onOpenInspector?.(picked.counter.regionId);
        return;
      }
      p.onStackClick(picked.counter.regionId, picked.counter.slot.entry, picked.counter.slot.key);
      return;
    }
    if (id !== "") {
      p.onRegionClick(id);
      return;
    }
    p.onBackgroundClick?.();
  };

  /** Capture can throw when the pointer is already gone (a quick touchpad tap). The gesture still works. */
  const capturePointer = (pointerId: number) => {
    try {
      canvasRef.current?.setPointerCapture(pointerId);
    } catch {
      // Without capture, moves outside the canvas end the gesture at pointerleave.
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    soundManager.unlock();
    const editor = live.current.props.editor;
    const latticeTool = editor?.overlay.tool === "lattice" && editor.overlay.layer === "sea";
    const latticeButton = latticeTool && (e.button === 0 || e.button === 2);
    if (cameraLock.current) {
      return;
    }
    if (e.button !== 0 && e.button !== 1 && !latticeButton) {
      return;
    }
    if (e.button === 1) {
      e.preventDefault();
    }
    if (splitRef.current && !(e.target as HTMLElement).closest?.(".split-popover")) {
      soundManager.play("order_cancel");
      setSplit(null);
      live.current.props.onDragCancel?.();
    }
    const sp = pointer(e);
    const { view: v, layouts: ls, paths: ps, props: p, plusHitPx: plusHit, exact: ex, only: layer } = live.current;
    const ed = p.editor;
    const from = screenToWorld(v, sp);
    if (latticeButton && ed) {
      e.preventDefault();
      const erase = e.button === 2 || e.altKey;
      const under = pickRegion(p.geometry.regions, ps, p.land, pickWorld(from), ex, layer ?? "sea");
      const started = ed.onLattice?.(from, { erase, shift: e.shiftKey, done: false, underId: under }) === true;
      if (started) {
        drag.current = { kind: "lattice", erase };
        capturePointer(e.pointerId);
        return;
      }
    }
    const handle = ed?.pickHandle(from, HANDLE_PX / v.k) ?? null;
    if (handle !== null) {
      drag.current = { kind: "handle", handle };
    } else if (ed?.swipeable() && !e.altKey) {
      // Knife: dragging draws the cut. Alt-drag still pans.
      drag.current = { kind: "swipe", from, points: [], moved: false, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY };
    } else if (!ed && pickPlus(ls, sp, plusHit) === null) {
      const hold = pickHold(holdShips(ls), sp.x, sp.y);
      const seat = hold?.mark ? seatStack(hold.mark) : null;
      const picked = seat ? null : pickUnit(ls, sp);
      const entry = seat ?? picked?.counter.slot.entry ?? null;
      const regionId = seat ? hold!.ship.regionId : (picked?.counter.regionId ?? "");
      const origin = seat ? { x: hold!.ship.x, y: hold!.ship.y } : picked ? { x: picked.counter.x, y: picked.counter.y } : null;
      const max = entry ? (p.movableMax?.(regionId, entry) ?? 0) : 0;
      if (entry && origin && max > 0) {
        const slotWorld = screenToWorld(v, origin);
        const originWorld = {
          x: live.current.wrap ? wrapWorldX(slotWorld.x, live.current.bounds) : slotWorld.x,
          y: slotWorld.y,
        };
        const next: UnitGesture = {
          regionId,
          key: stackKey(entry),
          entry,
          originWorld,
          max,
          count: seat ? 1 : max,
          adjusted: false,
          moved: false,
          armed: false,
          pointer: sp,
          legal: p.legalMovesFor?.(regionId, entry) ?? [],
          startX: e.clientX,
          startY: e.clientY,
          wheel: 0,
        };
        unitRef.current = next;
        drag.current = { kind: "unit" };
      } else {
        drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, view: v, moved: false };
        abortBakeSettle();
      }
    } else {
      drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, view: v, moved: false };
      abortBakeSettle();
    }
    capturePointer(e.pointerId);
  };

  const refreshArrows = () => {
    const frame = spriteFrame.current;
    const arrows = arrowRef.current;
    const ctx = arrows?.getContext("2d");
    if (!frame || !arrows || !ctx) {
      return;
    }
    const { scene } = frame;
    const pixelW = Math.round(scene.width * scene.dpr);
    const pixelH = Math.round(scene.height * scene.dpr);
    if (arrows.width !== pixelW || arrows.height !== pixelH) {
      arrows.width = pixelW;
      arrows.height = pixelH;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, arrows.width, arrows.height);
    live.current.props.board?.touch();
    if (!getDrawFlags().arrows) {
      return;
    }
    const movement = live.current.props.movement;
    const layouts = frame.overlay.layouts;
    const planned =
      movement && movement.orders.length > 0
        ? drawOperationalArrows(ctx, scene, movement.phase, movement.orders, movement.regionIds, layouts)
        : [];
    const pulled = unitRef.current;
    if (pulled?.moved) {
      const from = guideOriginScreen(pulled.originWorld, pulled.pointer, scene.view, live.current.bounds, true);
      drawMoveGuide(ctx, scene.dpr, from, pulled.pointer, factionPalette(pulled.entry.faction_id).ring);
    }
    if (movement && planned.some((arrow) => arrow.battle)) {
      drawBattleIcons(ctx, scene, planned, movement.orders);
    }
    if (movement && planned.some((arrow) => !arrow.battle)) {
      drawFootIcons(ctx, scene, planned, movement.orders);
    }
    const icons = live.current.props.battleIcons;
    if (icons && icons.length > 0) {
      drawStandingBattleIcons(ctx, scene, icons);
    }
    drawHoverMark(ctx, scene, hoverRef.current);
    if (frame.warningRegionId !== "") {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
      strokeWarningRing(ctx, scene.dpr, frame.overlay.layouts, frame.warningRegionId, pulse);
    }
  };
  refreshArrowsRef.current = refreshArrows;

  const onPointerMove = (e: React.PointerEvent) => {
    const sp = pointer(e);
    const { view: v, layouts: ls, paths: ps, props: p, exact: ex, only: layer } = live.current;
    const world = screenToWorld(v, sp);
    const d = drag.current;
    if (d?.kind === "lattice") {
      p.editor?.onLattice?.(world, { erase: d.erase, shift: e.shiftKey, done: false });
      canvasRef.current!.style.cursor = "crosshair";
      return;
    }
    if (d?.kind === "handle") {
      p.editor?.onDrag(d.handle, world, SNAP_PX / v.k);
      return;
    }
    if (d?.kind === "swipe") {
      if (!d.moved) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < STROKE_START_PX) {
          return;
        }
        d.moved = true;
        d.points = [d.from];
        p.editor?.strokeBegin();
      }
      if (Math.hypot(e.clientX - d.lastX, e.clientY - d.lastY) >= STROKE_STEP_PX) {
        d.lastX = e.clientX;
        d.lastY = e.clientY;
        d.points.push(world);
        p.editor?.onStroke(d.points, 1 / v.k, false);
      }
      return;
    }
    if (d?.kind === "unit") {
      const g = unitRef.current;
      if (!g) {
        return;
      }
      g.pointer = sp;
      const id = pickRegion(p.geometry.regions, ps, p.land, pickWorld(world), ex, layer);
      if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) >= DRAG_THRESHOLD_PX) {
        armGesture(g);
        waypointRegion.current = id;
      }
      if (g.moved && id !== waypointRegion.current) {
        const left = waypointRegion.current;
        waypointRegion.current = id;
        if (left !== "" && id !== "") {
          const regions = p.geometry.regions;
          const origin = regions.find((region) => region.id === g.regionId);
          const hovered = regions.find((region) => region.id === id);
          const distance =
            origin && hovered ? anchorSpan(origin.anchor, hovered.anchor, live.current.bounds, live.current.wrap) : 0;
          soundManager.play("waypoint_tick", { step: dragPitchStep(distance), stepPitchOffset: DRAG_PITCH_OFFSET });
        }
      }
      waypointRegion.current = id;
      hoverRef.current = "";
      p.onRegionHover(id);
      if (g.moved) {
        publishGesture(g);
      }
      canvasRef.current!.style.cursor = "grabbing";
      return;
    }
    if (d?.kind === "pan") {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
        return;
      }
      d.moved = true;
      userMoved.current = true;
      needsBakeSettle.current = true;
      abortBakeSettle();
      const panned = panView(d.view, dx, dy);
      const next = live.current.wrap ? wrapView(panned, live.current.size.w, live.current.bounds) : panned;
      const pan = panGlide.current;
      pan.next = next;
      pan.dirty = true;
      if (pan.raf === 0) {
        pan.raf = requestAnimationFrame(() => {
          pan.raf = 0;
          if (!pan.dirty || !pan.next) {
            return;
          }
          pan.dirty = false;
          const viewNow = pan.next;
          pan.next = null;
          setView(viewNow);
        });
      }
      return;
    }
    if (p.editor) {
      p.editor.onHover(world, SNAP_PX / v.k);
    }
    const id = pickRegion(p.geometry.regions, ps, p.land, pickWorld(world), ex, layer);
    if (hoverRef.current !== id) {
      hoverRef.current = id;
      refreshArrows();
    }
    if (!p.editor) {
      p.onRegionHover(id);
    }
    const picked = pickUnit(ls, sp);
    const overPlus = pickPlus(ls, sp, live.current.plusHitPx) !== null;
    const nextHover = picked
      ? { regionId: picked.counter.regionId, key: picked.counter.slot.key, copyDx: picked.layout.copyDx }
      : null;
    setHoverStack((prev) =>
      prev?.regionId === nextHover?.regionId && prev?.key === nextHover?.key && prev?.copyDx === nextHover?.copyDx ? prev : nextHover,
    );
    const sculptAim = p.editor?.overlay.sculpt?.tool;
    const aiming =
      p.editor?.overlay.tool === "knife" ||
      p.editor?.overlay.tool === "draw" ||
      p.editor?.overlay.tool === "lattice" ||
      sculptAim === "pen" ||
      sculptAim === "blob";
    canvasRef.current!.style.cursor = aiming ? "crosshair" : overPlus || picked !== null || id !== "" ? "pointer" : "default";
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) {
      return;
    }
    const { view: v, paths: ps, props: p, exact: ex } = live.current;
    if (d.kind === "lattice") {
      const end = screenToWorld(v, pointer(e));
      p.editor?.onLattice?.(end, { erase: d.erase, shift: e.shiftKey, done: true });
      return;
    }
    if (d.kind === "handle") {
      p.editor?.onDragEnd(d.handle);
      return;
    }
    if (d.kind === "swipe" && d.moved) {
      const end = screenToWorld(v, pointer(e));
      const last = d.points[d.points.length - 1];
      if (!last || Math.hypot(end.x - last.x, end.y - last.y) * v.k >= 1) {
        d.points.push(end);
      }
      p.editor?.onStroke(d.points, 1 / v.k, true);
      return;
    }
    if (d.kind === "swipe") {
      // Not dragged far enough: a plain click.
      resolveClick(e);
      return;
    }
    if (d.kind === "unit") {
      const g = unitRef.current;
      const sp = pointer(e);
      clearGesture();
      if (!g || !g.moved) {
        resolveClick(e);
        return;
      }
      const { layouts: ls } = live.current;
      const world = screenToWorld(v, sp);
      const id = pickRegion(p.geometry.regions, ps, p.land, pickWorld(world), ex);
      const result = finishUnitDrag(
        { regionId: g.regionId, max: g.max, count: g.count, adjusted: g.adjusted, legal: g.legal },
        id,
      );
      if (result.type === "cancel") {
        if (g.armed) {
          soundManager.play("order_cancel");
          p.onDragCancel?.();
        }
        return;
      }
      if (result.type === "commit") {
        if (g.group && g.group.length > 0) {
          for (const item of g.group) {
            p.onDropMove?.(g.regionId, item.entry, result.target, item.count, shipUnder(ls, sp, result.target));
          }
          return;
        }
        askOrDrop(g.regionId, g.entry, result.target, result.count, shipUnder(ls, sp, result.target), sp.x, sp.y);
        return;
      }
      setSplit({
        regionId: g.regionId,
        key: g.key,
        entry: g.entry,
        target: result.target,
        max: g.max,
        count: result.count,
        x: sp.x,
        y: sp.y,
        legal: g.legal,
      });
      return;
    }
    if (d.kind === "pan") {
      const flushed = flushPanView();
      if (d.moved) {
        commitTunerCenter(flushed ?? undefined);
        scheduleBakeSettle();
        suppressClick.current = true;
        setTimeout(() => {
          suppressClick.current = false;
        }, 0);
        return;
      }
      scheduleBakeSettle();
    }
    if (d.moved) {
      suppressClick.current = true;
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      return;
    }
    resolveClick(e);
  };

  useEffect(() => {
    props.registerDropResolver?.((clientX, clientY) => {
      const canvas = canvasRef.current;
      const { view: v, paths: ps, props: p, exact: ex } = live.current;
      if (!canvas) {
        return "";
      }
      const rect = canvas.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        return "";
      }
      const world = screenToWorld(v, { x: clientX - rect.left, y: clientY - rect.top });
      return pickRegion(p.geometry.regions, ps, p.land, pickWorld(world), ex);
    });
  }, [props.registerDropResolver]);

  useEffect(() => {
    const canvasPoint = (clientX: number, clientY: number): Vec2 | null => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return null;
      }
      const rect = canvas.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };
    const originFor = (regionId: string, key: string): Vec2 => {
      const { layouts, view, props: p } = live.current;
      const layout = layouts.find((item) => item.region.id === regionId && item.copyDx === 0);
      const counter = key === "" ? undefined : layout?.counters.find((item) => item.slot.key === key);
      if (counter) {
        return screenToWorld(view, { x: counter.x, y: counter.y });
      }
      return p.geometry.regions.find((region) => region.id === regionId)?.anchor ?? { x: 0, y: 0 };
    };
    const release = (clientX: number, clientY: number) => {
      const g = unitRef.current;
      const point = canvasPoint(clientX, clientY);
      clearGesture();
      const p = live.current.props;
      if (!g || !point || !g.moved) {
        if (g?.armed) {
          p.onDragCancel?.();
        }
        return;
      }
      const { view: v, paths: ps, exact: ex, layouts: ls } = live.current;
      const world = screenToWorld(v, point);
      const id = pickRegion(p.geometry.regions, ps, p.land, live.current.wrap ? { x: wrapWorldX(world.x, live.current.bounds), y: world.y } : world, ex);
      const result = finishUnitDrag(
        { regionId: g.regionId, max: g.max, count: g.count, adjusted: g.adjusted, legal: g.legal },
        id,
      );
      if (result.type === "cancel") {
        soundManager.play("order_cancel");
        p.onDragCancel?.();
        return;
      }
      if (result.type === "commit") {
        if (g.group && g.group.length > 0) {
          for (const item of g.group) {
            p.onDropMove?.(g.regionId, item.entry, result.target, item.count, shipUnderRef.current(ls, point, result.target));
          }
          return;
        }
        askOrDrop(g.regionId, g.entry, result.target, result.count, shipUnderRef.current(ls, point, result.target), point.x, point.y);
      }
    };
    props.registerMoveDrag?.({
      start(spec) {
        const point = canvasPoint(spec.clientX, spec.clientY);
        if (!point || spec.count <= 0) {
          return;
        }
        const originWorld = originFor(spec.regionId, spec.group ? "" : stackKey(spec.entry));
        const next: UnitGesture = {
          regionId: spec.regionId,
          key: stackKey(spec.entry),
          entry: spec.entry,
          originWorld: {
            x: live.current.wrap ? wrapWorldX(originWorld.x, live.current.bounds) : originWorld.x,
            y: originWorld.y,
          },
          max: spec.count,
          count: spec.count,
          adjusted: true,
          moved: false,
          armed: false,
          pointer: point,
          legal: [],
          startX: spec.clientX,
          startY: spec.clientY,
          wheel: 0,
          group: spec.group,
        };
        unitRef.current = next;
        drag.current = { kind: "unit" };
        armGesture(next);
        if (next.group && next.legal.length === 0) {
          clearGesture();
          live.current.props.onDragCancel?.();
          return;
        }
        publishGesture(next);
      },
      move(clientX, clientY) {
        const g = unitRef.current;
        const point = canvasPoint(clientX, clientY);
        if (!g || !point) {
          return;
        }
        g.pointer = point;
        const { view, paths, props: p, exact } = live.current;
        const world = screenToWorld(view, point);
        const id = pickRegion(
          p.geometry.regions,
          paths,
          p.land,
          live.current.wrap ? { x: wrapWorldX(world.x, live.current.bounds), y: world.y } : world,
          exact,
        );
        waypointRegion.current = id;
        if (hoverRef.current !== id) {
          hoverRef.current = id;
          refreshArrows();
        }
        p.onRegionHover(id);
        publishGesture(g);
      },
      end(clientX, clientY) {
        release(clientX, clientY);
      },
    });
    return () => props.registerMoveDrag?.(null);
  }, [props.registerMoveDrag]);

  const onDoubleClick = (e: React.MouseEvent) => {
    const { view: v, props: p } = live.current;
    p.editor?.onDoubleClick(screenToWorld(v, pointer(e)), SNAP_PX / v.k);
  };

  /** A touchpad or the OS can cancel a press without a pointerup. A lattice stroke still commits. */
  const onPointerCancel = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d?.kind !== "lattice") {
      return;
    }
    drag.current = null;
    const { view: v, props: p } = live.current;
    p.editor?.onLattice?.(screenToWorld(v, pointer(e)), { erase: d.erase, shift: e.shiftKey, done: true });
  };

  const onPointerLeave = (e: React.PointerEvent) => {
    if (drag.current?.kind === "lattice" && !canvasRef.current?.hasPointerCapture(e.pointerId)) {
      onPointerCancel(e);
    }
    if (unitRef.current) {
      return;
    }
    hoverRef.current = "";
    refreshArrows();
    setHoverStack(null);
    live.current.props.onRegionHover("");
    live.current.props.editor?.onHover(null, 0);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT";
      if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "z" || e.key === "Z")) {
        const params = new URLSearchParams(window.location.search);
        if (params.get("bake") === "1" || params.get("field") === "1" || live.current.props.inBattle || isTextField(e.target)) {
          return;
        }
        e.preventDefault();
        setTuneOpen((open) => {
          if (!open) {
            commitTunerCenter();
          }
          return !open;
        });
        return;
      }
      if (e.key === "Escape") {
        if (splitRef.current) {
          splitRef.current = null;
          setSplit(null);
          live.current.props.onDragCancel?.();
          return;
        }
        if (unitRef.current) {
          const armed = unitRef.current.armed;
          clearGesture();
          if (armed) {
            live.current.props.onDragCancel?.();
          }
        }
        return;
      }
      const g = unitRef.current;
      if (!g || typing || e.key < "1" || e.key > "9") {
        return;
      }
      e.preventDefault();
      const nextCount = clampMoveCount(Number(e.key), g.max);
      if (nextCount !== g.count) soundManager.play("split_wheel_tick");
      g.count = nextCount;
      g.adjusted = true;
      if (g.moved) {
        publishGesture(g);
        live.current.props.onDragCount?.(g.count);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (split) {
      splitPanel.current?.focus();
    }
  }, [split?.regionId, split?.target, split?.x, split?.y]);

  useEffect(() => {
    if (bombard) {
      bombardPanel.current?.focus();
    }
  }, [bombard?.regionId, bombard?.target, bombard?.listing]);

  const confirmSplit = () => {
    const s = splitRef.current;
    if (!s) {
      return;
    }
    splitRef.current = null;
    setSplit(null);
    askOrDrop(s.regionId, s.entry, s.target, s.count, null, s.x, s.y);
  };

  const cancelSplit = () => {
    if (!splitRef.current) {
      return;
    }
    soundManager.play("order_cancel");
    splitRef.current = null;
    setSplit(null);
    live.current.props.onDragCancel?.();
  };

  let hoverChip: { x: number; y: number; label: string } | null = null;
  if (mapLod === 2 && hoverStack) {
    for (const layout of layouts) {
      if (layout.region.id !== hoverStack.regionId || layout.copyDx !== hoverStack.copyDx) {
        continue;
      }
      const counter = layout.counters.find((item) => item.slot.key === hoverStack.key);
      if (!counter) {
        continue;
      }
      const entry = counter.slot.entry;
      hoverChip = {
        x: counter.x,
        y: counter.y - 46,
        label: props.unitTitle?.(entry) ?? unitLabel(entry.unit_type_id),
      };
      break;
    }
  }

  return (
    <div className="map-wrap" ref={wrapRef}>
      <div
        ref={slideRef}
        className={`map-slide${props.menuBackdrop ? " menu-drift" : ""}${!editor && props.board?.active ? " board-ground" : ""}`}
        style={
          props.menuBackdrop
            ? { left: -MENU_MARGIN_X, top: -MENU_MARGIN_Y, width: paintW, height: paintH }
            : undefined
        }
      >
      {!editor && props.board?.node}
      <canvas
        ref={canvasRef}
        className="map-canvas"
        style={{ width: paintW, height: paintH }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
        onDoubleClick={onDoubleClick}
        onContextMenu={(event) => {
          if (live.current.props.editor?.overlay.tool === "lattice") {
            event.preventDefault();
          }
        }}
      />
      <svg ref={vectorRef} className="map-vectors" aria-hidden="true" />
      <canvas ref={chromeRef} className="map-figure-chrome" style={{ width: paintW, height: paintH }} />
      <canvas ref={arrowRef} className="map-arrows" style={{ width: paintW, height: paintH }} />
      </div>
      <div className="map-controls">
        <button
          type="button"
          onClick={() => {
            stopWheelZoom();
            userMoved.current = false;
            const fitted = fitView(bounds, size.w, size.h);
            setView(fitted);
            commitTunerCenter(fitted);
          }}
        >
          Fit map
        </button>
      </div>
      {tuneOpen && <CoastTuner regions={geometry.regions} land={land} viewCenter={tunerCenter} />}
      {props.children}
      {mapLod === 2 && hoverChip && (
        <div className="unit-hover-label" style={{ left: hoverChip.x, top: hoverChip.y }}>
          {hoverChip.label}
        </div>
      )}
      {gesture?.moved && (
        <div
          className="move-drag-badge"
          style={
            {
              left: gesture.pointer.x,
              top: gesture.pointer.y,
              "--faction": factionPalette(gesture.entry.faction_id).ring,
            } as CSSProperties
          }
          aria-hidden="true"
        >
          {gesture.count}
        </div>
      )}
      {bombard && (
        <div
          ref={bombardPanel}
          className="bombard-confirm"
          style={{
            left: Math.min(Math.max(bombard.x, 8), Math.max(size.w - 220, 8)),
            top: Math.min(Math.max(bombard.y, 8), Math.max(size.h - 180, 8)),
          }}
          role="dialog"
          aria-label="Attack or bombard"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key !== "Escape") {
              return;
            }
            setBombard(null);
            soundManager.play("order_cancel");
            live.current.props.onDragCancel?.();
          }}
        >
          <p className="split-title">Confirm</p>
          <button
            type="button"
            className="primary"
            onClick={() => {
              const pending = bombard;
              setBombard(null);
              live.current.props.onDropMove?.(pending.regionId, pending.entry, pending.target, pending.count, pending.onto ?? undefined);
            }}
          >
            Attack
          </button>
          <button
            type="button"
            onClick={() => {
              if (bombard.choices.length <= 1) {
                const only = bombard.choices[0];
                const pending = bombard;
                setBombard(null);
                if (only) {
                  live.current.props.onDropBombard?.(
                    pending.regionId,
                    pending.entry,
                    pending.target,
                    pending.count,
                    only.id,
                    pending.onto ?? undefined,
                  );
                }
                return;
              }
              setBombard({ ...bombard, listing: true });
            }}
          >
            Bombard
          </button>
          {bombard.listing && (
            <div className="bombard-targets">
              {bombard.choices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  onClick={() => {
                    const pending = bombard;
                    setBombard(null);
                    live.current.props.onDropBombard?.(
                      pending.regionId,
                      pending.entry,
                      pending.target,
                      pending.count,
                      choice.id,
                      pending.onto ?? undefined,
                    );
                  }}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {split && (
        <SplitStackPopover
          panelRef={splitPanel}
          title={props.unitTitle?.(split.entry) ?? unitLabel(split.entry.unit_type_id)}
          count={split.count}
          max={split.max}
          x={split.x}
          y={split.y}
          boundsW={size.w}
          boundsH={size.h}
          onCount={(count) => {
            if (split.count !== count) soundManager.play("split_wheel_tick");
            setSplit((s) => (s ? { ...s, count } : s));
          }}
          onConfirm={confirmSplit}
          onCancel={cancelSplit}
        />
      )}
      {editor?.prunePrompt &&
        (() => {
          const { box, count, confirm, cancel } = editor.prunePrompt;
          const top = worldToScreen(view, { x: (box.minX + box.maxX) / 2, y: box.minY });
          return (
            <div
              className="prune-badge"
              style={{ left: Math.min(Math.max(top.x, 150), Math.max(size.w - 150, 150)), top: Math.max(top.y - 6, 40) }}
              role="dialog"
              aria-label="Confirm prune"
            >
              <span>
                Prune {count} small island{count === 1 ? "" : "s"} in box?
              </span>
              <button type="button" className="primary" onClick={confirm} disabled={count === 0}>
                Confirm
              </button>
              <button type="button" onClick={cancel}>
                Cancel
              </button>
            </div>
          );
        })()}
      {props.landError !== "" && <div className="map-error">Land mask not loaded: {props.landError}</div>}
    </div>
  );
}
