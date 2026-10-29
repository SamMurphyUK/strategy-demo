import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getTokenArtVersion, subscribeTokenArt } from "../theme/tokens/tokenArt";
import type { HighlightMode, MapGeometry, Rect, StackEntry, Vec2 } from "./geometry";
import { buildCutterPaths, buildRegionPaths, pickCounter, pickRegion } from "./hitTest";
import {
  drawEditorOverlay,
  drawGameOverlay,
  drawTerrain,
  type EditorOverlay,
  layoutRegions,
  setImageLoadListener,
  type TerrainScene,
} from "./mapRenderer";
import { clipperFor } from "./regionClip";
import type { MasterLand } from "./svgLandLoader";
import { fitView, panBy, screenToWorld, type View, zoomAt } from "./viewMath";

export interface CombatMarker {
  regionId: string;
  count: number;
}

/** What the map editor plugs into the canvas. All points are world coordinates. */
export interface EditorBinding {
  overlay: Omit<EditorOverlay, "regions" | "paths">;
  /** A draggable handle under the pointer (a vertex or the anchor), or null. */
  pickHandle(world: Vec2, tolWorld: number): unknown | null;
  onClick(world: Vec2, regionId: string, tolWorld: number): void;
  onDoubleClick(world: Vec2, tolWorld: number): void;
  onHover(world: Vec2 | null, tolWorld: number): void;
  onDrag(handle: unknown, world: Vec2, tolWorld: number): void;
  onDragEnd(handle: unknown): void;
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
  editor?: EditorBinding;
}

const DRAG_THRESHOLD_PX = 4;
const SNAP_PX = 8;
const HANDLE_PX = 10;
const COUNTER_HIT_PX = 18;
const WORLD_FALLBACK: Rect = { x: 0, y: 0, w: 800, h: 504 };

type Drag =
  | { kind: "pan"; startX: number; startY: number; view: View; moved: boolean }
  | { kind: "handle"; handle: unknown };

export function MapView(props: MapViewProps) {
  const { geometry, land, editor } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [hoverId, setHoverId] = useState("");
  const [, redraw] = useState(0);
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
  const layouts = layoutRegions(geometry.regions, props.stacks, view);

  // Handlers read the latest values through this ref, so listeners are attached once.
  const live = useRef({ view, size, layouts, paths, props, fitK, bounds, exact });
  live.current = { view, size, layouts, paths, props, fitK, bounds, exact };

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
    setImageLoadListener(() => redraw((n) => n + 1));
    return () => setImageLoadListener(null);
  }, []);

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
    const scene: TerrainScene = {
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
    };
    drawTerrain(ctx, scene);
    if (editor) {
      drawEditorOverlay(ctx, scene, { ...editor.overlay, regions: geometry.regions, paths: cutterPaths });
    } else {
      drawGameOverlay(ctx, scene, {
        layouts,
        owners: props.owners,
        selectedStack: props.selectedStack,
        isUnmoved: props.isUnmoved,
        combatMarkers: props.combatMarkers,
      });
    }
  });

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
      setView((v) => zoomAt(v, p, e.deltaY > 0 ? 1 / 1.15 : 1.15, fitK));
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
    drag.current =
      handle !== null
        ? { kind: "handle", handle }
        : { kind: "pan", startX: e.clientX, startY: e.clientY, view: v, moved: false };
    canvasRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const sp = pointer(e);
    const { view: v, layouts: ls, paths: ps, props: p, exact: ex } = live.current;
    const world = screenToWorld(v, sp);
    const d = drag.current;
    if (d?.kind === "handle") {
      p.editor?.onDrag(d.handle, world, SNAP_PX / v.k);
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
      setView(panBy(d.view, dx, dy));
      return;
    }
    if (p.editor) {
      p.editor.onHover(world, SNAP_PX / v.k);
    }
    const id = pickRegion(p.geometry.regions, ps, p.land, world, ex);
    setHoverId((prev) => (prev === id ? prev : id));
    if (!p.editor) {
      p.onRegionHover(id);
    }
    const overCounter = !p.editor && pickCounter(ls, sp, COUNTER_HIT_PX) !== null;
    canvasRef.current!.style.cursor = overCounter || id !== "" ? "pointer" : "default";
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) {
      return;
    }
    const { view: v, layouts: ls, paths: ps, props: p, exact: ex } = live.current;
    if (d.kind === "handle") {
      p.editor?.onDragEnd(d.handle);
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
      p.editor.onClick(world, pickRegion(p.geometry.regions, ps, p.land, world, ex), SNAP_PX / v.k);
      return;
    }
    const counter = pickCounter(ls, sp, COUNTER_HIT_PX);
    if (counter) {
      p.onStackClick(counter.regionId, counter.slot.entry, counter.slot.key);
      return;
    }
    const id = pickRegion(p.geometry.regions, ps, p.land, world, ex);
    if (id !== "") {
      p.onRegionClick(id);
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
      {props.landError !== "" && <div className="map-error">Land mask not loaded: {props.landError}</div>}
    </div>
  );
}
