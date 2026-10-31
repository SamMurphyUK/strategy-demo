import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getTokenArtVersion, subscribeTokenArt } from "../theme/tokens/tokenArt";
import { type HighlightMode, type MapGeometry, type Rect, type StackEntry, type Vec2 } from "./geometry";
import { effectiveUnitSlots, roughShape, TOKEN_WORLD } from "./unitSlots";
import { buildCutterPaths, buildRegionPaths, pickBubble, pickCounter, pickRegion } from "./hitTest";
import {
  drawEditorOverlay,
  drawEditorUnits,
  drawGameOverlay,
  drawTerrain,
  type EditorOverlay,
  layoutRegions,
  type TerrainScene,
  TOKEN_PX,
} from "./mapRenderer";
import { TerrainBake } from "./mapBake";
import { UnitDrawer } from "./UnitDrawer";
import type { UnitDomain } from "./unitStacks";
import { clipperFor } from "./regionClip";
import type { MasterLand } from "./svgLandLoader";
import {
  fitView,
  panBy,
  screenToWorld,
  type View,
  visibleCopies,
  worldTokenPx,
  worldToScreen,
  wrapView,
  wrapWorldX,
  zoomAt,
} from "./viewMath";

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
  /** A transport with cargo aboard gets a dot on its token. */
  isLoaded?(entry: StackEntry): boolean;
  /** A unit type was picked in the drawer (the start of a drag): select it without toggling. */
  onStackPick?(regionId: string, entry: StackEntry): void;
  /** A unit type was dragged out of the drawer and dropped on a region: order the move. */
  onStackDrop?(regionId: string, entry: StackEntry, targetRegionId: string): void;
  editor?: EditorBinding;
  /** Floating controls drawn over the map (the editor toolbar). */
  children?: ReactNode;
}

const DRAG_THRESHOLD_PX = 4;
/** The knife turns a drag into a freehand stroke after this much travel, then samples every STROKE_STEP_PX. */
const STROKE_START_PX = 6;
const STROKE_STEP_PX = 3;
export const SNAP_PX = 8;
const HANDLE_PX = 10;
/** Header and padding of the unit drawer, plus 38 px a row, is how tall it gets. Decides above or below. */
const DRAWER_ESTIMATED_PX = 48;
const WORLD_FALLBACK: Rect = { x: 0, y: 0, w: 800, h: 504 };

type Drag =
  | { kind: "pan"; startX: number; startY: number; view: View; moved: boolean }
  | { kind: "handle"; handle: unknown }
  | { kind: "swipe"; from: Vec2; points: Vec2[]; moved: boolean; startX: number; startY: number; lastX: number; lastY: number };

export function MapView(props: MapViewProps) {
  const { geometry, land, editor } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [hoverId, setHoverId] = useState("");
  useSyncExternalStore(subscribeTokenArt, getTokenArtVersion); // counters repaint once their art loads

  const bounds: Rect = land?.viewBox ?? (geometry.bounds.w > 0 ? geometry.bounds : WORLD_FALLBACK);
  const fitK = size.w > 0 ? fitView(bounds, size.w, size.h).k : 1;
  const userMoved = useRef(false);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);

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
  const tokenHitPx = TOKEN_PX * unitScale * 0.5 + 4;
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
  /** The collapsed bubble whose drawer is open. Cleared by a click elsewhere, Escape, or the bubble expanding. */
  const [drawer, setDrawer] = useState<{ regionId: string; domain: UnitDomain; copyDx: number } | null>(null);
  const drawerLayout = drawer
    ? (layouts.find((l) => l.region.id === drawer.regionId && l.copyDx === drawer.copyDx) ??
      layouts.find((l) => l.region.id === drawer.regionId))
    : undefined;
  const drawerCluster = drawerLayout?.clusters.find((c) => c.collapsed && c.domain === drawer?.domain);
  useEffect(() => {
    if (drawer && !drawerCluster) {
      setDrawer(null);
    }
  }, [drawer, drawerCluster]);
  useEffect(() => {
    if (!drawer) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawer(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);
  const bakeRef = useRef<TerrainBake | null>(null);
  bakeRef.current ??= new TerrainBake();

  // Handlers read the latest values through this ref, so listeners are attached once.
  const live = useRef({ view, size, layouts, paths, props, fitK, bounds, exact, only, wrap, drawer, tokenHitPx });
  live.current = { view, size, layouts, paths, props, fitK, bounds, exact, only, wrap, drawer, tokenHitPx };

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
    const baked = bakeRef.current!.ensure(
      { bounds, land, regions: geometry.regions, paths, shapes: clipped, exact, owners: props.owners },
      view.k * dpr,
    );
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
      highlight: props.highlight,
      selectedRegionId: props.selectedRegionId,
      hoverRegionId: hoverId,
      dim: only === null ? null : only === "land" ? "sea" : "land",
    };
    drawTerrain(ctx, scene);
    const overlay = {
      layouts,
      owners: props.owners,
      selectedStack: props.selectedStack,
      isUnmoved: props.isUnmoved,
      combatMarkers: props.combatMarkers,
      unitScale,
      openDrawer: drawer,
      activeFactionId: props.activeFactionId ?? "",
      isLoaded: props.isLoaded,
      categories: props.unitCategories,
    };
    if (editor) {
      drawEditorUnits(ctx, scene, overlay);
      drawEditorOverlay(ctx, scene, { ...editor.overlay, regions: geometry.regions, paths: cutterPaths });
    } else {
      drawGameOverlay(ctx, scene, overlay);
    }
  });

  /** A pointer's world point folded onto the primary copy of the wrapped world, for picking regions. */
  const pickWorld = (w: Vec2): Vec2 => (live.current.wrap ? { x: wrapWorldX(w.x, live.current.bounds), y: w.y } : w);

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

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) {
      return;
    }
    const sp = pointer(e);
    const { view: v } = live.current;
    const ed = live.current.props.editor;
    const handle = ed?.pickHandle(screenToWorld(v, sp), HANDLE_PX / v.k) ?? null;
    const from = screenToWorld(v, sp);
    if (handle !== null) {
      drag.current = { kind: "handle", handle };
    } else if (ed?.swipeable() && !e.altKey) {
      // Knife: dragging draws the cut. Alt-drag still pans.
      drag.current = { kind: "swipe", from, points: [], moved: false, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY };
    } else {
      drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, view: v, moved: false };
    }
    canvasRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const sp = pointer(e);
    const { view: v, layouts: ls, paths: ps, props: p, exact: ex, only: layer, tokenHitPx: hit } = live.current;
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
    if (d?.kind === "pan") {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
        return;
      }
      d.moved = true;
      userMoved.current = true;
      const panned = panBy(d.view, dx, dy);
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
    const overCounter =
      !p.editor &&
      (pickBubble(ls, sp) !== null || pickCounter(ls, sp, hit) !== null);
    const aiming = p.editor?.overlay.tool === "knife" || p.editor?.overlay.tool === "draw";
    canvasRef.current!.style.cursor = aiming ? "crosshair" : overCounter || id !== "" ? "pointer" : "default";
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) {
      return;
    }
    const { view: v, layouts: ls, paths: ps, props: p, exact: ex, only: layer } = live.current;
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
      const world = screenToWorld(v, pointer(e));
      p.editor?.onClick(world, pickRegion(p.geometry.regions, ps, p.land, pickWorld(world), ex, layer), SNAP_PX / v.k, { shift: e.shiftKey });
      return;
    }
    if (d.moved) {
      suppressClick.current = true;
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      return;
    }
    const sp = pointer(e);
    const world = screenToWorld(v, sp);
    if (p.editor) {
      p.editor.onClick(world, pickRegion(p.geometry.regions, ps, p.land, pickWorld(world), ex, layer), SNAP_PX / v.k, { shift: e.shiftKey });
      return;
    }
    // A collapsed bubble opens its drawer (or closes it, on a second click).
    const bubble = pickBubble(ls, sp);
    if (bubble) {
      const { drawer: open } = live.current;
      const same =
        open?.regionId === bubble.layout.region.id && open.domain === bubble.cluster.domain && open.copyDx === bubble.layout.copyDx;
      setDrawer(same ? null : { regionId: bubble.layout.region.id, domain: bubble.cluster.domain, copyDx: bubble.layout.copyDx });
      return;
    }
    // Any other click closes the drawer, and does what it always did.
    setDrawer(null);
    const counter = pickCounter(ls, sp, live.current.tokenHitPx);
    if (counter) {
      p.onStackClick(counter.regionId, counter.slot.entry, counter.slot.key);
      return;
    }
    const id = pickRegion(p.geometry.regions, ps, p.land, pickWorld(world), ex);
    if (id !== "") {
      p.onRegionClick(id);
    }
  };

  /** A unit type dragged out of the drawer and released at this client point. */
  const dropFromDrawer = (regionId: string, entry: StackEntry, clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const { view: v, paths: ps, props: p, exact: ex } = live.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return;
    }
    const world = screenToWorld(v, { x: clientX - rect.left, y: clientY - rect.top });
    const target = pickRegion(p.geometry.regions, ps, p.land, pickWorld(world), ex);
    setDrawer(null);
    if (target !== "" && target !== regionId) {
      p.onStackDrop?.(regionId, entry, target);
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const { view: v, props: p } = live.current;
    p.editor?.onDoubleClick(screenToWorld(v, pointer(e)), SNAP_PX / v.k);
  };

  const onPointerLeave = () => {
    setHoverId("");
    live.current.props.onRegionHover("");
    live.current.props.editor?.onHover(null, 0);
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
      {!editor &&
        drawer &&
        drawerCluster &&
        (() => {
          const room = DRAWER_ESTIMATED_PX + drawerCluster.group.entries.length * 38;
          const above = drawerCluster.y - drawerCluster.bubbleRadius - 12 >= room;
          const x = Math.min(Math.max(drawerCluster.x, 110), Math.max(size.w - 110, 110));
          const y = above ? drawerCluster.y - drawerCluster.bubbleRadius - 12 : drawerCluster.y + drawerCluster.bubbleRadius + 22;
          const regionId = drawer.regionId;
          return (
            <UnitDrawer
              group={drawerCluster.group}
              x={x}
              y={y}
              placement={above ? "above" : "below"}
              selectedKey={props.selectedStack?.regionId === regionId ? props.selectedStack.key : null}
              isUnmoved={(entry) => props.isUnmoved(regionId, entry)}
              onSelect={(entry, key) => props.onStackClick(regionId, entry, key)}
              onDragStart={(entry) => props.onStackPick?.(regionId, entry)}
              onDragEnd={(entry, _key, cx, cy) => dropFromDrawer(regionId, entry, cx, cy)}
            />
          );
        })()}
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
