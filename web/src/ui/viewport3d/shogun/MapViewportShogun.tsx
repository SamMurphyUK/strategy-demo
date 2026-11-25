// SHOGUN. A copy of the vanilla board (../vanilla) with the Shogun II art pass on it. The camera,
// the picking, and the force discs are the vanilla board's. The picture is new:
//
//   - The land is its natural ground (see terrainBase.ts) under a translucent faction wash that is
//     light on the table and strong from altitude.
//   - Borders inside one faction's land are faint dashes, and a frontline is a two-tone ink line.
//   - A clicked territory, and a legal destination while a stack is picked up, wear a watercolour
//     edge. A pointer that only moves over the map marks nothing.
//   - Close in, trees, peaks, and roofs stand up, the surf rolls, thin smoke drifts downwind, and
//     the far edge of the screen softens.
//
// Every setting in the visual store (../../map/mapVisualConfig.ts) is read in the frame loop and
// written to a uniform, a post-pass number, or a `visible` flag. A slider renders no React and
// builds no geometry. React hears about discrete changes only: the hovered region, the selection,
// the viewport size, and the map itself.
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { memo, type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { soundManager } from "../../../audio/sound_manager";
import { easeInOutCubic, type MapCamera, viewFor } from "../../map/combatCamera";
import { facilitiesOf, facilityAnchorOf, type HighlightMode, type Rect, type RegionShape, type StackEntry, type Vec2 } from "../../map/geometry";
import { landMaskAt } from "../../map/landMask";
import { ownersSignature, type Seam, sharedEdges } from "../../map/mapBakeMath";
import { FACTION_TINT } from "../../map/mapStyle";
import type { MapViewProps } from "../../map/MapView";
import { bokehShare, factionWash, friendlyBorderInk, frontlineInk, mapVisuals, subscribeVisuals } from "../../map/mapVisualConfig";
import { finishUnitDrag } from "../../map/moveDrag";
import { clipperFor, type MultiPolygon, pointInMultiPolygon } from "../../map/regionClip";
import { buildPickShapes, type PickShape, type PickShapes, pickRegionAt } from "../../map/regionPick";
import type { MasterLand } from "../../map/svgLandLoader";
import { battleScarDescriptors, type CraterMark, type FrontlineSegment } from "../../map/terrainRelief";
import { effectiveUnitSlots, roughShape } from "../../map/unitSlots";
import { dampZoomK, wheelZoomFactor } from "../../map/viewMath";
import { FACTION_PALETTE, resolveFaction } from "../../theme/factionPalette";
import { coastMaskCanvas, sheetTexture } from "../boardTextures";
import { GROUND_SHARE, propBuffers, propGeometry } from "../propMeshes";
import { planProps, PROP_KINDS, type PropInstance, type PropKind, type PropPlan, type SmokeStack, townSites } from "../propPlan";
import { type BoardLook, shadowReach, sunAt, sunAtAzimuth } from "../sun";
import { shadowDirection } from "../unitShadows";
import {
  BOARD_FOV_DEG,
  type BoardCamera,
  boardPose,
  clampBoardK,
  clampCenter,
  fitBoardK,
  LAND_HEIGHT,
} from "./boardCamera";
import type { OwnedShape, Segment } from "./borderLines";
import { highlightShown, type HighlightWeight, regionHighlights } from "./highlightRules";
import { flatGeometry, slabGeometry } from "./regionMeshes";
import { shogunDetail } from "./shogunDetail";
import {
  cliffMaterial,
  craterMaterial,
  flatMaterial,
  landMaterial,
  markerMaterial,
  markerShadowMaterial,
  PIGMENT,
  propMaterial,
  propShadowMaterial,
  SHOGUN,
  type ShogunUniforms,
  shogunUniforms,
  smokeMaterial,
  watercolorMaterial,
  waterMaterial,
} from "./shogunMaterials";
import { ShogunPost } from "./shogunPost";
import {
  allLandMask,
  EDGE_REACH,
  edgeCanvas,
  factionCanvas,
  frontCanvas,
  LINE_SHEET_SCALE,
  lineCanvas,
  terrainCanvas,
} from "./shogunSheets";
import { ShogunControls } from "./VisualTuningDrawer";

const WORLD_FALLBACK: Rect = { x: 0, y: 0, w: 800, h: 504 };
/** A press that travels less than this is a click. The 2D map uses the same threshold. */
const DRAG_THRESHOLD_PX = 5;
/** Longest frame step the zoom glide will take, so the first frame after a rest does not jump. */
const MAX_STEP_MS = 50;
/** Lift of lines and washes above the surface they sit on, in world units. */
const LIFT = 0.03;
/** Half the side of a marker's quad. The disc is two thirds of it, as wide as the vanilla disc. */
const MARKER_HALF = 3.6;
const MARKER_GAP = 6.4;
/** Ambient motion draws at most this often. A camera move or a change draws at once. */
const AMBIENT_FRAME_MS = 1000 / 30;
/** Where in the day the board opens: mid-morning, with the shadows already short enough to read. */
const OPENING_SECONDS = 70;
/** Lens blur at the far edge of the screen at the closest zoom and full strength, in CSS pixels. */
const LENS_RADIUS = 3.2;
/** Longest a prop's shadow runs along the ground, per unit of its height. */
const PROP_SHADOW_REACH = 0.9;
/** Puffs in a column of smoke. Few, so a column is a thin trail. */
const PUFFS = { battle: 6, minor: 3, chimney: 4 } as const;

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

/** When the board last drew, and whether something has changed since. Mutable; never React state. */
interface Clock {
  start: number;
  lastDraw: number;
  dirty: boolean;
  x: number;
  y: number;
  k: number;
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

/** Builds Three.js objects for a render and disposes them when they are replaced. */
function useDisposable<T>(build: () => T, dispose: (value: T) => void, deps: readonly unknown[]): T {
  const value = useMemo(build, deps);
  const disposer = useRef(dispose);
  disposer.current = dispose;
  useEffect(() => () => disposer.current(value), [value]);
  return value;
}

function disposeOne(object: { dispose(): void }): void {
  object.dispose();
}

function disposeAll(objects: Iterable<{ dispose(): void }>): void {
  for (const object of objects) {
    object.dispose();
  }
}

// --- Materials ----------------------------------------------------------------------------------

interface Kit {
  shared: ShogunUniforms;
  land: THREE.ShaderMaterial;
  cliff: THREE.ShaderMaterial;
  water: THREE.ShaderMaterial;
  seam: THREE.ShaderMaterial;
  prop: THREE.ShaderMaterial;
  propShadow: THREE.ShaderMaterial;
  crater: THREE.ShaderMaterial;
  smoke: THREE.ShaderMaterial;
  markerShadow: THREE.ShaderMaterial;
  /** The dark edge around every marker. One uniform, shared by each faction's material. */
  rim: { value: number };
}

function createKit(): Kit {
  const shared = shogunUniforms();
  return {
    shared,
    land: landMaterial(shared),
    cliff: cliffMaterial(shared, LAND_HEIGHT),
    water: waterMaterial(shared),
    seam: flatMaterial(SHOGUN.seam, 0.3),
    prop: propMaterial(shared),
    propShadow: propShadowMaterial(shared),
    crater: craterMaterial(shared),
    smoke: smokeMaterial(shared),
    markerShadow: markerShadowMaterial(),
    rim: { value: 0.5 },
  };
}

function disposeKit(kit: Kit): void {
  disposeAll([kit.land, kit.cliff, kit.water, kit.seam, kit.prop, kit.propShadow, kit.crater, kit.smoke, kit.markerShadow]);
}

/** The colour a faction washes its land with. Land no faction holds is pale parchment. */
function washColor(owner: string): string {
  const key = resolveFaction(owner);
  return key === "NEUTRAL" ? FACTION_TINT.NEUTRAL : FACTION_PALETTE[key].primary;
}

function segmentGeometry(segments: readonly Segment[], z: number): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const [x1, y1, x2, y2] of segments) {
    positions.push(x1, -y1, z, x2, -y2, z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

// --- The ground ---------------------------------------------------------------------------------

interface GroundProps {
  pick: PickShapes;
  land: MultiPolygon | null;
  bounds: Rect;
  kit: Kit;
}

/** The water, the land slab with its cliff, and the seams between sea zones. */
const Ground = memo(function Ground({ pick, land, bounds, kit }: GroundProps) {
  const slabs = useDisposable(
    () =>
      // One slab for the whole land once it has loaded. Until then, the rough territories.
      land
        ? [slabGeometry(land, LAND_HEIGHT)]
        : pick.shapes.filter((shape) => shape.type === "land").map((shape) => slabGeometry(shape.shape, LAND_HEIGHT)),
    disposeAll,
    [land, pick],
  );
  const seams = useDisposable(
    () => {
      const seam: Seam = { left: bounds.x, right: bounds.x + bounds.w };
      const sea = pick.shapes.filter((shape) => shape.type === "sea").map((shape) => shape.shape);
      return segmentGeometry(sharedEdges(sea, seam, 2), LIFT);
    },
    disposeOne,
    [pick, bounds],
  );
  const faces = useMemo(() => [kit.land, kit.cliff], [kit]);
  return (
    <>
      <mesh position={[bounds.x + bounds.w / 2, -(bounds.y + bounds.h / 2), -LIFT]} material={kit.water} frustumCulled={false}>
        <planeGeometry args={[bounds.w * 6, bounds.h * 6]} />
      </mesh>
      {slabs.map((geometry, index) => (
        <mesh key={index} geometry={geometry} material={faces} />
      ))}
      <lineSegments geometry={seams} material={kit.seam} />
    </>
  );
});

// --- Trees, peaks, roofs, craters, smoke --------------------------------------------------------

interface BattleScar {
  craters: readonly CraterMark[];
  ember: boolean;
}

/** Every prop of one kind as a single instanced draw, and their shadows as a second. */
function PropField({ kind, instances, kit }: { kind: PropKind; instances: readonly PropInstance[]; kit: Kit }) {
  const field = useDisposable(
    () => {
      const geometry = propGeometry(kind);
      const buffers = propBuffers(instances, GROUND_SHARE[kind]);
      geometry.setAttribute("aFlag", new THREE.InstancedBufferAttribute(buffers.flags, 3));
      const matrices = new THREE.InstancedBufferAttribute(buffers.matrices, 16);
      const make = (material: THREE.Material, order: number, tinted: boolean) => {
        const mesh = new THREE.InstancedMesh(geometry, material, buffers.count);
        mesh.instanceMatrix = matrices;
        if (tinted) {
          mesh.instanceColor = new THREE.InstancedBufferAttribute(buffers.tints, 3);
        }
        // The shadow pass moves vertices in the shader, so the model's bounds do not hold.
        mesh.frustumCulled = false;
        mesh.renderOrder = order;
        mesh.visible = false;
        return mesh;
      };
      return { geometry, prop: make(kit.prop, 0, true), shadow: make(kit.propShadow, 1, false) };
    },
    (old) => {
      old.geometry.dispose();
      old.prop.dispose();
      old.shadow.dispose();
    },
    [kind, instances, kit],
  );
  return (
    <>
      <primitive object={field.prop} />
      <primitive object={field.shadow} />
    </>
  );
}

/** Shell craters, flat on the land. */
function Craters({ scars, kit }: { scars: readonly BattleScar[]; kit: Kit }) {
  const mesh = useDisposable(
    () => {
      const marks = scars.flatMap((scar) => scar.craters);
      const craters = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), kit.crater, Math.max(1, marks.length));
      const matrix = new THREE.Matrix4();
      marks.forEach((mark, i) => {
        matrix.makeScale(mark.rx, mark.ry, 1).setPosition(mark.x, -mark.y, 0.02);
        craters.setMatrixAt(i, matrix);
      });
      craters.count = marks.length;
      craters.frustumCulled = false;
      craters.renderOrder = 1;
      return craters;
    },
    (old) => {
      old.geometry.dispose();
      old.dispose();
    },
    [scars, kit],
  );
  return <primitive object={mesh} />;
}

/** Smoke: a column over each battle's main crater, thinner ones over the rest, and the chimneys. */
function Smoke({ scars, chimneys, kit }: { scars: readonly BattleScar[]; chimneys: readonly SmokeStack[]; kit: Kit }) {
  const mesh = useDisposable(
    () => {
      const origins: number[] = [];
      const puffs: number[] = [];
      const column = (x: number, y: number, z: number, count: number, kind: number, ember: boolean, seed: number) => {
        for (let i = 0; i < count; i++) {
          origins.push(x, -y, z);
          puffs.push(i / count + seed, kind, ember && i % 3 === 0 ? 1 : 0, (seed * 7.13 + i * 0.37) % 1);
        }
      };
      scars.forEach((scar, scarIndex) => {
        scar.craters.forEach((crater, i) => {
          const seed = ((scarIndex * 0.37 + i * 0.61) % 1) + 0.01;
          column(crater.x, crater.y, 0.2, i === 0 ? PUFFS.battle : PUFFS.minor, i === 0 ? 1 : 0.55, scar.ember && i === 0, seed);
        });
      });
      chimneys.forEach((stack, i) => {
        column(stack.x, stack.y, stack.z, PUFFS.chimney, 0, false, ((i * 0.43) % 1) + 0.02);
      });
      const quad = new THREE.PlaneGeometry(1, 1);
      const geometry = new THREE.InstancedBufferGeometry();
      geometry.index = quad.index;
      geometry.setAttribute("position", quad.getAttribute("position"));
      geometry.setAttribute("aOrigin", new THREE.InstancedBufferAttribute(new Float32Array(origins), 3));
      geometry.setAttribute("aPuff", new THREE.InstancedBufferAttribute(new Float32Array(puffs), 4));
      geometry.instanceCount = puffs.length / 4;
      const smoke = new THREE.Mesh(geometry, kit.smoke);
      smoke.frustumCulled = false;
      smoke.renderOrder = 5;
      smoke.visible = false;
      return { smoke, quad };
    },
    (old) => {
      old.smoke.geometry.dispose();
      old.quad.dispose();
    },
    [scars, chimneys, kit],
  );
  return <primitive object={mesh.smoke} />;
}

const Dressing = memo(function Dressing({ plan, scars, kit }: { plan: PropPlan | null; scars: readonly BattleScar[]; kit: Kit }) {
  return (
    <>
      <Craters scars={scars} kit={kit} />
      {plan
        ? PROP_KINDS.map((kind) => (plan.props[kind].length > 0 ? <PropField key={kind} kind={kind} instances={plan.props[kind]} kit={kit} /> : null))
        : null}
      <Smoke scars={scars} chimneys={plan?.chimneys ?? NO_CHIMNEYS} kit={kit} />
    </>
  );
});

const NO_CHIMNEYS: readonly SmokeStack[] = [];

// --- The watercolour marks ----------------------------------------------------------------------

interface MarksProps {
  pick: PickShapes;
  highlight: HighlightMode;
  hoverId: string;
  selectedId: string;
  isHostile(regionId: string): boolean;
  kit: Kit;
}

/**
 * The watercolour edge on each marked territory (see highlightRules.ts). Each mesh carries its
 * weight in `userData`; the frame loop shows or hides it and sets its strength from the store.
 */
function Marks({ pick, highlight, hoverId, selectedId, isHostile, kit }: MarksProps) {
  const byId = useMemo(() => new Map(pick.shapes.map((shape) => [shape.id, shape] as const)), [pick]);
  // A territory's fill, kept once it has been marked, so a pointer crossing the map builds each only once.
  const fills = useDisposable(() => new Map<string, THREE.BufferGeometry>(), (map) => disposeAll(map.values()), [pick]);
  const paints = useDisposable(() => new Map<string, THREE.ShaderMaterial>(), (map) => disposeAll(map.values()), [kit]);
  const fillOf = (shape: PickShape): THREE.BufferGeometry => {
    let geometry = fills.get(shape.id);
    if (!geometry) {
      geometry = flatGeometry(shape.shape);
      fills.set(shape.id, geometry);
    }
    return geometry;
  };
  const paintOf = (tone: keyof typeof PIGMENT, sea: boolean, weight: HighlightWeight): THREE.ShaderMaterial => {
    const key = `${tone}:${sea ? "sea" : "land"}:${weight}`;
    let material = paints.get(key);
    if (!material) {
      material = watercolorMaterial(kit.shared, PIGMENT[tone], sea, EDGE_REACH);
      paints.set(key, material);
    }
    return material;
  };
  const marks = regionHighlights({ selectedId, hoverId, highlight, isHostile });
  return (
    <>
      {marks.map((mark) => {
        const shape = byId.get(mark.regionId);
        if (!shape) {
          return null;
        }
        const sea = shape.type === "sea";
        return (
          <mesh
            key={`${mark.regionId}:${mark.tone}:${mark.weight}`}
            geometry={fillOf(shape)}
            material={paintOf(mark.tone, sea, mark.weight)}
            position={[0, 0, (sea ? 0 : LAND_HEIGHT) + LIFT * 2]}
            renderOrder={2}
            userData={{ weight: mark.weight }}
          />
        );
      })}
    </>
  );
}

// --- The pieces ---------------------------------------------------------------------------------

interface MarkerProps {
  regions: readonly RegionShape[];
  stacks: Record<string, StackEntry[]>;
  kit: Kit;
}

/**
 * One disc per faction with pieces in a region, in a row on the unit anchor, as on the vanilla
 * board. Each is unlit, with a dark rim and a contact shadow under it.
 */
const ForceMarkers = memo(function ForceMarkers({ regions, stacks, kit }: MarkerProps) {
  const quad = useDisposable(() => new THREE.PlaneGeometry(2, 2), disposeOne, []);
  const discs = useDisposable(() => new Map<string, THREE.ShaderMaterial>(), (map) => disposeAll(map.values()), [kit]);
  const discOf = (hex: string): THREE.ShaderMaterial => {
    let material = discs.get(hex);
    if (!material) {
      material = markerMaterial(hex, kit.rim);
      discs.set(hex, material);
    }
    return material;
  };
  const marks: { key: string; x: number; y: number; z: number; color: string }[] = [];
  for (const region of regions) {
    const factions = Array.from(new Set((stacks[region.id] ?? []).filter((entry) => entry.count > 0).map((entry) => entry.faction_id)));
    const z = (region.type === "land" ? LAND_HEIGHT : 0) + LIFT * 3;
    factions.forEach((factionId, index) => {
      marks.push({
        key: `${region.id}:${factionId}`,
        x: region.anchor.x + (index - (factions.length - 1) / 2) * MARKER_GAP,
        y: region.anchor.y,
        z,
        color: FACTION_PALETTE[resolveFaction(factionId)].primary,
      });
    });
  }
  return (
    <>
      {marks.map((mark) => (
        <group key={mark.key} position={[mark.x, -mark.y, mark.z]} scale={[MARKER_HALF, MARKER_HALF, 1]}>
          <mesh geometry={quad} material={kit.markerShadow} renderOrder={3} />
          <mesh geometry={quad} material={discOf(mark.color)} position={[0, 0, LIFT]} renderOrder={4} />
        </group>
      ))}
    </>
  );
});

// --- The frame loop -----------------------------------------------------------------------------

interface DirectorProps {
  rig: RefObject<Rig>;
  stage: RefObject<Stage | null>;
  clock: Clock;
  kit: Kit;
  dressing: RefObject<THREE.Group | null>;
  marks: RefObject<THREE.Group | null>;
  look: BoardLook;
  /** The viewer asked for less motion: the water, the smoke, and the sun hold still. */
  still: boolean;
}

/**
 * Runs the camera, writes the visual store to the materials, and draws the frame: the scene to a
 * target, then the lens to the screen. It draws when something changed, and at most thirty times
 * a second while only the water, the smoke, or the light is moving.
 */
function Director({ rig, stage, clock, kit, dressing, marks, look, still }: DirectorProps) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const post = useDisposable(
    () => new ShogunPost(),
    (old) => old.dispose(),
    [],
  );
  const scratch = useMemo(
    () => ({
      size: new THREE.Vector2(),
      // The raw number is what reaches the target (see shogunMaterials.ts).
      beyond: new THREE.Color().setRGB(
        Number.parseInt(SHOGUN.beyond.slice(1, 3), 16) / 255,
        Number.parseInt(SHOGUN.beyond.slice(3, 5), 16) / 255,
        Number.parseInt(SHOGUN.beyond.slice(5, 7), 16) / 255,
        THREE.LinearSRGBColorSpace,
      ),
    }),
    [],
  );
  const live = useRef({ look, still });
  live.current = { look, still };

  useEffect(() => {
    const touch = () => {
      clock.dirty = true;
      invalidate();
    };
    stage.current = { camera, invalidate: touch };
    applyPose(rig.current, camera);
    touch();
    const unsubscribe = subscribeVisuals(touch);
    return () => {
      unsubscribe();
      stage.current = null;
    };
  }, [camera, invalidate, rig, stage, clock]);

  // A new look or a change in the motion setting is a new picture.
  useEffect(() => {
    clock.dirty = true;
    invalidate();
  }, [clock, invalidate, look, still]);

  useFrame(({ scene }, delta) => {
    const r = rig.current;
    const now = performance.now();
    const gliding = stepRig(r, camera, now, delta * 1000);
    const visuals = mapVisuals;
    const detail = shogunDetail(r.k, r.fitK);
    const quiet = live.current.still;

    const waves = visuals.showCoastalWaves ? detail.water : 0;
    const smoke = visuals.showBattleSmoke && visuals.smokeOpacity > 0.004 ? detail.smoke : 0;
    const grow = visuals.showBiomeProps ? detail.props : 0;
    const ambient = !quiet && !document.hidden && (waves > 0.001 || smoke > 0.001 || detail.relief > 0.001);

    const size = gl.getDrawingBufferSize(scratch.size);
    const moved = clock.x !== r.center.x || clock.y !== r.center.y || clock.k !== r.k;
    const resized = size.x !== post.width || size.y !== post.height;
    if (!moved && !resized && !clock.dirty && now - clock.lastDraw < AMBIENT_FRAME_MS) {
      // Too soon for another ambient frame. Ask again and leave the picture as it is.
      if (ambient || gliding) {
        invalidate();
      }
      return;
    }
    clock.lastDraw = now;
    clock.dirty = false;
    clock.x = r.center.x;
    clock.y = r.center.y;
    clock.k = r.k;

    // The light.
    const seconds = quiet ? OPENING_SECONDS : OPENING_SECONDS + (now - clock.start) / 1000;
    const sun = visuals.sunSweep ? sunAt(seconds, live.current.look, quiet) : sunAtAzimuth(visuals.sunAzimuth, live.current.look);
    const { shared } = kit;
    shared.uTime.value = seconds;
    shared.uSunDir.value.set(sun.dir[0], sun.dir[1], sun.dir[2]);
    shared.uSunColor.value.set(sun.color[0], sun.color[1], sun.color[2]);
    shared.uAmbient.value.set(sun.ambient[0], sun.ambient[1], sun.ambient[2]);
    shared.uDirect.value = sun.direct;
    shared.uRelief.value = detail.relief;
    const fall = shadowDirection(sun);
    // Kept short: a forest's long shadows read as hatching across the territory.
    const reach = Math.min(shadowReach(sun), PROP_SHADOW_REACH);
    shared.uShadowVec.value.set(fall.x * reach, fall.y * reach);
    shared.uShadowAlpha.value = sun.shadow * detail.relief;

    // The ground and its lines.
    shared.uFactionAlpha.value = factionWash(detail.closeness, visuals);
    kit.land.uniforms.uGrain.value = visuals.terrainGrainStrength;
    kit.land.uniforms.uSharp.value = Math.min(1, Math.max(0, (r.k / LINE_SHEET_SCALE - 0.8) / 1.5));
    kit.land.uniforms.uInkWeight.value = 1 - 0.4 * detail.closeness;
    const friendly = friendlyBorderInk(visuals.friendlyBorderStyle);
    kit.land.uniforms.uFriendly.value.set(friendly.dashed, friendly.solid);
    const front = frontlineInk(visuals.frontlineStyle);
    kit.land.uniforms.uFrontStyle.value.set(front.dual, front.classic);
    kit.water.uniforms.uWater.value = waves;

    // Trees, peaks, roofs, and smoke.
    kit.prop.uniforms.uGrow.value = grow;
    kit.propShadow.uniforms.uGrow.value = grow;
    kit.smoke.uniforms.uSmoke.value = smoke;
    kit.smoke.uniforms.uOpacity.value = visuals.smokeOpacity;
    kit.smoke.uniforms.uCamRight.value.setFromMatrixColumn(camera.matrixWorld, 0);
    kit.smoke.uniforms.uCamUp.value.setFromMatrixColumn(camera.matrixWorld, 1);
    for (const child of dressing.current?.children ?? []) {
      const material = (child as THREE.Mesh).material;
      if (material === kit.prop) {
        child.visible = grow > 0.001;
      } else if (material === kit.propShadow) {
        child.visible = grow > 0.001 && shared.uShadowAlpha.value > 0.004;
      } else if (material === kit.smoke) {
        child.visible = smoke > 0.001;
      }
    }

    // The pieces: a dark rim, and a contact shadow that leans away from the sun close in.
    kit.rim.value = visuals.unitRim;
    kit.markerShadow.uniforms.uAlpha.value = visuals.contactShadow;
    const slide = 0.3 + 0.5 * detail.relief * sun.direct;
    kit.markerShadow.uniforms.uSlide.value.set(fall.x * slide, fall.y * slide);

    // The watercolour marks. Wider from altitude, where a thin wash would not read.
    const widen = 1 + 0.9 * (1 - detail.closeness);
    for (const child of marks.current?.children ?? []) {
      const weight = child.userData.weight as HighlightWeight;
      const strength = visuals.watercolorIntensity * (weight === "hint" ? visuals.legalHintStrength : weight === "idle" ? 0.8 : 1);
      child.visible = highlightShown(weight, visuals.highlightMode) && strength > 0.004;
      const uniforms = ((child as THREE.Mesh).material as THREE.ShaderMaterial).uniforms;
      uniforms.uStrength.value = strength;
      uniforms.uWiden.value = widen;
    }

    // The scene, then the lens.
    post.setSize(size.x, size.y);
    gl.setRenderTarget(post.board);
    gl.setClearColor(scratch.beyond, 1);
    gl.render(scene, camera);
    const pixelsPerCss = size.x / Math.max(1, r.width);
    post.finish(gl, bokehShare(detail.focus, visuals) * LENS_RADIUS * pixelsPerCss);
    gl.setRenderTarget(null);

    if (ambient || gliding) {
      invalidate();
    }
  }, 1);

  return null;
}

// --- The scene ----------------------------------------------------------------------------------

interface SceneProps {
  rig: RefObject<Rig>;
  stage: RefObject<Stage | null>;
  clock: Clock;
  pick: PickShapes;
  land: MasterLand | null;
  bounds: Rect;
  regions: readonly RegionShape[];
  owners: Record<string, string>;
  /** Changes when a territory changes hands, and only then. */
  ownersKey: string;
  frontlines: readonly FrontlineSegment[];
  stacks: Record<string, StackEntry[]>;
  plan: PropPlan | null;
  scars: readonly BattleScar[];
  highlight: HighlightMode;
  hoverId: string;
  selectedId: string;
  isHostile(regionId: string): boolean;
  look: BoardLook;
  still: boolean;
}

const NO_FRONTLINES: readonly FrontlineSegment[] = [];
const SHEET_ANISOTROPY = 4;

function Scene(props: SceneProps) {
  const { pick, land, bounds, regions, clock } = props;
  const invalidate = useThree((state) => state.invalidate);
  const kit = useDisposable(createKit, disposeKit, []);
  const dressing = useRef<THREE.Group>(null);
  const marks = useRef<THREE.Group>(null);
  const owners = useRef(props.owners);
  owners.current = props.owners;

  const shapes = useMemo(() => new Map(pick.shapes.map((shape) => [shape.id, shape.shape] as const)), [pick]);
  const landShapes = useMemo(() => pick.shapes.filter((shape) => shape.type === "land"), [pick]);

  // The sheets. Each is painted again only when what it shows has changed.
  const terrain = useDisposable(() => sheetTexture(terrainCanvas(bounds, regions, shapes), true, SHEET_ANISOTROPY), disposeOne, [
    bounds,
    regions,
    shapes,
  ]);
  const faction = useDisposable(
    () => sheetTexture(factionCanvas(bounds, regions, shapes, owners.current, washColor), true, SHEET_ANISOTROPY),
    disposeOne,
    [bounds, regions, shapes, props.ownersKey],
  );
  const lines = useDisposable(
    () => {
      const owned = landShapes.map((shape): OwnedShape => {
        const key = resolveFaction(owners.current[shape.id]);
        return { owner: key === "NEUTRAL" ? "" : key, shape: shape.shape };
      });
      return sheetTexture(lineCanvas(bounds, land, owned), true, SHEET_ANISOTROPY);
    },
    disposeOne,
    [bounds, land, landShapes, props.ownersKey],
  );
  const front = useDisposable(() => sheetTexture(frontCanvas(bounds, land, props.frontlines), true, SHEET_ANISOTROPY), disposeOne, [
    bounds,
    land,
    props.frontlines,
  ]);
  const edge = useDisposable(
    () => {
      const sea = pick.shapes.filter((shape) => shape.type === "sea").map((shape) => shape.shape);
      // A sea zone's edge follows the coast as well as its seams.
      return sheetTexture(edgeCanvas(bounds, landShapes.map((shape) => shape.shape), land ? [...sea, land.polygons] : sea), false);
    },
    disposeOne,
    [bounds, land, pick, landShapes],
  );
  const mask = useDisposable(() => sheetTexture(land ? coastMaskCanvas(land, bounds) : allLandMask(), false), disposeOne, [bounds, land]);

  const { shared } = kit;
  shared.uTerrain.value = terrain;
  shared.uFaction.value = faction;
  shared.uLines.value = lines;
  shared.uFront.value = front;
  shared.uEdge.value = edge;
  shared.uMask.value = mask;
  shared.uBounds.value.set(bounds.x, bounds.y, bounds.w, bounds.h);

  // Whatever React handed down, the picture is due again.
  useEffect(() => {
    clock.dirty = true;
    invalidate();
  });

  return (
    <>
      <Director
        rig={props.rig}
        stage={props.stage}
        clock={clock}
        kit={kit}
        dressing={dressing}
        marks={marks}
        look={props.look}
        still={props.still}
      />
      <Ground pick={pick} land={land?.polygons ?? null} bounds={bounds} kit={kit} />
      <group ref={dressing} position={[0, 0, LAND_HEIGHT]}>
        <Dressing plan={props.plan} scars={props.scars} kit={kit} />
      </group>
      <group ref={marks}>
        <Marks
          pick={pick}
          highlight={props.highlight}
          hoverId={props.hoverId}
          selectedId={props.selectedId}
          isHostile={props.isHostile}
          kit={kit}
        />
      </group>
      <ForceMarkers regions={regions} stacks={props.stacks} kit={kit} />
    </>
  );
}

// --- The viewport -------------------------------------------------------------------------------

/** The campaign screen's look, read from the attribute the 2D map's CSS keys on. */
function useBoardLook(): BoardLook {
  const [look, setLook] = useState<BoardLook>("field");
  useEffect(() => {
    const campaign = document.querySelector(".campaign");
    if (!campaign) {
      return;
    }
    const read = () => setLook(campaign.getAttribute("data-look") === "dusk" ? "dusk" : "field");
    read();
    const observer = new MutationObserver(read);
    observer.observe(campaign, { attributes: true, attributeFilter: ["data-look"] });
    return () => observer.disconnect();
  }, []);
  return look;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) {
      return;
    }
    const read = () => setReduced(query.matches);
    query.addEventListener("change", read);
    return () => query.removeEventListener("change", read);
  }, []);
  return reduced;
}

/** A stack picked up in the inspector and carried over the board. */
interface CarriedStack {
  regionId: string;
  entry: StackEntry;
  count: number;
  max: number;
  legal: string[];
  group?: { entry: StackEntry; count: number }[];
}

export default function MapViewportShogun(props: MapViewProps) {
  const { geometry, land } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hoverId, setHoverId] = useState("");
  const hoverRef = useRef("");
  const live = useRef(props);
  live.current = props;
  const look = useBoardLook();
  const still = useReducedMotion();

  const frame: Rect = props.frame ?? land?.viewBox ?? (geometry.bounds.w > 0 ? geometry.bounds : WORLD_FALLBACK);
  // The same rectangle every render, so the sheets and the ground are built once.
  const bounds = useMemo<Rect>(() => ({ x: frame.x, y: frame.y, w: frame.w, h: frame.h }), [frame.x, frame.y, frame.w, frame.h]);
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
  const clock = useRef<Clock>({ start: performance.now(), lastDraw: 0, dirty: true, x: Number.NaN, y: Number.NaN, k: Number.NaN }).current;
  const press = useRef<{ x: number; y: number; grab: Vec2 | null; moved: boolean } | null>(null);
  const carried = useRef<CarriedStack | null>(null);

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
  const ownersKey = ownersSignature(geometry.regions, props.owners);

  const slotsOf = (region: RegionShape): Vec2[] => effectiveUnitSlots(region, clipped?.get(region.id) ?? roughShape(region));

  // Trees, peaks, and roofs, laid out clear of every point the pieces use.
  const plan = useMemo(() => {
    if (!land) {
      return null;
    }
    const isLand = (p: Vec2) => landMaskAt(land, p);
    const landRegions = geometry.regions.filter((region) => region.type === "land");
    const keepClear = landRegions.flatMap((region) => [region.anchor, facilityAnchorOf(region), ...slotsOf(region)]);
    const towns = townSites(
      landRegions.map((region) => {
        const shape = clipped?.get(region.id) ?? roughShape(region);
        const factory = facilitiesOf(region).factory;
        return {
          id: region.id,
          ipc: region.ipc,
          factory: factory === "major" ? 2 : factory === "minor" ? 1 : 0,
          anchor: region.anchor,
          contains: (p: Vec2) => pointInMultiPolygon(p, shape),
        };
      }),
      isLand,
      keepClear,
    );
    return planProps({ bounds: land.viewBox, isLand, keepClear, towns });
  }, [land, geometry, clipped]);

  // Craters where the fighting is. The same marks the 2D map paints, so they sit in the same places.
  const scarKey = (props.relief?.scars ?? []).map((scar) => `${scar.regionId}:${scar.ember ? 1 : 0}`).join("|");
  const reliefRef = useRef(props.relief);
  reliefRef.current = props.relief;
  const scars = useMemo<BattleScar[]>(
    () =>
      (reliefRef.current?.scars ?? []).flatMap((scar) => {
        const region = geometry.regions.find((item) => item.id === scar.regionId);
        if (!region || region.type !== "land") {
          return [];
        }
        const marks = battleScarDescriptors(region.id, region.anchor, [region.anchor, ...slotsOf(region)], scar.ember)[0];
        return marks ? [{ craters: marks.craters, ember: scar.ember }] : [];
      }),
    [scarKey, geometry, clipped],
  );

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
  }, [size.w, size.h, bounds]);

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
    // A point off the board's own rectangle, such as one over the side panel, is over no region.
    if (!current || !ndc || Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) {
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

  // The inspector carries a stack over the board. Picking it up arms the move, so the session's
  // legal destinations come back as the highlight; the board marks the one under the pointer.
  const registerMoveDrag = props.registerMoveDrag;
  useEffect(() => {
    if (!registerMoveDrag) {
      return;
    }
    registerMoveDrag({
      start(spec) {
        if (spec.count <= 0) {
          return;
        }
        const p = live.current;
        let legal: string[] = [];
        let max = spec.count;
        let count = spec.count;
        if (spec.group && spec.group.length > 0) {
          for (const item of spec.group) {
            p.onArmDrag?.(spec.regionId, item.entry, item.count);
          }
          let shared: string[] | null = null;
          for (const item of spec.group) {
            const next = p.legalMovesFor?.(spec.regionId, item.entry) ?? [];
            shared = shared === null ? [...next] : shared.filter((id) => next.includes(id));
          }
          legal = shared ?? [];
          if (legal.length === 0) {
            p.onDragCancel?.();
            return;
          }
        } else {
          p.onArmDrag?.(spec.regionId, spec.entry, spec.count);
          legal = p.legalMovesFor?.(spec.regionId, spec.entry) ?? [];
          const cap = p.movableMax?.(spec.regionId, spec.entry);
          if (cap != null && cap > 0) {
            max = cap;
            count = Math.min(count, cap);
          }
        }
        carried.current = { regionId: spec.regionId, entry: spec.entry, count, max, legal, group: spec.group };
        setHover(regionAt(spec.clientX, spec.clientY));
      },
      move(clientX, clientY) {
        if (carried.current) {
          setHover(regionAt(clientX, clientY));
        }
      },
      end(clientX, clientY) {
        const stack = carried.current;
        carried.current = null;
        if (!stack) {
          return;
        }
        const p = live.current;
        const result = finishUnitDrag(
          { regionId: stack.regionId, max: stack.max, count: stack.count, adjusted: true, legal: stack.legal },
          regionAt(clientX, clientY),
        );
        if (result.type !== "commit") {
          soundManager.play("order_cancel");
          p.onDragCancel?.();
          return;
        }
        if (stack.group && stack.group.length > 0) {
          for (const item of stack.group) {
            p.onDropMove?.(stack.regionId, item.entry, result.target, item.count);
          }
          return;
        }
        p.onDropMove?.(stack.regionId, stack.entry, result.target, result.count);
      },
    });
    return () => registerMoveDrag(null);
  }, [registerMoveDrag]);

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

  // Whether a destination is an attack is the session's answer. Without it, the highlight's tone decides.
  const isHostile = (regionId: string): boolean => {
    const p = live.current;
    if (p.isHostileTarget) {
      return p.isHostileTarget(regionId);
    }
    const mode = p.highlight;
    if (mode.kind !== "move" || mode.tone !== "attack") {
      return false;
    }
    return landIdsRef.current.has(regionId) || (mode.hostile?.includes(regionId) ?? true);
  };

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
          if (!press.current && !carried.current) {
            setHover("");
          }
        }}
      >
        <Canvas
          flat
          frameloop={props.suspended ? "never" : "demand"}
          dpr={[1, 2]}
          camera={{ fov: BOARD_FOV_DEG, near: 1, far: 20000, position: [0, 0, 1000] }}
          gl={{ antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "high-performance" }}
        >
          <Scene
            rig={rig}
            stage={stage}
            clock={clock}
            pick={pick}
            land={land}
            bounds={bounds}
            regions={geometry.regions}
            owners={props.owners}
            ownersKey={ownersKey}
            frontlines={props.relief?.frontlines ?? NO_FRONTLINES}
            stacks={props.stacks}
            plan={plan}
            scars={scars}
            highlight={props.highlight}
            hoverId={hoverId}
            selectedId={props.selectedRegionId}
            isHostile={isHostile}
            look={look}
            still={still}
          />
        </Canvas>
      </div>
      <ShogunControls onFit={fitToBoard} />
      {props.children}
    </div>
  );
}
