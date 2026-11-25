// The board as a React Three Fiber scene: water, the land slab and its cliffs, the table dressing,
// shadows, craters, and smoke. The 2D map's canvases are laid over it in the last pass, so the
// pieces, washes, and arrows are the ones MapView painted.
//
// The camera, the light, and every other per-frame number go straight from the frame loop to
// Three.js. Nothing here sets React state inside a frame. The loop runs on demand: a painted frame
// from MapView asks for one, and while something on the board moves (water, smoke, the sun) the
// loop keeps itself going, drawing at most thirty times a second.
//
// The light and the lens (see mapVisualConfig.ts) are read here each frame. The sun's shadow map
// is a second picture of the board, taken from the sun before the board itself is drawn; the
// shade, the glow, the outline, and the grain belong to the finishing passes in postStack.ts.
// Each one that is off is not drawn, not allocated, and not in any shader.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { BoardFrame, FigureCards } from "../map/boardLayer";
import { stackOfFigure } from "../map/figureCards";
import type { Rect } from "../map/geometry";
import type { MultiPolygon } from "../map/regionClip";
import { gradeSaturation, gradeWarm, tunedBoard } from "../map/boardTune";
import { getBoardTune } from "../map/boardTuneStore";
import {
  aoLook,
  BLOOM_THRESHOLD,
  bloomLook,
  factionWash,
  friendlyBorderInk,
  frontlineInk,
  grainAmount,
  mapVisuals,
  outlineLook,
  shadowMapSize,
  skySheen,
  subscribeVisuals,
} from "../map/mapVisualConfig";
import { getDrawFlags } from "../map/renderDebug";
import type { CraterMark } from "../map/terrainRelief";
import { projectionScales, screenToWorld } from "../map/viewMath";
import { boardPose, cameraOf, SEA_DROP, seaShift } from "./boardCamera";
import {
  cardCasterMaterial,
  cliffCasterMaterial,
  cliffMaterial,
  craterMaterial,
  landTopMaterial,
  OUTLINE_SLOTS,
  OVERLAY_SLOTS,
  propCasterMaterial,
  propMaterial,
  propShadowMaterial,
  setDefine,
  sharedUniforms,
  smokeMaterial,
  unitShadowMaterial,
  waterMaterial,
} from "./boardMaterials";
import { clearTexture, overlayTexture, sheetTexture } from "./boardTextures";
import { LINE_SHEET_SCALE } from "./shogun/shogunSheets";
import { PIGMENT, rgbOf, SHOGUN, landMaterial, shogunUniforms } from "./shogun/shogunMaterials";
import { type FrameEffects, PostStack } from "./postStack";
import { GROUND_SHARE, propBuffers, propGeometry } from "./propMeshes";
import { PROP_KINDS, type PropInstance, type PropKind, type PropPlan, type SmokeStack } from "./propPlan";
import { slabGeometry } from "./regionMeshes";
import { buildSkyEnvironment } from "./skyEnv";
import { type BoardLook, shadowLight, shadowReach, sunFor } from "./sun";
import { fitSunShadow } from "./sunShadow";
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
  /**
   * Shogun ground sheets. Set, the land is the natural terrain and the faction wash instead of the
   * baked faction palette, and the Z menu's Shogun controls drive it. The sea canvas stays `bake`.
   */
  shogun?: {
    terrain: HTMLCanvasElement;
    faction: HTMLCanvasElement;
    lines: HTMLCanvasElement;
    front: HTMLCanvasElement;
  } | null;
}

const SHOGUN_INK = rgbOf(SHOGUN.ink);
const SEPIA_INK = rgbOf("#2B2620");

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

/** The layer only the sun's shadow camera draws. The board camera draws layer 0 and never sees it. */
const CASTER_LAYER = 1;
/**
 * A cast shadow is never longer than this share of the height of what casts it. The cliff is the
 * tallest thing on the board, and a longer shadow than this puts a narrow sea wholly in the dark.
 */
const CAST_REACH = 0.8;
/** Taller than any tree, peak, building, or figure, in world units. The shadow camera clears it. */
const CASTER_TOP = 16;
/** Most standing figures that cast in one frame. */
const MAX_FIGURE_CARDS = 1024;
/** What a full cast shadow multiplies the ground by: cooler than the light, and not black. */
const CAST_TINT: readonly [number, number, number] = [0.64, 0.66, 0.79];
/** How bright an ember is while the glow is on. Above 1 it is hot enough to spread. */
const EMBER_GLOW = 2.4;
/** The camera's steepest tip, in radians: the sea shows the most sky from here. */
const FULL_TILT = 0.55;
const SELECT_INK = rgbOf(PIGMENT.select);
const HOVER_INK = rgbOf(PIGMENT.hover);

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
  /** The same shapes as the sun sees them: depth only, drawn into the shadow map. */
  cliffCaster: THREE.ShaderMaterial;
  propCaster: THREE.ShaderMaterial;
  cardCaster: THREE.ShaderMaterial;
  /** The top of the land casts on nothing: it is the ground the shadows fall on. */
  noCaster: THREE.Material;
}

function createKit(): Kit {
  const shared = sharedUniforms();
  const prop = propMaterial(shared);
  return {
    shared,
    landTop: landTopMaterial(shared),
    cliff: cliffMaterial(shared, SEA_DROP),
    water: waterMaterial(shared, SEA_DROP),
    prop,
    propShadow: propShadowMaterial(shared),
    unitShadow: unitShadowMaterial(),
    crater: craterMaterial(shared),
    smoke: smokeMaterial(shared),
    cliffCaster: cliffCasterMaterial(),
    propCaster: propCasterMaterial(prop.uniforms.uGrow),
    cardCaster: cardCasterMaterial(),
    noCaster: new THREE.MeshBasicMaterial({ visible: false }),
  };
}

function disposeKit(kit: Kit): void {
  for (const material of [
    kit.landTop,
    kit.cliff,
    kit.water,
    kit.prop,
    kit.propShadow,
    kit.unitShadow,
    kit.crater,
    kit.smoke,
    kit.cliffCaster,
    kit.propCaster,
    kit.cardCaster,
    kit.noCaster,
  ]) {
    material.dispose();
  }
}

/** The sun's shadow map: a depth texture read through a comparing sampler, so the hardware filters each tap. */
function sunTarget(size: number): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(size, size, {
    depthBuffer: true,
    stencilBuffer: false,
    colorSpace: THREE.NoColorSpace,
    // Nothing is drawn to the colour; one byte a texel is the least it can be.
    format: THREE.RedFormat,
  });
  const depth = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
  depth.format = THREE.DepthFormat;
  depth.compareFunction = THREE.LessEqualCompare;
  depth.minFilter = THREE.LinearFilter;
  depth.magFilter = THREE.LinearFilter;
  target.depthTexture = depth;
  return target;
}

/** A figure canvas as a texture. Its alpha is all that is read. */
function figureTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

interface CanvasSlot {
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  paint: number;
}

/** The texture for a canvas the map repaints: made again when the canvas changes size, sent again when it is repainted. */
function canvasSlot(slot: CanvasSlot | null, canvas: HTMLCanvasElement, paint: number): CanvasSlot {
  if (!slot || slot.canvas !== canvas || slot.width !== canvas.width || slot.height !== canvas.height) {
    slot?.texture.dispose();
    return { texture: figureTexture(canvas), canvas, width: canvas.width, height: canvas.height, paint };
  }
  if (slot.paint !== paint) {
    slot.texture.needsUpdate = true;
    slot.paint = paint;
  }
  return slot;
}

/**
 * Everything the sun's shadow pass owns: its camera, its map, and the cards the standing figures
 * cast from. The map and the textures are made when the shadows are switched on and dropped when
 * they are switched off.
 */
interface SunRig {
  camera: THREE.OrthographicCamera;
  target: THREE.WebGLRenderTarget | null;
  cards: THREE.Mesh<THREE.InstancedBufferGeometry>;
  foot: THREE.InstancedBufferAttribute;
  box: THREE.InstancedBufferAttribute;
  sheet: THREE.InstancedBufferAttribute;
  mask: CanvasSlot | null;
  /** The paint the cards were last laid out for. */
  paint: number;
  kinds: Map<string, number>;
}

function createSunRig(material: THREE.Material): SunRig {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 100);
  camera.layers.set(CASTER_LAYER);
  camera.up.set(0, 0, 1);
  const quad = new THREE.PlaneGeometry(1, 1);
  quad.translate(0.5, 0.5, 0);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute("position", quad.getAttribute("position"));
  const attribute = (size: number) => {
    const made = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FIGURE_CARDS * size), size);
    made.setUsage(THREE.DynamicDrawUsage);
    return made;
  };
  const foot = attribute(3);
  const box = attribute(4);
  const sheet = attribute(4);
  geometry.setAttribute("aFoot", foot);
  geometry.setAttribute("aBox", box);
  geometry.setAttribute("aSheet", sheet);
  geometry.instanceCount = 0;
  const cards = new THREE.Mesh(geometry, material);
  cards.frustumCulled = false;
  cards.layers.set(CASTER_LAYER);
  cards.visible = false;
  return { camera, target: null, cards, foot, box, sheet, mask: null, paint: -1, kinds: new Map() };
}

function disposeSunRig(rig: SunRig): void {
  rig.target?.depthTexture?.dispose();
  rig.target?.dispose();
  rig.mask?.texture.dispose();
  rig.cards.geometry.dispose();
}

const SEA_KIND = 1;
const AIR_KIND = 2;

/**
 * Lays one card for each standing figure: where its feet are on the board, how far its picture
 * reaches from them, and where that picture is on the figure canvas. A ship stands on the water,
 * and an aircraft is lifted off the ground, so its shadow falls clear of it.
 */
function layFigureCards(rig: SunRig, frame: BoardFrame, figures: FigureCards, mask: HTMLCanvasElement, shift: number): number {
  rig.kinds.clear();
  for (const layout of frame.layouts) {
    const sea = layout.region.type === "sea" ? SEA_KIND : 0;
    for (const counter of layout.counters) {
      rig.kinds.set(`${layout.region.id}|${layout.copyDx}|${counter.slot.key}`, sea | (counter.domain === "air" ? AIR_KIND : 0));
    }
  }
  const dpr = frame.dpr > 0 ? frame.dpr : 1;
  // Device pixels for each world unit across the screen. Height is measured with the same rule:
  // a figure is drawn facing the screen, so a pixel up its picture is a pixel of its height.
  const perUnit = Math.max(projectionScales(frame.view.k).sx * dpr, 1e-6);
  const lift = (frame.tokenPx / 2 / Math.max(frame.view.k, 1e-6)) * 1.1;
  const scale = figures.maskScale;
  const foot = rig.foot.array as Float32Array;
  const box = rig.box.array as Float32Array;
  const sheet = rig.sheet.array as Float32Array;
  let count = 0;
  for (const card of figures.cards) {
    if (count >= MAX_FIGURE_CARDS) {
      break;
    }
    const world = screenToWorld(frame.view, { x: card.feetX / dpr, y: card.feetY / dpr });
    const kind = rig.kinds.get(stackOfFigure(card.id)) ?? 0;
    const sea = (kind & SEA_KIND) !== 0;
    foot[count * 3] = world.x;
    foot[count * 3 + 1] = -world.y + (sea ? shift : 0);
    foot[count * 3 + 2] = (sea ? -SEA_DROP : 0) + ((kind & AIR_KIND) !== 0 ? lift : 0);
    box[count * 4] = (card.left - card.feetX) / perUnit;
    box[count * 4 + 1] = (card.feetY - (card.top + card.h)) / perUnit;
    box[count * 4 + 2] = card.w / perUnit;
    box[count * 4 + 3] = card.h / perUnit;
    sheet[count * 4] = (card.left * scale) / mask.width;
    sheet[count * 4 + 1] = 1 - ((card.top + card.h) * scale) / mask.height;
    sheet[count * 4 + 2] = ((card.left + card.w) * scale) / mask.width;
    sheet[count * 4 + 3] = 1 - (card.top * scale) / mask.height;
    count += 1;
  }
  rig.foot.needsUpdate = true;
  rig.box.needsUpdate = true;
  rig.sheet.needsUpdate = true;
  return count;
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
      // The same instances once more, for the sun's shadow map only.
      const caster = make(kit.propCaster, 0, false);
      caster.layers.set(CASTER_LAYER);
      return { geometry, prop: make(kit.prop, 0, true), shadow: make(kit.propShadow, 1, false), caster };
    },
    (old) => {
      old.geometry.dispose();
      old.prop.dispose();
      old.shadow.dispose();
      old.caster.dispose();
    },
    [kind, instances, kit],
  );
  return (
    <>
      <primitive object={field.prop} />
      <primitive object={field.shadow} />
      <primitive object={field.caster} />
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
  const shogunShared = useMemo(() => {
    const uniforms = shogunUniforms();
    const source = kit.shared;
    uniforms.uTime = source.uTime;
    uniforms.uSunDir = source.uSunDir;
    uniforms.uSunColor = source.uSunColor;
    uniforms.uAmbient = source.uAmbient;
    uniforms.uDirect = source.uDirect;
    uniforms.uRelief = source.uRelief;
    uniforms.uShadowVec = source.uShadowVec;
    uniforms.uShadowAlpha = source.uShadowAlpha;
    uniforms.uBounds = source.uBounds;
    uniforms.uMask = source.uMask;
    uniforms.uSunMap = source.uSunMap;
    uniforms.uSunMatrix = source.uSunMatrix;
    uniforms.uSunTexel = source.uSunTexel;
    uniforms.uSunTint = source.uSunTint;
    return uniforms;
  }, [kit]);
  const rig = useDisposable(() => createSunRig(kit.cardCaster), disposeSunRig, [kit]);
  const slabCaster = useMemo(() => [kit.noCaster, kit.cliffCaster], [kit]);
  /** The sky the sea mirrors, and the canvas of the marked stacks. Both exist only while they are used. */
  const sky = useRef<THREE.WebGLRenderTarget | null>(null);
  const outlineMap = useRef<CanvasSlot | null>(null);
  const sunMatrix = useMemo(() => new THREE.Matrix4(), []);
  useEffect(
    () => () => {
      sky.current?.dispose();
      sky.current = null;
      outlineMap.current?.texture.dispose();
      outlineMap.current = null;
    },
    [],
  );
  const shogunLand = useDisposable(
    () => landMaterial(shogunShared),
    (old) => old.dispose(),
    [shogunShared],
  );
  const shogunSheets = props.shogun ?? null;
  const shogunTextures = useDisposable(
    () => {
      if (!shogunSheets) {
        return null;
      }
      const anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
      return {
        terrain: sheetTexture(shogunSheets.terrain, true, anisotropy),
        faction: sheetTexture(shogunSheets.faction, true, anisotropy),
        lines: sheetTexture(shogunSheets.lines, true, anisotropy),
        front: sheetTexture(shogunSheets.front, true, anisotropy),
      };
    },
    (old) => {
      old?.terrain.dispose();
      old?.faction.dispose();
      old?.lines.dispose();
      old?.front.dispose();
    },
    [shogunSheets, gl],
  );
  if (shogunTextures) {
    shogunShared.uTerrain.value = shogunTextures.terrain;
    shogunShared.uFaction.value = shogunTextures.faction;
    shogunShared.uLines.value = shogunTextures.lines;
    shogunShared.uFront.value = shogunTextures.front;
  }
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
  }, [invalidate, bakeTexture, maskTexture, slab, plan, scars, props.look, props.dim, props.still, shogunTextures]);

  useEffect(() => {
    if (!shogunTextures) {
      return;
    }
    kit.cliff.uniforms.uRockHigh.value.copy(rgbOf(SHOGUN.rockHigh));
    kit.cliff.uniforms.uRockLow.value.copy(rgbOf(SHOGUN.rockLow));
    kit.cliff.uniforms.uRockWet.value.copy(rgbOf(SHOGUN.rockWet));
    kit.cliff.uniforms.uRockLip.value.copy(rgbOf(SHOGUN.rockLip));
    kit.water.uniforms.uFoam.value.copy(rgbOf(SHOGUN.foam));
    kit.water.uniforms.uWaveTint.value.copy(rgbOf(SHOGUN.seaShelf));
    kit.water.uniforms.uTable.value.copy(rgbOf(SHOGUN.beyond));
    kit.water.uniforms.uNeat.value.copy(rgbOf(SHOGUN.foam));
  }, [shogunTextures, kit]);

  // The light and the lens are read on every board, so every board redraws when a setting moves.
  useEffect(
    () =>
      subscribeVisuals(() => {
        clock.current.dirty = true;
        invalidate();
      }),
    [invalidate],
  );

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
    const tuned = tunedBoard(raw, tune);
    const shogunNow = shogunTextures !== null;
    const detail = shogunNow
      ? {
          ...tuned,
          props: mapVisuals.showBiomeProps ? tuned.props : 0,
          water: mapVisuals.showCoastalWaves ? tuned.water : 0,
          smoke: mapVisuals.showBattleSmoke ? tuned.smoke * (mapVisuals.smokeOpacity / 0.22) : 0,
          focus: mapVisuals.enableDoF ? tuned.focus * (mapVisuals.bokehIntensity / 0.6) : 0,
        }
      : tuned;
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
    const shogun = shogunTextures !== null;
    // The Shogun board can hold its moving sun at an azimuth. The static settings win over that.
    const sun = sunFor(mapVisuals.sunCycle, seconds, look, still, shogun && !mapVisuals.sunSweep ? mapVisuals.sunAzimuth : null);
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

    // The sun's shadow map. With it on, the cliff, the props, and the figures cast for real, and
    // the flattened stand-ins they used to cast with are put away.
    const mapSize = shadowMapSize(mapVisuals.shadowQuality);
    const sunMap = mapSize > 0;
    const cast = sunMap ? sun.direct * detail.relief : 0;
    const casting = cast > 0.004;
    shared.uShadowAlpha.value = sunMap ? 0 : sun.shadow * detail.relief;
    const kernel = sunMap ? (mapSize >= 4096 ? 2 : 1) : null;
    setDefine(kit.landTop, "SUN_SHADOW", kernel);
    setDefine(shogunLand, "SUN_SHADOW", kernel);
    setDefine(kit.water, "SUN_SHADOW", kernel);
    setDefine(kit.prop, "SUN_SHADOW", kernel);
    setDefine(post.grade, "SUN_SHADOW", kernel);
    if (!sunMap && rig.target) {
      rig.target.depthTexture?.dispose();
      rig.target.dispose();
      rig.target = null;
      rig.mask?.texture.dispose();
      rig.mask = null;
      shared.uSunMap.value = null;
    } else if (sunMap && (!rig.target || rig.target.width !== mapSize)) {
      rig.target?.depthTexture?.dispose();
      rig.target?.dispose();
      rig.target = sunTarget(mapSize);
      shared.uSunMap.value = rig.target.depthTexture;
      // A map that was never drawn has no texture behind it, and every shader that reads it then
      // draws nothing at all. From altitude nothing casts, so the first pass may be a long way off.
      gl.setRenderTarget(rig.target);
      gl.clear(false, true, false);
      gl.setRenderTarget(null);
    }
    // A full shadow is the ground with the sun taken off it: cooler, and a third darker.
    const depth = cast * (sun.direct > 0 ? sun.shadow / (0.3 * sun.direct) : 0);
    shared.uSunTint.value.set(1 - (1 - CAST_TINT[0]) * depth, 1 - (1 - CAST_TINT[1]) * depth, 1 - (1 - CAST_TINT[2]) * depth);
    post.grade.uniforms.uSunTint.value.copy(shared.uSunTint.value);

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

    // The glow needs something hot to spread: an ember under a battle's smoke, or the sun on the sea.
    const sheen = skySheen(mapVisuals.envReflectionWeight);
    const glowLook = bloomLook(mapVisuals.bloomWeight);
    const embers = detail.smoke > 0.01 && live.current.scars.some((scar) => scar.ember);
    const glitter = sheen > 0 && detail.water > 0.01 && sun.direct > 0.01;
    const glowing = glowLook !== null && (embers || glitter) && (gl.extensions.has("EXT_color_buffer_float") || gl.extensions.has("EXT_color_buffer_half_float"));
    kit.smoke.uniforms.uGlow.value = glowing ? EMBER_GLOW : 1;

    // The sky on the sea. The dome is built the first frame the sheen is on.
    setDefine(kit.water, "SKY_SHEEN", sheen > 0 ? 1 : null);
    if (sheen > 0) {
      if (!sky.current) {
        sky.current = buildSkyEnvironment(gl);
      }
      const water = kit.water.uniforms;
      const tilt = Math.min(1, pose.pitch / FULL_TILT);
      water.uSky.value = sky.current.texture;
      // More sky as the camera comes down. From straight above the sea is the chart it was painted as.
      water.uSheen.value.set(sheen * detail.water * (0.1 + 0.2 * tilt), sheen * detail.water * (glowing ? 1.5 : 0.8));
      water.uToEye.value.set(0, -Math.sin(pose.pitch), Math.cos(pose.pitch));
      water.uEye.value.set(pose.target[0], pose.target[1] + shift, 1 / pose.halfWidth, cosPitch / pose.halfHeight);
    } else if (sky.current) {
      sky.current.dispose();
      sky.current = null;
      kit.water.uniforms.uSky.value = null;
    }

    // The shadow camera stands toward the sun and frames the ground in view, and nothing more.
    if (casting && rig.target) {
      const light = shadowLight(sun, CAST_REACH);
      const fit = fitSunShadow(
        light,
        {
          centerX: pose.target[0],
          centerY: pose.target[1],
          halfWidth: pose.halfWidth,
          halfDepth: pose.halfHeight / cosPitch,
          seaDrop: SEA_DROP,
          seaShift: shift,
          top: CASTER_TOP,
        },
        mapSize,
      );
      const eye = rig.camera;
      eye.left = -fit.halfWidth;
      eye.right = fit.halfWidth;
      eye.top = fit.halfHeight;
      eye.bottom = -fit.halfHeight;
      eye.near = fit.near;
      eye.far = fit.far;
      eye.position.set(fit.position[0], fit.position[1], fit.position[2]);
      eye.up.set(0, 0, 1);
      eye.lookAt(fit.target[0], fit.target[1], fit.target[2]);
      eye.updateProjectionMatrix();
      eye.updateMatrixWorld();
      // Clip space runs -1 to 1; the map is read 0 to 1.
      sunMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
      shared.uSunMatrix.value.copy(sunMatrix).multiply(eye.projectionMatrix).multiply(eye.matrixWorldInverse);
      const texel = Math.max(fit.texelX, fit.texelY);
      shared.uSunTexel.value.set(1 / mapSize, 1 / mapSize, (0.05 + texel * 1.5) / (fit.far - fit.near), 0.14 + texel * 2);
      // The figures' cards stand square to the sun, so a low sun from the side still throws the whole figure.
      const flat = Math.hypot(light[0], light[1]) || 1;
      kit.cardCaster.uniforms.uSide.value.set(light[1] / flat, -light[0] / flat, 0);
    }
    if (shogun) {
      const land = shogunLand.uniforms;
      land.uFactionAlpha.value = factionWash(raw.closeness, mapVisuals);
      land.uGrain.value = mapVisuals.terrainGrainStrength;
      land.uSharp.value = Math.min(1, Math.max(0, (frame.view.k / LINE_SHEET_SCALE - 0.8) / 1.5));
      land.uInkWeight.value = 1 - 0.4 * raw.closeness;
      const friendly = friendlyBorderInk(mapVisuals.friendlyBorderStyle);
      land.uFriendly.value.set(friendly.dashed, friendly.solid);
      const front = getBoardTune().enemyBand ? { dual: 0, classic: 0 } : frontlineInk(mapVisuals.frontlineStyle);
      land.uFrontStyle.value.set(front.dual, front.classic);
      land.uInk.value.copy(tune.borders === "previous" ? SEPIA_INK : SHOGUN_INK);
    }

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

    // The standing figures, as cards cut to their own pictures, for the sun to cast.
    const figures = frame.figures ?? null;
    let cards = 0;
    if (casting && figures?.mask && figures.cards.length > 0) {
      const mask = figures.mask;
      rig.mask = canvasSlot(rig.mask, mask, store.paint);
      kit.cardCaster.uniforms.uFigures.value = rig.mask.texture;
      if (rig.paint !== store.paint) {
        rig.cards.geometry.instanceCount = layFigureCards(rig, frame, figures, mask, shift);
        rig.paint = store.paint;
      }
      cards = rig.cards.geometry.instanceCount;
    } else {
      rig.paint = -1;
    }
    rig.cards.visible = cards > 0;
    for (const child of board.current.children) {
      if (child.layers.mask === 1 << CASTER_LAYER) {
        child.visible = casting && ((child as THREE.Mesh).material !== kit.propCaster || detail.props > 0.001);
      }
    }

    // A shadow under every counter. Fixed and faint from altitude, cast by the sun close in. Where
    // the figures cast their own, what is left under a stack is the dark beneath its base.
    unitShadows.count = writeUnitShadows(unitShadows.instanceMatrix.array as Float32Array, frame, sun, UNIT_SHADOW_LIFT, cards > 0);
    unitShadows.instanceMatrix.needsUpdate = true;
    const shadow = 0.2 + (sun.shadow - 0.2) * detail.relief * sun.direct;
    kit.unitShadow.uniforms.uAlpha.value = shogun ? shadow * (mapVisuals.contactShadow / 0.32) : shadow;

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
    const pixelsPerCss = size.x / Math.max(1, frame.width);

    // The line round a marked stack: its figures alone, read back in the grade.
    const lineLook = outlineLook(mapVisuals.outlineMode);
    const slots = figures?.atlas && lineLook.line + lineLook.wash > 0 ? figures.slots : [];
    setDefine(post.grade, "OUTLINE", slots.length > 0 ? 1 : null);
    if (slots.length > 0 && figures?.atlas) {
      outlineMap.current = canvasSlot(outlineMap.current, figures.atlas, store.paint);
      grade.uOutMap.value = outlineMap.current.texture;
      grade.uOutSize.value.set(figures.atlas.width, figures.atlas.height);
      for (let i = 0; i < OUTLINE_SLOTS; i++) {
        const slot = slots[i];
        const picked = slot?.kind === "selected";
        grade.uOutRect.value[i].set(slot?.x ?? 0, slot?.y ?? 0, slot?.w ?? 0, slot?.h ?? 0);
        grade.uOutAt.value[i].set(slot?.atlasX ?? 0, slot?.atlasY ?? 0);
        const ink = picked ? SELECT_INK : HOVER_INK;
        grade.uOutInk.value[i].set(ink.x, ink.y, ink.z, picked ? 1 : 0.72);
      }
      grade.uOutLook.value.set(lineLook.line, lineLook.wash, 1.6 * pixelsPerCss, 7 * pixelsPerCss);
    } else if (outlineMap.current) {
      outlineMap.current.texture.dispose();
      outlineMap.current = null;
      grade.uOutMap.value = null;
    }

    // The finishing passes. The shade follows the relief up from nothing, so it costs nothing from altitude.
    const shadeLook = aoLook(mapVisuals.aoWeight);
    const shade = shadeLook ? shadeLook.strength * detail.relief : 0;
    const effects: FrameEffects = {
      ao:
        shadeLook && shade > 0.01
          ? {
              strength: shade,
              samples: shadeLook.samples,
              scale: shadeLook.scale,
              reach: shadeLook.radius,
              halfWidth: pose.halfWidth,
              halfHeight: pose.halfHeight,
              near: camera.near,
              far: camera.far,
            }
          : null,
      bloom: glowing && glowLook ? { strength: glowLook.strength, levels: glowLook.levels, threshold: BLOOM_THRESHOLD } : null,
      grain: grainAmount(mapVisuals.filmGrainWeight, raw.closeness),
      grainPixel: Math.max(1, Math.round(pixelsPerCss)),
    };
    post.configure(effects.ao !== null, effects.bloom !== null);

    const autoClear = gl.autoClear;
    const copies = frame.copies.length > 0 ? frame.copies : [0];
    try {
      gl.autoClear = false;
      // The sun's picture first: everything that casts, once for each copy of the world in view.
      if (casting && rig.target) {
        gl.setRenderTarget(rig.target);
        gl.clear(false, true, false);
        copies.forEach((dx, i) => {
          board.current!.position.x = dx;
          board.current!.updateMatrixWorld(true);
          once.current!.visible = i === 0;
          gl.render(scene, rig.camera);
        });
      }
      // The board, once for each copy of the world in view. The water and the unit shadows cover them all.
      gl.setRenderTarget(post.board);
      gl.clear(true, true, true);
      copies.forEach((dx, i) => {
        board.current!.position.x = dx;
        board.current!.updateMatrixWorld(true);
        sea.current!.visible = i === 0;
        once.current!.visible = i === 0;
        gl.render(scene, camera);
      });
      sea.current.visible = true;
      once.current.visible = true;
      post.finish(gl, detail.focus * LENS_RADIUS * pixelsPerCss, look === "dusk" ? detail.vignette * 1.15 : detail.vignette, effects);
    } finally {
      // Whatever went wrong above, the next frame starts from the renderer as it was handed over.
      if (sea.current) {
        sea.current.visible = true;
      }
      if (once.current) {
        once.current.visible = true;
      }
      gl.autoClear = autoClear;
      gl.setRenderTarget(null);
    }

    if (moving) {
      invalidate();
    }
  }, 1);

  return (
    <>
      <mesh ref={sea} geometry={plane} material={kit.water} frustumCulled={false} renderOrder={-2} />
      <group ref={once}>
        <primitive object={unitShadows} />
        <primitive object={rig.cards} />
      </group>
      <group ref={board}>
        <mesh geometry={slab} material={shogunTextures ? [shogunLand, kit.cliff] : [kit.landTop, kit.cliff]} position={[0, 0, -SEA_DROP]} frustumCulled={false} renderOrder={-1} />
        {/* The cliff once more, for the sun's shadow map only. */}
        <mesh geometry={slab} material={slabCaster} position={[0, 0, -SEA_DROP]} frustumCulled={false} layers={CASTER_LAYER} visible={false} />
        <Craters scars={scars} kit={kit} />
        {PROP_KINDS.map((kind) => (plan.props[kind].length > 0 ? <PropField key={kind} kind={kind} instances={plan.props[kind]} kit={kit} /> : null))}
        <Smoke scars={scars} chimneys={plan.chimneys} kit={kit} />
      </group>
    </>
  );
}
