import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DRAG_PITCH_OFFSET, dragPitchStep, soundManager } from "../../audio/sound_manager";
import { factionPalette } from "../theme/factionPalette";
import { getTokenArtVersion, subscribeTokenArt } from "../theme/tokens/tokenArt";
import { facilityAnchorOf, type HighlightMode, type MapGeometry, type Rect, type StackEntry, type Vec2 } from "./geometry";
import { effectiveUnitSlots, roughShape, TOKEN_WORLD } from "./unitSlots";
import { buildCutterPaths, buildRegionPaths, pickCounter, pickFrontCounter, pickPlus, pickRegion } from "./hitTest";
import {
  drawBattleIcons,
  drawFootIcons,
  drawStandingBattleIcons,
  drawEditorOverlay,
  drawEditorUnits,
  drawGameOverlay,
  drawMoveGuide,
  drawOperationalArrows,
  drawTerrain,
  type EditorOverlay,
  layoutRegions,
  type RegionLayout,
  type TerrainScene,
  TOKEN_PX,
} from "./mapRenderer";
import type { OperationalOrder } from "./operationalArrows";
import { BAKE_PAINT, TerrainBake } from "./mapBake";
import { clipperFor } from "./regionClip";
import type { MasterLand } from "./svgLandLoader";
import { clampMoveCount, finishUnitDrag, guideOriginScreen } from "./moveDrag";
import { SplitStackPopover } from "./splitPopover";
import { unitLabel } from "./unitStacks";
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
  screenToWorld,
  tiltFactor,
  type View,
  visibleCopies,
  worldTokenPx,
  worldToScreen,
  anchorSpan,
  wrapView,
  wrapWorldX,
  zoomAt,
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
  /** Drop committed: move `count` of the stack onto `target`. */
  onDropMove?(regionId: string, entry: StackEntry, target: string, count: number): void;
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
}

const DRAG_THRESHOLD_PX = 4;
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
  | { kind: "swipe"; from: Vec2; points: Vec2[]; moved: boolean; startX: number; startY: number; lastX: number; lastY: number };

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

/** One wheel notch. Smaller trackpad deltas accumulate until they cross this. */
const WHEEL_STEP = 40;

export function MapView(props: MapViewProps) {
  const { geometry, land, editor } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arrowRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [hoverId, setHoverId] = useState("");
  const [hoverStack, setHoverStack] = useState<{ regionId: string; key: string; copyDx: number } | null>(null);
  const [warningPulse, setWarningPulse] = useState(0);
  useEffect(() => {
    if (!props.warningRegionId) {
      return;
    }
    const id = window.setInterval(() => setWarningPulse((n) => n + 1), 90);
    return () => window.clearInterval(id);
  }, [props.warningRegionId]);
  const [gesture, setGesture] = useState<UnitGesture | null>(null);
  const [split, setSplit] = useState<SplitPrompt | null>(null);
  const unitRef = useRef<UnitGesture | null>(null);
  const splitRef = useRef<SplitPrompt | null>(null);
  splitRef.current = split;
  const splitPanel = useRef<HTMLDivElement>(null);
  useSyncExternalStore(subscribeTokenArt, getTokenArtVersion); // counters repaint when their art changes

  const bounds: Rect = land?.viewBox ?? (geometry.bounds.w > 0 ? geometry.bounds : WORLD_FALLBACK);
  const fitK = size.w > 0 ? fitView(bounds, size.w, size.h).k : 1;
  const userMoved = useRef(false);
  const lodHold = useRef<MapLod>(0);
  const spriteGate = useRef<MapLod | null>(null);
  const spriteFade = useRef<{ toSprites: boolean; start: number } | null>(null);
  const [spriteClock, setSpriteClock] = useState(0);
  const cameraLock = useRef(false);
  const cameraJob = useRef<{ cancel: () => void } | null>(null);
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
  const copies = visibleCopies(view, size.w, bounds, wrap);
  const layouts = copies.flatMap((dx) =>
    layoutRegions(geometry.regions, props.stacks, { ...view, x: view.x - dx }, unitScale, {
      slotsFor,
      categories: props.unitCategories,
      copyDx: dx,
    }),
  );
  const bakeRef = useRef<{ rev: number; bake: TerrainBake } | null>(null);
  if (bakeRef.current?.rev !== BAKE_PAINT) {
    bakeRef.current = { rev: BAKE_PAINT, bake: new TerrainBake() };
  }
  const scarCount = props.relief?.scars.length ?? 0;
  const [scarNow, setScarNow] = useState(0);
  useEffect(() => {
    soundManager.updateAmbience(tiltFactor(view.k), props.inBattle === true);
  }, [view.k, props.inBattle]);

  useEffect(() => {
    if (scarCount === 0 || props.suspended) {
      return;
    }
    const tick = () => setScarNow(performance.now());
    tick();
    const id = window.setInterval(tick, 220);
    return () => window.clearInterval(id);
  }, [scarCount > 0, props.suspended]);

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
  useEffect(() => {
    if (size.w > 0 && !userMoved.current) {
      setView(fitView(bounds, size.w, size.h));
    }
  }, [size.w, size.h, bounds.x, bounds.y, bounds.w, bounds.h]);

  useEffect(() => {
    const api: MapCamera = {
      snapshot() {
        const { view: current, fitK: fitted, size: canvas } = live.current;
        return { view: { ...current }, fitK: fitted, width: canvas.w, height: canvas.h };
      },
      moveTo(goal, ms) {
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
            const k = fromK + (goal.k - fromK) * e;
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
    if (props.suspended) {
      return;
    }
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || size.w === 0) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const pixelW = Math.round(size.w * dpr);
    const pixelH = Math.round(size.h * dpr);
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    // The cached base map: rebuilt only when the geometry, an owner or the needed resolution changes.
    const baked = bakeRef.current!.bake.ensure(
      { bounds, land, regions: geometry.regions, paths, shapes: clipped, exact, owners: props.owners },
      view.k * dpr,
    );
    const moveTone = props.movement?.phase === "noncombat_move" ? "move" : "attack";
    const dragHighlight: HighlightMode | null = gesture?.moved
      ? { kind: "move", from: gesture.regionId, legal: gesture.legal, hover: hoverId, tone: moveTone }
      : split
        ? { kind: "move", from: split.regionId, legal: split.legal, hover: split.target, tone: moveTone }
        : null;
    const scene: TerrainScene = {
      baked,
      bounds,
      copies,
      width: size.w,
      height: size.h,
      dpr,
      view,
      land,
      regions: geometry.regions,
      paths,
      exact,
      owners: props.owners,
      highlight: dragHighlight ?? props.highlight,
      selectedRegionId: props.selectedRegionId,
      hoverRegionId: hoverId,
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
      scars: editor
        ? []
        : (props.relief?.scars ?? []).flatMap((scar) => {
            const region = geometry.regions.find((item) => item.id === scar.regionId);
            if (!region || region.type !== "land") {
              return [];
            }
            const frame = smokeFrame(scarNow);
            return [
              battleScarDescriptors(region.id, region.anchor, [region.anchor, ...slotsFor(region)], scar.ember)[frame],
            ];
          }),
    };
    drawTerrain(ctx, scene);
    const overlay = {
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
      categories: props.unitCategories,
    };
    if (editor) {
      drawEditorUnits(ctx, scene, overlay);
      drawEditorOverlay(ctx, scene, { ...editor.overlay, regions: geometry.regions, paths: cutterPaths });
    } else {
      drawGameOverlay(ctx, scene, overlay);
      if (props.warningRegionId) {
        const pulse = 0.5 + 0.5 * Math.sin(warningPulse / 2);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        for (const layout of layouts) {
          if (layout.region.id !== props.warningRegionId) {
            continue;
          }
          ctx.beginPath();
          ctx.arc(layout.anchor.x, layout.anchor.y, 34 + 10 * pulse, 0, Math.PI * 2);
          ctx.lineWidth = 3;
          ctx.strokeStyle = `rgba(180, 48, 36, ${0.35 + 0.5 * pulse})`;
          ctx.stroke();
        }
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
      if (!editor) {
        const movement = props.movement;
        const planned =
          movement && movement.orders.length > 0
            ? drawOperationalArrows(arrowCtx, scene, movement.phase, movement.orders, movement.regionIds, layouts)
            : [];
        if (gesture?.moved) {
          const from = guideOriginScreen(gesture.originWorld, gesture.pointer, view, bounds, true);
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
      }
    }
  });

  /** A pointer's world point folded onto the primary copy of the wrapped world, for picking regions. */
  const pickWorld = (w: Vec2): Vec2 => (live.current.wrap ? { x: wrapWorldX(w.x, live.current.bounds), y: w.y } : w);

  const pickUnit = (ls: RegionLayout[], sp: Vec2) => {
    const { tokenHitPx: hit, uprightReach: reach } = live.current;
    return reach > 0 ? pickFrontCounter(ls, sp, hit, reach) : pickCounter(ls, sp, hit);
  };

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
      const { fitK } = live.current;
      const rect = canvas.getBoundingClientRect();
      const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      setView((v) => {
        const zoomed = zoomAt(v, p, e.deltaY > 0 ? 1 / 1.15 : 1.15, fitK);
        return live.current.wrap ? wrapView(zoomed, live.current.size.w, live.current.bounds) : zoomed;
      });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
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
    live.current.props.onArmDrag?.(g.regionId, g.entry, g.count);
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
    const plus = pickPlus(ls, sp, plusHit);
    if (plus) {
      p.onOpenInspector?.(plus.region.id);
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
    const id = pickRegion(p.geometry.regions, ps, p.land, pickWorld(world), ex);
    if (id !== "") {
      p.onRegionClick(id);
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    soundManager.unlock();
    if (e.button !== 0 || cameraLock.current) {
      return;
    }
    if (splitRef.current && !(e.target as HTMLElement).closest?.(".split-popover")) {
      soundManager.play("order_cancel");
      setSplit(null);
      live.current.props.onDragCancel?.();
    }
    const sp = pointer(e);
    const { view: v, layouts: ls, props: p, plusHitPx: plusHit } = live.current;
    const ed = p.editor;
    const handle = ed?.pickHandle(screenToWorld(v, sp), HANDLE_PX / v.k) ?? null;
    const from = screenToWorld(v, sp);
    if (handle !== null) {
      drag.current = { kind: "handle", handle };
    } else if (ed?.swipeable() && !e.altKey) {
      // Knife: dragging draws the cut. Alt-drag still pans.
      drag.current = { kind: "swipe", from, points: [], moved: false, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY };
    } else if (!ed && pickPlus(ls, sp, plusHit) === null) {
      const picked = pickUnit(ls, sp);
      const max = picked ? (p.movableMax?.(picked.counter.regionId, picked.counter.slot.entry) ?? 0) : 0;
      if (picked && max > 0) {
        const slotWorld = screenToWorld(v, { x: picked.counter.x, y: picked.counter.y });
        const originWorld = {
          x: live.current.wrap ? wrapWorldX(slotWorld.x, live.current.bounds) : slotWorld.x,
          y: slotWorld.y,
        };
        const next: UnitGesture = {
          regionId: picked.counter.regionId,
          key: picked.counter.slot.key,
          entry: picked.counter.slot.entry,
          originWorld,
          max,
          count: max,
          adjusted: false,
          moved: false,
          armed: false,
          pointer: sp,
          legal: p.legalMovesFor?.(picked.counter.regionId, picked.counter.slot.entry) ?? [],
          startX: e.clientX,
          startY: e.clientY,
          wheel: 0,
        };
        unitRef.current = next;
        drag.current = { kind: "unit" };
      } else {
        drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, view: v, moved: false };
      }
    } else {
      drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, view: v, moved: false };
    }
    canvasRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const sp = pointer(e);
    const { view: v, layouts: ls, paths: ps, props: p, exact: ex, only: layer } = live.current;
    const world = screenToWorld(v, sp);
    const d = drag.current;
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
      setHoverId((prev) => (prev === id ? prev : id));
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
      const panned = panView(d.view, dx, dy);
      setView(live.current.wrap ? wrapView(panned, live.current.size.w, live.current.bounds) : panned);
      return;
    }
    if (p.editor) {
      p.editor.onHover(world, SNAP_PX / v.k);
    }
    const id = pickRegion(p.geometry.regions, ps, p.land, pickWorld(world), ex, layer);
    setHoverId((prev) => (prev === id ? prev : id));
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
    const aiming = p.editor?.overlay.tool === "knife" || p.editor?.overlay.tool === "draw";
    canvasRef.current!.style.cursor = aiming ? "crosshair" : overPlus || picked !== null || id !== "" ? "pointer" : "default";
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) {
      return;
    }
    const { view: v, paths: ps, props: p, exact: ex } = live.current;
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
        p.onDropMove?.(g.regionId, g.entry, result.target, result.count);
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

  const onDoubleClick = (e: React.MouseEvent) => {
    const { view: v, props: p } = live.current;
    p.editor?.onDoubleClick(screenToWorld(v, pointer(e)), SNAP_PX / v.k);
  };

  const onPointerLeave = () => {
    if (unitRef.current) {
      return;
    }
    setHoverId("");
    setHoverStack(null);
    live.current.props.onRegionHover("");
    live.current.props.editor?.onHover(null, 0);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT";
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

  const confirmSplit = () => {
    const s = splitRef.current;
    if (!s) {
      return;
    }
    splitRef.current = null;
    setSplit(null);
    live.current.props.onDropMove?.(s.regionId, s.entry, s.target, s.count);
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

  return (
    <div className="map-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="map-canvas"
        style={{ width: size.w, height: size.h }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
      />
      <canvas ref={arrowRef} className="map-arrows" style={{ width: size.w, height: size.h }} />
      <div className="map-controls">
        <button
          type="button"
          onClick={() => {
            userMoved.current = false;
            setView(fitView(bounds, size.w, size.h));
          }}
        >
          Fit map
        </button>
      </div>
      {props.children}
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
