// The board as a React Three Fiber scene: water, the land slab and its cliffs, the table dressing,
// shadows, craters, and smoke. The 2D map's canvases are laid over it in the last pass, so the
// pieces, washes, and arrows are the ones MapView painted.
//
// The camera, the light, and every other per-frame number go straight from the frame loop to
// Three.js. Nothing here sets React state inside a frame. The loop runs on demand: a painted frame
// from MapView asks for one, and while something on the board moves (water, smoke, the sun) the
// loop keeps itself going, drawing at most thirty times a second.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { BoardFrame } from "../map/boardLayer";
import type { Rect } from "../map/geometry";
import type { MultiPolygon } from "../map/regionClip";
import { gradeSaturation, gradeWarm, tunedBoard } from "../map/boardTune";
import { getBoardTune } from "../map/boardTuneStore";
import { getDrawFlags } from "../map/renderDebug";
import type { CraterMark } from "../map/terrainRelief";
import { boardPose, cameraOf, SEA_DROP, seaShift } from "./boardCamera";
import {
  cliffMaterial,
  craterMaterial,
  landTopMaterial,
  OVERLAY_SLOTS,
  propMaterial,
  propShadowMaterial,
  sharedUniforms,
  smokeMaterial,
  unitShadowMaterial,
  waterMaterial,
} from "./boardMaterials";
import { clearTexture, overlayTexture, sheetTexture } from "./boardTextures";
import { PostStack } from "./postStack";
import { GROUND_SHARE, propBuffers, propGeometry } from "./propMeshes";
import { PROP_KINDS, type PropInstance, type PropKind, type PropPlan, type SmokeStack } from "./propPlan";
import { slabGeometry } from "./regionMeshes";
import { type BoardLook, shadowReach, sunAt } from "./sun";
import { shadowDirection, MAX_UNIT_SHADOWS, writeUnitShadows } from "./unitShadows";
import { boardAnimates, boardDetail } from "./zoomDetail";

/** What MapView last painted, and how to ask the board for a frame. Mutable; never React state. */
export interface BoardStore {
  frame: BoardFrame | null;
  /** Bumped whenever a 2D canvas is repainted. */
  paint: number;
  invalidate: (() => void) | null;
}

export interface BattleScar {
  craters: readonly CraterMark[];
  ember: boolean;
}

export interface BoardSceneProps {
  store: BoardStore;
  /** The land, as the polygons the slab is raised from. */
  land: MultiPolygon;
  bounds: Rect;
  /** The baked base map (see mapBake.ts) and the coast mask (see boardTextures.ts). */
  bake: HTMLCanvasElement;
  mask: HTMLCanvasElement;
  plan: PropPlan;
  scars: readonly BattleScar[];
  look: BoardLook;
  /** The main menu is over the board: dim it. */
  dim: boolean;
  /** The viewer asked for less motion: the water, the smoke, and the sun hold still. */
  still: boolean;
}

/** Ambient motion draws at most this often. A camera move or a repaint draws at once. */
const AMBIENT_FRAME_MS = 1000 / 30;
/** Where in the day the board opens: mid-morning, with the shadows already short enough to read. */
const OPENING_SECONDS = 70;
/** Lens blur at the top and bottom edge at the closest zoom, in CSS pixels. */
const LENS_RADIUS = 3.2;
/** Longest a prop's shadow runs along the ground, per unit of its height. */
const PROP_SHADOW_REACH = 0.9;
/** Lift of ground marks above the land, in world units, so they do not fight it for depth. */
const CRATER_LIFT = 0.02;
const UNIT_SHADOW_LIFT = 0.04;
const PUFFS = { battle: 9, minor: 5, chimney: 5 } as const;

interface Kit {
  shared: ReturnType<typeof sharedUniforms>;
  landTop: THREE.ShaderMaterial;
  cliff: THREE.ShaderMaterial;
  water: THREE.ShaderMaterial;
  prop: THREE.ShaderMaterial;
  propShadow: THREE.ShaderMaterial;
  unitShadow: THREE.ShaderMaterial;
  crater: THREE.ShaderMaterial;
  smoke: THREE.ShaderMaterial;
}

function createKit(): Kit {
  const shared = sharedUniforms();
  return {
    shared,
    landTop: landTopMaterial(shared),
    cliff: cliffMaterial(shared, SEA_DROP),
    water: waterMaterial(shared, SEA_DROP),
    prop: propMaterial(shared),
    propShadow: propShadowMaterial(shared),
    unitShadow: unitShadowMaterial(),
    crater: craterMaterial(shared),
    smoke: smokeMaterial(shared),
  };
}

function disposeKit(kit: Kit): void {
  for (const material of [kit.landTop, kit.cliff, kit.water, kit.prop, kit.propShadow, kit.unitShadow, kit.crater, kit.smoke]) {
    material.dispose();
  }
}

/** Builds Three.js objects for a render and disposes them when they are replaced or unmounted. */
function useDisposable<T>(build: () => T, dispose: (value: T) => void, deps: readonly unknown[]): T {
  const value = useMemo(build, deps);
  const disposer = useRef(dispose);
  disposer.current = dispose;
  useEffect(() => () => disposer.current(value), [value]);
  return value;
}

interface PropFieldProps {
  kind: PropKind;
  instances: readonly PropInstance[];
  kit: Kit;
}

/** Every prop of one kind as a single instanced draw, and their shadows as a second. */
function PropField({ kind, instances, kit }: PropFieldProps) {
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
        matrix.makeScale(mark.rx, mark.ry, 1).setPosition(mark.x, -mark.y, CRATER_LIFT);
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

/** Smoke columns: one over each battle's main crater, thinner ones over the rest, and the chimneys. */
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
      smoke.renderOrder = 3;
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

export function BoardScene(props: BoardSceneProps) {
  const { store, land, bounds, bake, mask, plan, scars } = props;
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const live = useRef(props);
  live.current = props;

  const kit = useDisposable(createKit, disposeKit, []);
  const post = useDisposable(
    () => new PostStack(),
    (old) => old.dispose(),
    [],
  );
  const camera = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000), []);
  const blank = useDisposable(clearTexture, (old) => old.dispose(), []);
  const overlays = useRef<{ texture: THREE.CanvasTexture; canvas: HTMLCanvasElement; width: number; height: number; paint: number }[]>([]);
  useEffect(
    () => () => {
      for (const overlay of overlays.current) {
        overlay.texture.dispose();
      }
      overlays.current = [];
    },
    [],
  );

  const bakeTexture = useDisposable(
    () => sheetTexture(bake, true, Math.min(8, gl.capabilities.getMaxAnisotropy())),
    (old) => old.dispose(),
    [bake, gl],
  );
  const maskTexture = useDisposable(
    () => sheetTexture(mask, false),
    (old) => old.dispose(),
    [mask],
  );
  kit.shared.uBake.value = bakeTexture;
  kit.shared.uMask.value = maskTexture;
  kit.shared.uBounds.value.set(bounds.x, bounds.y, bounds.w, bounds.h);

  const slab = useDisposable(
    () => slabGeometry(land, SEA_DROP),
    (old) => old.dispose(),
    [land],
  );
  const plane = useDisposable(
    () => new THREE.PlaneGeometry(1, 1),
    (old) => old.dispose(),
    [],
  );
  const unitShadows = useDisposable(
    () => {
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), kit.unitShadow, MAX_UNIT_SHADOWS);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      return mesh;
    },
    (old) => {
      old.geometry.dispose();
      old.dispose();
    },
    [kit],
  );

  const bufferSize = useMemo(() => new THREE.Vector2(), []);
  const sea = useRef<THREE.Mesh>(null);
  const board = useRef<THREE.Group>(null);
  const once = useRef<THREE.Group>(null);
  const clock = useRef({ start: performance.now(), lastDraw: 0, seen: -1, dirty: true });

  // A new picture is due whenever something React handed down changes.
  useEffect(() => {
    clock.current.dirty = true;
    invalidate();
  }, [invalidate, bakeTexture, maskTexture, slab, plan, scars, props.look, props.dim, props.still]);

  useEffect(() => {
    store.invalidate = () => invalidate();
    clock.current.dirty = true;
    invalidate();
    return () => {
      store.invalidate = null;
    };
  }, [store, invalidate]);

  useFrame(({ scene }) => {
    const frame = store.frame;
    if (!frame || frame.width <= 0 || frame.height <= 0 || !sea.current || !board.current || !once.current) {
      return;
    }
    const { look, dim, still } = live.current;
    const now = performance.now();
    const state = clock.current;
    const tune = getBoardTune();
    const raw = boardDetail(frame.view.k, frame.fitK, frame.maxK);
    const detail = tunedBoard(raw, tune);
    const moving = !still && getDrawFlags().anims && boardAnimates(detail) && !document.hidden;
    const size = gl.getDrawingBufferSize(bufferSize);
    // A resized canvas has lost its picture, and a repainted 2D canvas has a new one to show.
    const repainted = state.seen !== store.paint || size.x !== post.width || size.y !== post.height;
    if (!repainted && !state.dirty && now - state.lastDraw < AMBIENT_FRAME_MS) {
      // Too soon for another ambient frame. Ask again and leave the picture as it is.
      if (moving) {
        invalidate();
      }
      return;
    }
    state.lastDraw = now;
    state.dirty = false;

    const seconds = still ? OPENING_SECONDS : OPENING_SECONDS + (now - state.start) / 1000;
    const sun = sunAt(seconds, look, still);
    const { shared } = kit;
    shared.uTime.value = seconds;
    shared.uStepTime.value = Math.floor(seconds * 12) / 12;
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

    // The camera is the 2D view, tipped (see boardCamera.ts).
    const pose = boardPose(cameraOf(frame.view, frame.width, frame.height), frame.width, frame.height);
    camera.left = -pose.halfWidth;
    camera.right = pose.halfWidth;
    camera.top = pose.halfHeight;
    camera.bottom = -pose.halfHeight;
    camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
    camera.up.set(0, 1, 0);
    camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    // The water: one sheet under the whole view, slid north so its picture registers with the land's.
    const shift = seaShift(frame.view.k);
    const cosPitch = Math.max(0.5, Math.cos(pose.pitch));
    sea.current.position.set(pose.target[0], pose.target[1] + shift, -SEA_DROP);
    sea.current.scale.set(pose.halfWidth * 2 + 60, (pose.halfHeight * 2) / cosPitch + 80, 1);
    kit.water.uniforms.uShift.value = shift;
    kit.water.uniforms.uWater.value = detail.water;
    const bias = 0.7 * detail.flatten;
    kit.water.uniforms.uBias.value = bias;
    kit.landTop.uniforms.uBias.value = bias;

    kit.prop.uniforms.uGrow.value = detail.props;
    kit.propShadow.uniforms.uGrow.value = detail.props;
    kit.smoke.uniforms.uSmoke.value = detail.smoke;
    kit.smoke.uniforms.uCamUp.value.set(0, Math.cos(pose.pitch), Math.sin(pose.pitch));
    for (const child of board.current.children) {
      const material = (child as THREE.Mesh).material;
      if (material === kit.prop) {
        child.visible = detail.props > 0.001;
      } else if (material === kit.propShadow) {
        child.visible = detail.props > 0.001 && shared.uShadowAlpha.value > 0.004;
      } else if (material === kit.smoke) {
        child.visible = detail.smoke > 0.001;
      }
    }

    // A shadow under every counter. Fixed and faint from altitude, cast by the sun close in.
    unitShadows.count = writeUnitShadows(unitShadows.instanceMatrix.array as Float32Array, frame, sun, UNIT_SHADOW_LIFT);
    unitShadows.instanceMatrix.needsUpdate = true;
    kit.unitShadow.uniforms.uAlpha.value = 0.2 + (sun.shadow - 0.2) * detail.relief * sun.direct;

    // Frame buffers follow the canvas.
    post.setSize(size.x, size.y);

    // The 2D canvases, uploaded when MapView repainted them.
    const grade = post.grade.uniforms;
    let layerWidth = 1;
    let layerHeight = 1;
    for (let i = 0; i < OVERLAY_SLOTS; i++) {
      const canvas = frame.layers[i];
      let overlay = overlays.current[i];
      if (canvas && canvas.width > 0 && canvas.height > 0) {
        if (!overlay || overlay.canvas !== canvas || overlay.width !== canvas.width || overlay.height !== canvas.height) {
          overlay?.texture.dispose();
          overlay = { texture: overlayTexture(canvas), canvas, width: canvas.width, height: canvas.height, paint: store.paint };
          overlays.current[i] = overlay;
        } else if (overlay.paint !== store.paint) {
          overlay.texture.needsUpdate = true;
          overlay.paint = store.paint;
        }
        layerWidth = canvas.width;
        layerHeight = canvas.height;
      }
      const on = !!canvas && !!overlay && canvas.width > 0 && canvas.height > 0;
      grade[`uLayer${i}`].value = on ? overlay.texture : blank;
      grade.uOn.value.setComponent(i, on ? 1 : 0);
    }
    state.seen = store.paint;
    grade.uLayerSize.value.set(layerWidth, layerHeight);
    // The canvases are top-aligned with the frame. A fractional pixel ratio can leave them a row apart.
    grade.uLayerShift.value.set(0, layerHeight - size.y);
    grade.uExact.value = Math.abs(layerWidth - size.x) <= 1 && Math.abs(layerHeight - size.y) <= 1 ? 1 : 0;
    grade.uSaturation.value = gradeSaturation(raw.closeness, tune);
    grade.uWarm.value = gradeWarm(raw.focus, look === "dusk", tune);
    grade.uDusk.value = look === "dusk" ? 1 : 0;
    grade.uDim.value = dim ? 1 : 0;

    // The board, once for each copy of the world in view. The water and the unit shadows cover them all.
    gl.setRenderTarget(post.board);
    gl.clear(true, true, true);
    const autoClear = gl.autoClear;
    gl.autoClear = false;
    const copies = frame.copies.length > 0 ? frame.copies : [0];
    copies.forEach((dx, i) => {
      board.current!.position.x = dx;
      board.current!.updateMatrixWorld(true);
      sea.current!.visible = i === 0;
      once.current!.visible = i === 0;
      gl.render(scene, camera);
    });
    sea.current.visible = true;
    once.current.visible = true;
    const pixelsPerCss = size.x / Math.max(1, frame.width);
    post.finish(gl, detail.focus * LENS_RADIUS * pixelsPerCss, look === "dusk" ? detail.vignette * 1.15 : detail.vignette);
    gl.autoClear = autoClear;
    gl.setRenderTarget(null);

    if (moving) {
      invalidate();
    }
  }, 1);

  return (
    <>
      <mesh ref={sea} geometry={plane} material={kit.water} frustumCulled={false} renderOrder={-2} />
      <group ref={once}>
        <primitive object={unitShadows} />
      </group>
      <group ref={board}>
        <mesh geometry={slab} material={[kit.landTop, kit.cliff]} position={[0, 0, -SEA_DROP]} frustumCulled={false} renderOrder={-1} />
        <Craters scars={scars} kit={kit} />
        {PROP_KINDS.map((kind) => (plan.props[kind].length > 0 ? <PropField key={kind} kind={kind} instances={plan.props[kind]} kit={kit} /> : null))}
        <Smoke scars={scars} chimneys={plan.chimneys} kit={kit} />
      </group>
    </>
  );
}
