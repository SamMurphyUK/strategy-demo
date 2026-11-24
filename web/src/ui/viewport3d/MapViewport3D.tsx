// The campaign board as a React Three Fiber scene. It takes the props MapView takes, so the campaign
// screen can mount either one.
//
// First cut. It draws the land, the sea zones, hover, selection, and move highlights, and it marks
// each force with a disc. Unit sprites, drags, arrows, and the editor are still on the 2D map.
//
// Camera numbers live in a ref and go straight to Three.js. React hears about discrete changes only:
// the hovered region and the viewport size. Nothing here sets state inside a frame.
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { easeInOutCubic, type MapCamera, viewFor } from "../map/combatCamera";
import type { HighlightMode, Rect, StackEntry, Vec2 } from "../map/geometry";
import type { MapViewProps } from "../map/MapView";
import {
  BORDER_PASSES,
  HOVER_COLOR,
  HOVER_TINT,
  highlightLandFill,
  highlightSeaFill,
  LAND_PARCHMENT,
  landTint,
  SEA_BASE_COLOR,
  SEA_SEAM_COLOR,
  SELECTED_COLOR,
  SELECTED_TINT,
} from "../map/mapStyle";
import { clipperFor, type MultiPolygon, uncoveredLand } from "../map/regionClip";
import { buildPickShapes, type PickShape, type PickShapes, pickRegionAt } from "../map/regionPick";
import { dampZoomK, wheelZoomFactor } from "../map/viewMath";
import { factionPalette } from "../theme/factionPalette";
import { MILITARY } from "../theme/militaryPalette";
import {
  BOARD_FOV_DEG,
  type BoardCamera,
  boardPose,
  clampBoardK,
  clampCenter,
  fitBoardK,
  LAND_HEIGHT,
} from "./boardCamera";
import { flatGeometry, outlineGeometry, paintOf, slabGeometry } from "./regionMeshes";

const WORLD_FALLBACK: Rect = { x: 0, y: 0, w: 800, h: 504 };
/** A press that travels less than this is a click. The 2D map uses the same threshold. */
const DRAG_THRESHOLD_PX = 5;
/** Longest frame step the zoom glide will take, so the first frame after a rest does not jump. */
const MAX_STEP_MS = 50;
/** Lift of lines and washes above the surface they sit on, in world units. */
const LIFT = 0.03;
const MARKER_RADIUS = 2.4;
const MARKER_GAP = 5.6;

interface Rig {
  center: Vec2;
  k: number;
  targetK: number;
  /** The world point the wheel zoom keeps under the pointer. */
  zoomAnchor: { ndc: Vec2; world: Vec2 } | null;
  tween: { from: BoardCamera; to: BoardCamera; start: number; ms: number; done(): void } | null;
  userMoved: boolean;
  fitK: number;
  width: number;
  height: number;
  bounds: Rect;
}

interface Stage {
  camera: THREE.PerspectiveCamera;
  invalidate(): void;
}

const RAY = new THREE.Raycaster();
const NDC = new THREE.Vector2();
const HIT = new THREE.Vector3();
const PLANE = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

/** The map point a screen point lands on, at height `z` above the water. */
function boardPoint(camera: THREE.Camera, ndc: Vec2, z: number): Vec2 | null {
  NDC.set(ndc.x, ndc.y);
  RAY.setFromCamera(NDC, camera);
  PLANE.constant = -z;
  const hit = RAY.ray.intersectPlane(PLANE, HIT);
  return hit ? { x: hit.x, y: -hit.y } : null;
}

function applyPose(rig: Rig, camera: THREE.PerspectiveCamera): void {
  const pose = boardPose({ center: rig.center, k: rig.k }, rig.fitK, rig.height);
  camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
  camera.up.set(0, 1, 0);
  camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
  camera.near = Math.max(0.1, pose.distance / 50);
  camera.far = pose.distance * 4 + (rig.bounds.w + rig.bounds.h) * 2;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

/** Advances the wheel glide or the battle approach by one frame. True while the camera is still moving. */
function stepRig(rig: Rig, camera: THREE.PerspectiveCamera, now: number, dtMs: number): boolean {
  const tween = rig.tween;
  if (tween) {
    const t = tween.ms <= 0 ? 1 : Math.min(1, (now - tween.start) / tween.ms);
    const e = easeInOutCubic(t);
    rig.center = {
      x: tween.from.center.x + (tween.to.center.x - tween.from.center.x) * e,
      y: tween.from.center.y + (tween.to.center.y - tween.from.center.y) * e,
    };
    rig.k = tween.from.k + (tween.to.k - tween.from.k) * e;
    rig.targetK = rig.k;
    applyPose(rig, camera);
    if (t >= 1) {
      rig.tween = null;
      tween.done();
      return false;
    }
    return true;
  }
  const anchor = rig.zoomAnchor;
  if (anchor && rig.k !== rig.targetK) {
    const next = dampZoomK(rig.k, rig.targetK, Math.min(dtMs, MAX_STEP_MS));
    rig.k = Math.abs(next - rig.targetK) < rig.targetK * 0.0005 ? rig.targetK : next;
    applyPose(rig, camera);
    const under = boardPoint(camera, anchor.ndc, 0);
    if (under) {
      rig.center = clampCenter(
        { x: rig.center.x + anchor.world.x - under.x, y: rig.center.y + anchor.world.y - under.y },
        rig.bounds,
      );
      applyPose(rig, camera);
    }
    return rig.k !== rig.targetK;
  }
  applyPose(rig, camera);
  return false;
}

/** Hands the Three.js camera to the DOM handlers and runs the camera once per rendered frame. */
function StageBridge({ rig, stage }: { rig: RefObject<Rig>; stage: RefObject<Stage | null> }) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    stage.current = { camera, invalidate: () => invalidate() };
    applyPose(rig.current, camera);
    invalidate();
    return () => {
      stage.current = null;
    };
  }, [camera, invalidate, rig, stage]);
  useFrame((_, delta) => {
    if (stepRig(rig.current, camera, performance.now(), delta * 1000)) {
      invalidate();
    }
  });
  return null;
}

/** Builds Three.js objects for a render and disposes them when they are replaced. */
function useDisposable<T>(build: () => T, dispose: (value: T) => void, deps: readonly unknown[]): T {
  const value = useMemo(build, deps);
  const disposer = useRef(dispose);
  disposer.current = dispose;
  useEffect(() => () => disposer.current(value), [value]);
  return value;
}

function disposeGeometries(map: Map<string, THREE.BufferGeometry>): void {
  for (const geometry of map.values()) {
    geometry.dispose();
  }
}

function disposeOne(object: { dispose(): void }): void {
  object.dispose();
}

function disposeMaterials(map: Map<string, THREE.Material>): void {
  for (const material of map.values()) {
    material.dispose();
  }
}

const CLIFF_COLOR = MILITARY.brown;
const BORDER_INK = BORDER_PASSES[1].color;

interface BoardProps {
  pick: PickShapes;
  land: MultiPolygon | null;
  owners: Record<string, string>;
  bounds: Rect;
}

/** The water, the land slabs, and the printed borders. Rebuilt when the map or the coast changes. */
function Board({ pick, land, owners, bounds }: BoardProps) {
  const landShapes = useMemo(() => pick.shapes.filter((shape) => shape.type === "land"), [pick]);
  const seaShapes = useMemo(() => pick.shapes.filter((shape) => shape.type === "sea"), [pick]);

  const slabs = useDisposable(
    () => new Map(landShapes.map((shape) => [shape.id, slabGeometry(shape.shape, LAND_HEIGHT)] as const)),
    disposeGeometries,
    [landShapes],
  );
  // Land no territory claims: parchment, at the same height, so the coast is one unbroken cliff.
  const unclaimed = useDisposable(
    () => {
      if (!land || !pick.exact) {
        return null;
      }
      const left = uncoveredLand(
        land,
        landShapes.map((shape) => shape.shape),
      );
      return left.length > 0 ? slabGeometry(left, LAND_HEIGHT) : null;
    },
    (geometry) => geometry?.dispose(),
    [land, pick.exact, landShapes],
  );
  const borders = useDisposable(
    () =>
      outlineGeometry(
        landShapes.map((shape) => shape.shape),
        LAND_HEIGHT + LIFT,
      ),
    disposeOne,
    [landShapes],
  );
  const seams = useDisposable(
    () =>
      outlineGeometry(
        seaShapes.map((shape) => shape.shape),
        LIFT,
      ),
    disposeOne,
    [seaShapes],
  );

  const cliff = useDisposable(
    () => new THREE.MeshBasicMaterial({ color: CLIFF_COLOR, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }),
    disposeOne,
    [],
  );
  const tops = useDisposable(() => new Map<string, THREE.Material>(), disposeMaterials, []);
  const topFor = (hex: string): THREE.Material => {
    let material = tops.get(hex);
    if (!material) {
      material = new THREE.MeshBasicMaterial({ color: hex, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
      tops.set(hex, material);
    }
    return material;
  };
  const seam = paintOf(SEA_SEAM_COLOR);

  return (
    <>
      <mesh position={[bounds.x + bounds.w / 2, -(bounds.y + bounds.h / 2), -LIFT]}>
        <planeGeometry args={[bounds.w * 6, bounds.h * 6]} />
        <meshBasicMaterial color={SEA_BASE_COLOR} />
      </mesh>
      {unclaimed && <mesh geometry={unclaimed} material={[topFor(LAND_PARCHMENT), cliff]} />}
      {landShapes.map((shape) => {
        const geometry = slabs.get(shape.id);
        return geometry ? (
          <mesh key={shape.id} geometry={geometry} material={[topFor(landTint(owners[shape.id] ?? "")), cliff]} />
        ) : null;
      })}
      <lineSegments geometry={seams}>
        <lineBasicMaterial color={seam.color} transparent opacity={seam.opacity} />
      </lineSegments>
      <lineSegments geometry={borders}>
        <lineBasicMaterial color={BORDER_INK} />
      </lineSegments>
    </>
  );
}

interface WashProps {
  shape: PickShape;
  css: string;
  /** Draws the region's outline in this colour as well. */
  outline?: string;
}

/** A translucent fill over one region, sitting just above its surface. */
function Wash({ shape, css, outline }: WashProps) {
  const fill = useDisposable(() => flatGeometry(shape.shape), disposeOne, [shape]);
  const z = (shape.type === "land" ? LAND_HEIGHT : 0) + LIFT * 2;
  const rim = useDisposable(() => (outline ? outlineGeometry([shape.shape], z + LIFT) : null), (geometry) => geometry?.dispose(), [
    shape,
    outline,
    z,
  ]);
  const paint = paintOf(css);
  const line = outline ? paintOf(outline) : null;
  return (
    <>
      <mesh geometry={fill} position={[0, 0, z]}>
        <meshBasicMaterial color={paint.color} transparent opacity={paint.opacity} depthWrite={false} />
      </mesh>
      {rim && line && (
        <lineSegments geometry={rim}>
          <lineBasicMaterial color={line.color} transparent opacity={line.opacity} />
        </lineSegments>
      )}
    </>
  );
}

interface OverlayProps {
  pick: PickShapes;
  owners: Record<string, string>;
  highlight: HighlightMode;
  hoverId: string;
  selectedId: string;
}

/** Move and mobilize washes, then hover, then the selection, which draws last. */
function Overlays({ pick, owners, highlight, hoverId, selectedId }: OverlayProps) {
  const byId = useMemo(() => new Map(pick.shapes.map((shape) => [shape.id, shape] as const)), [pick]);
  const washes: { shape: PickShape; css: string }[] = [];
  if (highlight.kind !== "none") {
    for (const shape of pick.shapes) {
      const css =
        shape.type === "land"
          ? highlightLandFill(shape.id, owners[shape.id] ?? "", highlight)
          : highlightSeaFill(shape.id, highlight);
      if (css) {
        washes.push({ shape, css });
      }
    }
  }
  const hovered = hoverId === "" || hoverId === selectedId ? undefined : byId.get(hoverId);
  const selected = selectedId === "" ? undefined : byId.get(selectedId);
  return (
    <>
      {washes.map(({ shape, css }) => (
        <Wash key={`wash:${shape.id}`} shape={shape} css={css} />
      ))}
      {hovered && <Wash key={`hover:${hovered.id}`} shape={hovered} css={HOVER_TINT} outline={HOVER_COLOR} />}
      {selected && <Wash key={`selected:${selected.id}`} shape={selected} css={SELECTED_TINT} outline={SELECTED_COLOR} />}
    </>
  );
}

interface MarkerProps {
  regions: MapViewProps["geometry"]["regions"];
  stacks: Record<string, StackEntry[]>;
}

/** One disc per faction with pieces in a region, in a row on the unit anchor. A stand-in for the sprites. */
function ForceMarkers({ regions, stacks }: MarkerProps) {
  const disc = useDisposable(() => new THREE.CircleGeometry(MARKER_RADIUS, 24), disposeOne, []);
  const rim = useDisposable(() => new THREE.CircleGeometry(MARKER_RADIUS + 0.5, 24), disposeOne, []);
  const marks: { key: string; x: number; y: number; z: number; color: string }[] = [];
  for (const region of regions) {
    const factions = Array.from(new Set((stacks[region.id] ?? []).filter((entry) => entry.count > 0).map((entry) => entry.faction_id)));
    const z = (region.type === "land" ? LAND_HEIGHT : 0) + LIFT * 4;
    factions.forEach((factionId, index) => {
      marks.push({
        key: `${region.id}:${factionId}`,
        x: region.anchor.x + (index - (factions.length - 1) / 2) * MARKER_GAP,
        y: region.anchor.y,
        z,
        color: factionPalette(factionId).primary,
      });
    });
  }
  return (
    <>
      {marks.map((mark) => (
        <group key={mark.key} position={[mark.x, -mark.y, mark.z]}>
          <mesh geometry={rim}>
            <meshBasicMaterial color={MILITARY.charcoal} />
          </mesh>
          <mesh geometry={disc} position={[0, 0, LIFT]}>
            <meshBasicMaterial color={mark.color} />
          </mesh>
        </group>
      ))}
    </>
  );
}

export default function MapViewport3D(props: MapViewProps) {
  const { geometry, land } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hoverId, setHoverId] = useState("");
  const hoverRef = useRef("");
  const live = useRef(props);
  live.current = props;

  const bounds: Rect = props.frame ?? land?.viewBox ?? (geometry.bounds.w > 0 ? geometry.bounds : WORLD_FALLBACK);
  const rig = useRef<Rig>({
    center: { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 },
    k: 1,
    targetK: 1,
    zoomAnchor: null,
    tween: null,
    userMoved: false,
    fitK: 1,
    width: 1,
    height: 1,
    bounds,
  });
  const stage = useRef<Stage | null>(null);
  const press = useRef<{ x: number; y: number; grab: Vec2 | null; moved: boolean } | null>(null);

  // True shapes, from the cache the 2D map fills. Until the land has loaded the rough cutters stand in.
  const clipped = useMemo(() => (land ? clipperFor(land.polygons).clipAll(geometry.regions) : null), [land, geometry]);
  const pick = useMemo(() => buildPickShapes(geometry.regions, clipped), [geometry, clipped]);
  const scene = useRef({ pick, land: land?.polygons ?? null });
  scene.current = { pick, land: land?.polygons ?? null };
  const landIds = useMemo(
    () => new Set(geometry.regions.filter((region) => region.type === "land").map((region) => region.id)),
    [geometry],
  );
  const landIdsRef = useRef(landIds);
  landIdsRef.current = landIds;

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) {
      return;
    }
    const observer = new ResizeObserver(() => {
      setSize({ w: wrap.clientWidth, h: wrap.clientHeight });
    });
    observer.observe(wrap);
    setSize({ w: wrap.clientWidth, h: wrap.clientHeight });
    return () => observer.disconnect();
  }, []);

  const refresh = () => {
    const current = stage.current;
    if (current) {
      applyPose(rig.current, current.camera);
      current.invalidate();
    }
  };

  const fitToBoard = () => {
    const r = rig.current;
    r.tween?.done();
    r.tween = null;
    r.zoomAnchor = null;
    r.userMoved = false;
    r.center = { x: r.bounds.x + r.bounds.w / 2, y: r.bounds.y + r.bounds.h / 2 };
    r.k = r.fitK;
    r.targetK = r.fitK;
    refresh();
  };

  // The viewport or the board changed size: refit, unless the player has taken the camera.
  useEffect(() => {
    if (size.w <= 0 || size.h <= 0) {
      return;
    }
    const r = rig.current;
    r.width = size.w;
    r.height = size.h;
    r.bounds = bounds;
    r.fitK = fitBoardK(bounds, size.w, size.h);
    if (r.userMoved) {
      r.k = clampBoardK(r.k, r.fitK);
      r.targetK = clampBoardK(r.targetK, r.fitK);
      r.center = clampCenter(r.center, bounds);
      refresh();
    } else {
      fitToBoard();
    }
    // `bounds` is rebuilt every render; its numbers are what matter.
  }, [size.w, size.h, bounds.x, bounds.y, bounds.w, bounds.h]);

  const ndcAt = (clientX: number, clientY: number): Vec2 | null => {
    const rect = slideRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    return {
      x: ((clientX - rect.left) / rect.width) * 2 - 1,
      y: -((clientY - rect.top) / rect.height) * 2 + 1,
    };
  };

  /** The region under a screen point. Land is tested at the height of its top face, then the water. */
  const regionAt = (clientX: number, clientY: number): string => {
    const current = stage.current;
    const ndc = ndcAt(clientX, clientY);
    if (!current || !ndc) {
      return "";
    }
    const options = { land: scene.current.land };
    const top = boardPoint(current.camera, ndc, LAND_HEIGHT);
    const onTop = top ? pickRegionAt(scene.current.pick, top, options) : "";
    if (onTop !== "" && landIdsRef.current.has(onTop)) {
      return onTop;
    }
    const water = boardPoint(current.camera, ndc, 0);
    return water ? pickRegionAt(scene.current.pick, water, options) : "";
  };

  const setHover = (id: string) => {
    if (hoverRef.current === id) {
      return;
    }
    hoverRef.current = id;
    setHoverId(id);
    live.current.onRegionHover(id);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || rig.current.tween) {
      return;
    }
    const current = stage.current;
    const ndc = ndcAt(event.clientX, event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);
    press.current = {
      x: event.clientX,
      y: event.clientY,
      grab: current && ndc ? boardPoint(current.camera, ndc, 0) : null,
      moved: false,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const held = press.current;
    if (!held) {
      setHover(regionAt(event.clientX, event.clientY));
      return;
    }
    if (!held.moved && Math.hypot(event.clientX - held.x, event.clientY - held.y) < DRAG_THRESHOLD_PX) {
      return;
    }
    held.moved = true;
    const current = stage.current;
    const ndc = ndcAt(event.clientX, event.clientY);
    if (!current || !ndc || !held.grab) {
      return;
    }
    // Keep the grabbed map point under the pointer.
    const r = rig.current;
    const under = boardPoint(current.camera, ndc, 0);
    if (!under) {
      return;
    }
    r.userMoved = true;
    r.zoomAnchor = null;
    r.targetK = r.k;
    r.center = clampCenter({ x: r.center.x + held.grab.x - under.x, y: r.center.y + held.grab.y - under.y }, r.bounds);
    refresh();
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const held = press.current;
    press.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!held || held.moved) {
      return;
    }
    const id = regionAt(event.clientX, event.clientY);
    if (id !== "") {
      live.current.onRegionClick(id);
    } else {
      live.current.onBackgroundClick?.();
    }
  };

  const onPointerCancel = () => {
    press.current = null;
  };

  // Wheel zoom. React's wheel listener is passive, so the page would scroll under it.
  useEffect(() => {
    const slide = slideRef.current;
    if (!slide) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = stage.current;
      const ndc = ndcAt(event.clientX, event.clientY);
      const r = rig.current;
      if (!current || !ndc || r.tween) {
        return;
      }
      const world = boardPoint(current.camera, ndc, 0);
      if (!world) {
        return;
      }
      r.userMoved = true;
      r.targetK = clampBoardK(r.targetK * wheelZoomFactor(event.deltaY, event.deltaMode), r.fitK);
      r.zoomAnchor = { ndc, world };
      current.invalidate();
    };
    slide.addEventListener("wheel", onWheel, { passive: false });
    return () => slide.removeEventListener("wheel", onWheel);
  }, []);

  // A drag out of the inspector asks which region a screen point is over.
  const registerDropResolver = props.registerDropResolver;
  useEffect(() => {
    registerDropResolver?.((clientX, clientY) => regionAt(clientX, clientY));
  }, [registerDropResolver]);

  // The campaign drives this camera into a battle.
  const bindCamera = props.bindCamera;
  useEffect(() => {
    if (!bindCamera) {
      return;
    }
    const camera: MapCamera = {
      snapshot: () => {
        const r = rig.current;
        return { view: viewFor(r.center, r.k, r.width, r.height), fitK: r.fitK, width: r.width, height: r.height };
      },
      moveTo: (goal, ms) =>
        new Promise<void>((resolve) => {
          const r = rig.current;
          r.tween?.done();
          r.zoomAnchor = null;
          r.userMoved = true;
          r.tween = {
            from: { center: r.center, k: r.k },
            to: { center: clampCenter(goal.center, r.bounds), k: clampBoardK(goal.k, r.fitK) },
            start: performance.now(),
            ms,
            done: resolve,
          };
          if (stage.current) {
            stage.current.invalidate();
          } else {
            // No scene to animate yet. Land on the goal so the battle is not left waiting.
            r.center = r.tween.to.center;
            r.k = r.tween.to.k;
            r.targetK = r.k;
            r.tween = null;
            resolve();
          }
        }),
    };
    bindCamera(camera);
    return () => {
      const r = rig.current;
      r.tween?.done();
      r.tween = null;
      bindCamera(null);
    };
  }, [bindCamera]);

  return (
    <div className="map-wrap" ref={wrapRef}>
      <div
        ref={slideRef}
        className="map-slide"
        style={{ touchAction: "none", userSelect: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
        onPointerLeave={() => {
          if (!press.current) {
            setHover("");
          }
        }}
      >
        <Canvas
          flat
          frameloop="demand"
          dpr={[1, 2]}
          camera={{ fov: BOARD_FOV_DEG, near: 1, far: 20000, position: [0, 0, 1000] }}
          gl={{ antialias: true }}
        >
          <color attach="background" args={[SEA_BASE_COLOR]} />
          <StageBridge rig={rig} stage={stage} />
          <Board pick={pick} land={land?.polygons ?? null} owners={props.owners} bounds={bounds} />
          <Overlays
            pick={pick}
            owners={props.owners}
            highlight={props.highlight}
            hoverId={hoverId}
            selectedId={props.selectedRegionId}
          />
          <ForceMarkers regions={geometry.regions} stacks={props.stacks} />
        </Canvas>
      </div>
      <div className="map-controls">
        <button type="button" onClick={fitToBoard}>
          Fit map
        </button>
      </div>
      {props.children}
    </div>
  );
}
