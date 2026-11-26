// The battle stage's engine: a plain object that builds the diorama in a THREE.Scene and animates it, with no React in the frame loop.
// BattleStage.tsx only creates it and calls `update` and `render` from useFrame. It reads the battle screen through `getUnits` and never
// writes back, so combat rules and simulation state are untouched (see battleFeed.ts).
import * as THREE from "three";
import { mapVisuals } from "../../map/mapVisualConfig";
import { loadBiome } from "../terrainTextures";
import { landmarkUniforms, propMaterial, sharedUniforms } from "../boardMaterials";
import { loadLandmark } from "../landmarkModels";
import { battleVisuals, getBattleVisualRev } from "../skins/battleVisualConfig";
import { hexToRgb, type BattleSkin, type BattleTerrain } from "../skins/battleSkin";
import { blendPresets, cameraPose } from "./battleCamera";
import { diffSnapshots, pickTarget, snapshotOf, type FeedUnit, type StageEvent, type StageSnapshot } from "./battleFeed";
import {
  HitStop,
  addGroundMark,
  cameraThud,
  muzzleLight,
  recoilKick,
  recoilPitch,
  smokeAlpha,
  smokeColor,
  stepSmoke,
  type GroundMark,
  type SmokePuff,
} from "./battleFx";
import {
  STAGE_DEPTH,
  STAGE_WIDTH,
  airPose,
  depthDesat,
  depthMist,
  depthScale,
  groundShadow,
  layoutLanes,
  toWorld,
  type LaneSlot,
} from "./battleLanes";
import {
  burstMaterial,
  discShadowMaterial,
  flashUniforms,
  FLASH_LIGHTS,
  type FlashUniforms,
  groundMaterial,
  rimMaterial,
  seaMaterial,
  smokeMaterial,
  spriteMaterial,
  tiltShiftMaterial,
  type GroundMaterial,
  type SpriteMaterial,
} from "./battleMaterials";
import { planScatter, type Keepout, type ScatterPiece } from "./battleScatter";
import { createUnitSheet, disposeScatter, loadScatter, paintUnit, type SpriteSheet } from "./battleSprites";

export interface StageOptions {
  skin: BattleSkin;
  terrain: BattleTerrain;
  /** The landmark to raise in the mid-ground, or null. */
  landmarkId: string | null;
  /** Seeds the scatter, so a territory dresses the same each time. */
  seed: number;
  factions: { attacker: string; defender: string };
  getUnits: () => readonly FeedUnit[];
  /** The region touches the sea: the sea strip lies along the front lip. */
  coastal?: boolean;
  /** An offshore battleship fires one opening salvo and sails away (the engine's shore bombardment). */
  bombard?: boolean;
  /** A transport lands the attacker's soldiers into their rank columns, then leaves. */
  amphibious?: boolean;
}

const SMOKE_POOL = 240;
const BURST_POOL = 14;
const SHELL_POOL = 24;
const MARK_CAP = 90;
/** The marks canvas: 28 px a stage unit. */
const MARKS_W = 512;
const MARKS_H = Math.round((MARKS_W * STAGE_DEPTH) / STAGE_WIDTH);

interface UnitView {
  uid: string;
  type: string;
  side: "attacker" | "defender";
  slot: LaneSlot;
  sheet: SpriteSheet;
  group: THREE.Group;
  mesh: THREE.Mesh;
  material: SpriteMaterial;
  disc: THREE.Mesh;
  discMaterial: THREE.ShaderMaterial;
  /** Where the unit stands now, for muzzles and targets. */
  x: number;
  y: number;
  z: number;
  scale: number;
  fireT: number;
  hotT: number;
  alive: boolean;
  fade: number;
  deadAt: number;
}

interface Ship {
  kind: "battleship" | "transport";
  group: THREE.Group;
  mesh: THREE.Mesh;
  material: SpriteMaterial;
  sheet: SpriteSheet;
}

interface Shell {
  active: boolean;
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t0: number;
  dur: number;
  arc: number;
  heavy: boolean;
}

interface Burst {
  active: boolean;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  t0: number;
  life: number;
}

interface Emitter {
  x: number;
  y: number;
  until: number;
  next: number;
  every: number;
  dark: number;
}

const BAYER_DUMMY = new THREE.Object3D();

function v3(hex: string): THREE.Vector3 {
  const c = hexToRgb(hex);
  return new THREE.Vector3(c[0], c[1], c[2]);
}

export class BattleStageEngine {
  readonly scene = new THREE.Scene();
  private readonly opts: StageOptions;
  private readonly skin: BattleSkin;
  private readonly flash: FlashUniforms;
  private readonly root = new THREE.Group();
  private readonly ground: GroundMaterial;
  private readonly marksCanvas = document.createElement("canvas");
  private readonly marksTexture: THREE.CanvasTexture;
  private marks: GroundMark[] = [];
  private readonly resources: { dispose(): void }[] = [];
  private readonly sheets = new Map<string, SpriteSheet>();
  private readonly units = new Map<string, UnitView>();
  private rosterKey = "";
  private scatterMeshes: THREE.Mesh[] = [];
  private scatterKey = "";
  private scatterToken = 0;
  private landmarkMesh: THREE.InstancedMesh | null = null;
  private landmarkDisc: THREE.Mesh | null = null;
  private readonly smoke: THREE.InstancedMesh;
  private readonly smokeAlphaAttr: THREE.InstancedBufferAttribute;
  private readonly puffs: SmokePuff[] = [];
  private readonly emitters: Emitter[] = [];
  private readonly shells: Shell[] = [];
  private readonly bursts: Burst[] = [];
  private readonly hitStop = new HitStop();
  private readonly pending: { at: number; fn: () => void }[] = [];
  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  private previous: StageSnapshot | null = null;
  private time = 0;
  private real = 0;
  private thudT = -9;
  private thudAmp = 1;
  private activity = 0;
  private salt = 1;
  private prepared = false;
  private rng: () => number;
  private lastRev = -1;
  // The tilt-shift pass.
  private target: THREE.WebGLRenderTarget | null = null;
  private readonly lens = tiltShiftMaterial();
  private readonly lensScene = new THREE.Scene();
  private readonly lensCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly lensQuad: THREE.Mesh;
  private targetW = 0;
  private targetH = 0;
  private disposed = false;
  /** A test aid: `?stagespeed=8` runs the stage's clock faster, for a slow machine. 1 otherwise. */
  private readonly speed = Math.max(1, Number(new URLSearchParams(window.location.search).get("stagespeed")) || 1);
  private sea: THREE.ShaderMaterial | null = null;
  private epoch = -1;
  private ships: Ship[] = [];
  private gunship: UnitView | null = null;

  constructor(opts: StageOptions) {
    this.opts = opts;
    this.skin = opts.skin;
    this.flash = flashUniforms(opts.skin);
    this.rng = mulberry(opts.seed);
    this.scene.add(this.root);
    this.scene.background = new THREE.Color(0, 0, 0);
    (this.scene.background as THREE.Color).setRGB(0.085, 0.07, 0.06, THREE.NoColorSpace);

    // The slice: a thick beveled slab, its rim, and the ground on top.
    const { thickness, bevel } = opts.skin.rim;
    const shape = new THREE.Shape();
    const hw = STAGE_WIDTH / 2;
    const hd = STAGE_DEPTH / 2;
    shape.moveTo(-hw, -hd);
    shape.lineTo(hw, -hd);
    shape.lineTo(hw, hd);
    shape.lineTo(-hw, hd);
    shape.closePath();
    const slab = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, steps: 1 });
    slab.translate(0, 0, -(thickness + bevel));
    const rim = rimMaterial(opts.skin);
    this.root.add(new THREE.Mesh(slab, rim));
    this.resources.push(slab, rim);

    this.marksCanvas.width = MARKS_W;
    this.marksCanvas.height = MARKS_H;
    this.marksTexture = new THREE.CanvasTexture(this.marksCanvas);
    this.marksTexture.colorSpace = THREE.NoColorSpace;
    this.marksTexture.generateMipmaps = false;
    this.marksTexture.minFilter = THREE.LinearFilter;
    this.marksTexture.magFilter = THREE.LinearFilter;
    this.resources.push(this.marksTexture);
    this.paintMarks();
    this.ground = groundMaterial(opts.skin, opts.terrain, this.flash);
    this.ground.uniforms.uMarks.value = this.marksTexture;
    const groundGeometry = new THREE.PlaneGeometry(STAGE_WIDTH, STAGE_DEPTH);
    const groundMesh = new THREE.Mesh(groundGeometry, this.ground);
    groundMesh.position.z = 0.002;
    this.root.add(groundMesh);
    this.resources.push(groundGeometry, this.ground);
    void loadBiome("grass").then((texture) => {
      if (this.disposed || !texture) {
        texture?.dispose();
        return;
      }
      this.ground.uniforms.uGrass.value = texture;
      this.ground.uniforms.uHaveGrass.value = 1;
      this.resources.push(texture);
    });

    // Smoke: one pooled instanced billboard mesh.
    const smokeGeometry = new THREE.PlaneGeometry(1, 1);
    this.smokeAlphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(SMOKE_POOL), 1);
    this.smokeAlphaAttr.setUsage(THREE.DynamicDrawUsage);
    smokeGeometry.setAttribute("aAlpha", this.smokeAlphaAttr);
    const smokeMat = smokeMaterial();
    this.smoke = new THREE.InstancedMesh(smokeGeometry, smokeMat, SMOKE_POOL);
    this.smoke.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SMOKE_POOL * 3), 3);
    this.smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.smoke.count = 0;
    this.smoke.frustumCulled = false;
    this.smoke.renderOrder = 10;
    this.root.add(this.smoke);
    this.resources.push(smokeGeometry, smokeMat, this.smoke);

    // Bursts and shells.
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.rotateX(Math.PI / 2);
    this.resources.push(quad);
    for (let i = 0; i < BURST_POOL; i++) {
      const material = burstMaterial(opts.skin);
      const mesh = new THREE.Mesh(quad, material);
      mesh.visible = false;
      mesh.renderOrder = 12;
      this.root.add(mesh);
      this.bursts.push({ active: false, mesh, material, t0: 0, life: 0.1 });
      this.resources.push(material);
    }
    const tracer = new THREE.PlaneGeometry(0.16, 0.16);
    tracer.rotateX(Math.PI / 2);
    const tracerMaterial = burstMaterial(opts.skin);
    tracerMaterial.uniforms.uFrame.value = 0;
    this.resources.push(tracer, tracerMaterial);
    for (let i = 0; i < SHELL_POOL; i++) {
      const mesh = new THREE.Mesh(tracer, tracerMaterial);
      mesh.visible = false;
      mesh.renderOrder = 12;
      this.root.add(mesh);
      this.shells.push({ active: false, mesh, from: new THREE.Vector3(), to: new THREE.Vector3(), t0: 0, dur: 1, arc: 1, heavy: false });
    }

    this.lensQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.lens);
    this.lensQuad.frustumCulled = false;
    this.lensScene.add(this.lensQuad);
    this.resources.push(this.lensQuad.geometry, this.lens);

    if (opts.coastal) {
      const seaGeometry = new THREE.PlaneGeometry(STAGE_WIDTH, STAGE_DEPTH * 0.1);
      this.sea = seaMaterial();
      const seaMesh = new THREE.Mesh(seaGeometry, this.sea);
      seaMesh.position.set(0, -STAGE_DEPTH / 2 + STAGE_DEPTH * 0.05, 0.012);
      this.root.add(seaMesh);
      this.resources.push(seaGeometry, this.sea);
    }
    this.buildLandmark();
    this.syncConfig(true);
  }

  // --- Building ----------------------------------------------------------------------------------------------------

  private discGeometry: THREE.PlaneGeometry | null = null;

  private disc(opacity: number): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
    this.discGeometry ??= new THREE.PlaneGeometry(1, 1);
    const material = discShadowMaterial();
    material.uniforms.uOpacity.value = opacity;
    const mesh = new THREE.Mesh(this.discGeometry, material);
    mesh.position.z = 0.02;
    mesh.renderOrder = 2;
    this.root.add(mesh);
    this.resources.push(material);
    return { mesh, material };
  }

  /** A standee's geometry: its quad stood up, its feet at the origin, leaned back a little toward the camera so it is not foreshortened. */
  private standeeGeometry(width: number, height: number, centerX: number, centerZ: number): THREE.PlaneGeometry {
    const g = new THREE.PlaneGeometry(width, height);
    g.translate(centerX, centerZ, 0);
    g.rotateX(Math.PI / 2);
    g.rotateX(-this.tilt());
    this.resources.push(g);
    return g;
  }

  private tilt(): number {
    return ((this.skin.camera.establishing.pitchDeg * Math.PI) / 180) * 0.55;
  }

  private sheetFor(type: string, side: "attacker" | "defender"): SpriteSheet {
    const faction = this.opts.factions[side];
    const key = `${type}|${faction}`;
    let sheet = this.sheets.get(key);
    if (!sheet) {
      sheet = createUnitSheet(type, faction);
      this.sheets.set(key, sheet);
      this.resources.push(sheet.texture);
      // The battle screen's shelf pictures load as it goes, so a sheet is painted again as they arrive.
      for (const ms of [250, 900, 2200, 5000]) {
        this.timers.push(
          setTimeout(() => {
            if (!this.disposed && sheet) {
              paintUnit(sheet, type, faction, 0);
            }
          }, ms),
        );
      }
    }
    return sheet;
  }

  private buildRoster(units: readonly FeedUnit[]): void {
    for (const view of this.units.values()) {
      this.root.remove(view.group, view.disc);
      view.discMaterial.dispose();
      view.material.dispose();
      view.mesh.geometry.dispose();
    }
    this.units.clear();
    const slots = layoutLanes(units.map((u) => ({ uid: u.uid, type: u.type, side: u.side, effectiveRank: u.effectiveRank, colIndex: u.colIndex, rowIndex: u.rowIndex, pairedWithUid: u.pairedWithUid })));
    const byUid = new Map(slots.map((s) => [s.uid, s]));
    for (const u of units) {
      const slot = byUid.get(u.uid);
      if (!slot) {
        continue;
      }
      const sheet = this.sheetFor(u.type, u.side);
      const material = spriteMaterial(this.flash, sheet.texture, v3(this.skin.grade.valleyMist));
      const mesh = new THREE.Mesh(this.standeeGeometry(sheet.width, sheet.height, sheet.centerX, sheet.centerZ), material);
      mesh.scale.x = slot.facing;
      mesh.renderOrder = 5;
      const group = new THREE.Group();
      group.add(mesh);
      this.root.add(group);
      const { mesh: disc, material: discMaterial } = this.disc(slot.lane === "air" ? 0.32 : 0.55);
      this.units.set(u.uid, {
        uid: u.uid,
        type: u.type,
        side: u.side,
        slot,
        sheet,
        group,
        mesh,
        material,
        disc,
        discMaterial,
        x: 0,
        y: 0,
        z: 0,
        scale: 1,
        fireT: -9,
        hotT: -9,
        alive: true,
        fade: 1,
        deadAt: -1,
      });
    }
    this.scatterKey = "";
    if (this.epoch < 0 && this.units.size > 0) {
      this.epoch = this.time;
      this.buildShips();
    }
    if (!this.prepared && this.units.size > 0) {
      this.prepared = true;
      this.scheduleBombardment();
    }
  }

  /** The units' slots (not the airspace) as keepouts for the scatter, plus the landmark's plinth. */
  private keepouts(): Keepout[] {
    const out: Keepout[] = [];
    for (const view of this.units.values()) {
      if (view.slot.lane !== "air") {
        out.push({ x: view.slot.x, d: view.slot.d, r: 0.85 });
      }
    }
    if (this.opts.landmarkId) {
      out.push({ x: 0, d: 0.86, r: 3.2 });
    }
    return out;
  }

  private buildScatter(): void {
    const token = ++this.scatterToken;
    for (const mesh of this.scatterMeshes) {
      this.root.remove(mesh);
      (mesh.material as THREE.Material).dispose();
      mesh.geometry.dispose();
    }
    this.scatterMeshes = [];
    const plan: ScatterPiece[] = planScatter(this.skin, this.opts.terrain, battleVisuals.battleScatterDensity, this.opts.seed, this.keepouts()).filter((p) => !(this.opts.coastal && p.d < 0.13));
    void Promise.all(plan.map((piece) => loadScatter(this.skin, piece.set, piece.variant))).then((sprites) => {
      if (this.disposed || token !== this.scatterToken) {
        return;
      }
      plan.forEach((piece, i) => {
        const sprite = sprites[i];
        if (!sprite) {
          return;
        }
        const material = spriteMaterial(this.flash, sprite.texture, v3(this.skin.grade.valleyMist));
        material.uniforms.uMist.value.w = depthMist("rear", battleVisuals) * smoothRange(piece.d, 0.4, 1) * 1.5;
        material.uniforms.uDesat.value = depthDesat("rear", battleVisuals) * smoothRange(piece.d, 0.4, 1);
        const w = sprite.width * piece.scale;
        const h = sprite.height * piece.scale;
        const geometry = new THREE.PlaneGeometry(w, h);
        geometry.translate((0.5 - sprite.anchorX) * w * (piece.flip ? -1 : 1), h / 2, 0);
        geometry.rotateX(Math.PI / 2);
        geometry.rotateX(-this.tilt() * 0.8);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.scale.x = piece.flip ? -1 : 1;
        const [x, y] = toWorld(piece.x, piece.d);
        mesh.position.set(x, y, 0);
        mesh.renderOrder = 4;
        this.root.add(mesh);
        this.scatterMeshes.push(mesh);
      });
    });
  }

  private buildLandmark(): void {
    const id = this.opts.landmarkId;
    if (!id) {
      return;
    }
    void loadLandmark(id).then((geometry) => {
      if (this.disposed || !geometry) {
        return;
      }
      const shared = sharedUniforms();
      shared.uSunDir.value.set(...this.skin.grade.sunDir).normalize();
      const sun = hexToRgb(this.skin.grade.sunColor);
      shared.uSunColor.value.set(sun[0], sun[1], sun[2]);
      const amb = hexToRgb(this.skin.grade.ambient);
      shared.uAmbient.value.set(amb[0], amb[1], amb[2]);
      shared.uRelief.value = 1;
      shared.uDirect.value = 1;
      // The board's own landmark material and its miniature finish: material classes, crevice wash, drybrush edges, foot shade.
      const look = landmarkUniforms();
      look.uLandmarkReveal.value = 1;
      look.uLandmarkBaseShare.value = 0.001;
      look.uLandmarkFinish.value.set(mapVisuals.landmarkWashStrength, mapVisuals.landmarkDrybrushStrength, mapVisuals.landmarkGroundAO);
      const material = propMaterial(shared, look);
      const geo = geometry.clone();
      geo.setAttribute("aFlag", new THREE.InstancedBufferAttribute(new Float32Array(3), 3));
      geo.setAttribute("aRise", new THREE.InstancedBufferAttribute(new Float32Array(2), 2));
      geo.setAttribute("aGone", new THREE.InstancedBufferAttribute(new Float32Array(1), 1));
      const mesh = new THREE.InstancedMesh(geo, material, 1);
      const size = 3.4;
      BAYER_DUMMY.position.set(...toWorld(0, 0.86));
      BAYER_DUMMY.scale.setScalar(size);
      BAYER_DUMMY.rotation.set(0, 0, 0);
      BAYER_DUMMY.updateMatrix();
      mesh.setMatrixAt(0, BAYER_DUMMY.matrix);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array([1, 1, 1]), 3);
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      this.root.add(mesh);
      this.landmarkMesh = mesh;
      const { mesh: disc } = this.disc(0.5);
      disc.position.set(...toWorld(0.35, 0.855));
      disc.position.z = 0.02;
      disc.scale.set(size * 1.1, size * 0.5, 1);
      this.landmarkDisc = disc;
      this.resources.push(geo, material);
    });
  }

  // --- Marks -------------------------------------------------------------------------------------------------------

  private paintMarks(): void {
    const ctx = this.marksCanvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, MARKS_W, MARKS_H);
    ctx.globalCompositeOperation = "lighter";
    const ppu = MARKS_W / STAGE_WIDTH;
    for (const m of this.marks) {
      const px = (m.x / STAGE_WIDTH + 0.5) * MARKS_W;
      const py = (1 - m.d) * MARKS_H;
      const r = m.radius * ppu;
      if (m.kind === 0) {
        const g = ctx.createRadialGradient(px, py, 0, px, py, r * 2.2);
        g.addColorStop(0, "rgba(255,0,0,0.85)");
        g.addColorStop(0.5, "rgba(255,0,0,0.4)");
        g.addColorStop(1, "rgba(255,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(px - r * 2.2, py - r * 2.2, r * 4.4, r * 4.4);
      } else {
        // A crater: a ragged pit with a faint scorch around it.
        const g = ctx.createRadialGradient(px, py, 0, px, py, r * 1.9);
        g.addColorStop(0, "rgba(255,0,0,0.45)");
        g.addColorStop(1, "rgba(255,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(px - r * 1.9, py - r * 1.9, r * 3.8, r * 3.8);
        ctx.fillStyle = "rgba(0,255,0,0.9)";
        ctx.beginPath();
        const steps = 14;
        for (let i = 0; i <= steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          const jag = 0.78 + 0.28 * Math.sin(a * 3 + m.turn) * Math.cos(a * 2 + m.turn * 1.7);
          const x = px + Math.cos(a) * r * jag;
          const y = py + Math.sin(a) * r * jag * 0.62;
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = "source-over";
    this.marksTexture.needsUpdate = true;
  }

  private mark(x: number, d: number, big: boolean): void {
    const turn = this.rng() * 6.28;
    this.marks = addGroundMark(this.marks, { x, d, radius: big ? 0.5 + this.rng() * 0.25 : 0.28 + this.rng() * 0.16, kind: 1, turn }, MARK_CAP);
    this.marks = addGroundMark(this.marks, { x: x + (this.rng() - 0.5) * 0.5, d: d + (this.rng() - 0.5) * 0.04, radius: 0.5 + this.rng() * 0.5, kind: 0, turn }, MARK_CAP);
    this.paintMarks();
  }

  // --- Effects -----------------------------------------------------------------------------------------------------

  private puff(x: number, y: number, z: number, size: number, dark: number, life: number): void {
    if (this.puffs.length >= SMOKE_POOL) {
      this.puffs.shift();
    }
    this.puffs.push({ x, y, z, size, dark, age: 0, life });
  }

  private burst(x: number, y: number, z: number, scale: number, life: number): void {
    const b = this.bursts.find((s) => !s.active) ?? this.bursts[0];
    b.active = true;
    b.t0 = this.time;
    b.life = life;
    b.mesh.visible = true;
    b.mesh.position.set(x, y, z);
    b.mesh.scale.setScalar(scale);
    b.material.uniforms.uFrame.value = 0;
    this.lights.push({ x, y, z: z + 0.5, t0: this.time, peak: scale > 1 ? 1.4 : 1 });
  }

  private lights: { x: number; y: number; z: number; t0: number; peak: number }[] = [];

  private shell(from: THREE.Vector3, to: THREE.Vector3, lob: boolean, heavy: boolean): void {
    const s = this.shells.find((c) => !c.active);
    if (!s) {
      return;
    }
    const dist = from.distanceTo(to);
    s.active = true;
    s.from.copy(from);
    s.to.copy(to);
    s.t0 = this.time;
    s.dur = lob ? 0.7 + dist * 0.05 : 0.18 + dist * 0.035;
    s.arc = lob ? 2 + dist * 0.18 : 0.25 + dist * 0.03;
    s.heavy = heavy;
    s.mesh.visible = true;
  }

  private impact(x: number, y: number, heavy: boolean, fresh = true): void {
    this.burst(x, y, 0.35, heavy ? 1.7 : 1.1, heavy ? 0.2 : 0.12);
    const n = heavy ? 4 : 2;
    for (let i = 0; i < n; i++) {
      this.puff(x + (this.rng() - 0.5) * 0.4, y + (this.rng() - 0.5) * 0.4, 0.15 + this.rng() * 0.3, 0.6 + this.rng() * 0.5, 0.55 + this.rng() * 0.45, 20 + this.rng() * 22);
    }
    const d = y / STAGE_DEPTH + 0.5;
    if (fresh) {
      this.mark(x, d, heavy);
    }
    if (heavy) {
      this.emitters.push({ x, y, until: this.time + 26, next: this.time + 0.4, every: 0.9, dark: 0.85 });
    }
  }

  /** A shot from a unit: its recoil, a burst and a warm light at the muzzle, a shell to the target, and the impact when it lands. */
  private shoot(view: UnitView, target: { x: number; y: number; z: number } | null, lob: boolean, heavyImpact: boolean): void {
    view.fireT = this.time;
    this.activity = Math.min(1, this.activity + 0.25);
    const dir = view.slot.facing;
    const muzzle = new THREE.Vector3(view.x + dir * 0.85 * view.scale, view.y, view.z + (view.slot.lane === "air" ? 0 : 0.75 * view.scale));
    this.burst(muzzle.x, muzzle.y, muzzle.z, 0.8 * view.scale + 0.2, 0.1);
    this.puff(muzzle.x + dir * 0.2, muzzle.y, muzzle.z, 0.4, 0.2, 5);
    const to = target ? new THREE.Vector3(target.x, target.y, target.z) : new THREE.Vector3(muzzle.x + dir * 3, muzzle.y, 0);
    this.shell(muzzle, to, lob, heavyImpact);
    const flight = lob ? 0.7 + muzzle.distanceTo(to) * 0.05 : 0.18 + muzzle.distanceTo(to) * 0.035;
    this.pending.push({
      at: this.time + flight,
      fn: () => {
        if (target) {
          this.impact(to.x, to.y, heavyImpact || lob);
        }
      },
    });
  }

  private scheduleBombardment(): void {
    // The preparatory bombardment: the batteries open before the first exchange, and the field is cratered and smoking by the time the lines meet.
    const guns = [...this.units.values()].filter((v) => v.type === "artillery");
    const pool = guns.length > 0 ? guns : [...this.units.values()].filter((v) => v.slot.lane === "front");
    if (pool.length === 0) {
      return;
    }
    const salvos = 9;
    for (let i = 0; i < salvos; i++) {
      const at = this.time + 0.5 + i * 0.42;
      this.pending.push({
        at,
        fn: () => {
          const gun = pool[i % pool.length];
          const toward = gun.side === "attacker" ? 1 : -1;
          const tx = toward * (1 + this.rng() * 5.5);
          const td = 0.2 + this.rng() * 0.35;
          const [wx, wy] = toWorld(tx, td);
          this.shoot(gun, { x: wx, y: wy, z: 0.1 }, true, true);
        },
      });
    }
  }

  private handle(event: StageEvent, snapshot: StageSnapshot): void {
    const view = this.units.get(event.uid);
    if (!view) {
      return;
    }
    if (event.kind === "fire") {
      const target = pickTarget(snapshot, event, this.salt++);
      const tv = target ? this.units.get(target.uid) : undefined;
      this.shoot(view, tv ? { x: tv.x, y: tv.y, z: tv.z + 0.6 * tv.scale } : null, view.type === "artillery", false);
    } else if (event.kind === "hit") {
      view.hotT = this.time;
      const rear = view.slot.lane === "rear";
      this.burst(view.x, view.y, view.z + 0.7 * view.scale, event.heavy ? 1.6 : 1, event.heavy ? 0.18 : 0.1);
      this.puff(view.x, view.y, view.z + 0.3, 0.8, 0.7, 24);
      if (event.heavy) {
        this.hitStop.trigger(battleVisuals.battleHitStopFrames);
        this.thudT = this.real;
        this.thudAmp = battleVisuals.battleCameraThud;
        this.mark(view.x, view.y / STAGE_DEPTH + 0.5, true);
      }
      if (event.destroyed) {
        // A wreck smoulders for the rest of the battle.
        this.emitters.push({ x: view.x, y: view.y, until: Infinity, next: this.time, every: rear ? 1.3 : 1.0, dark: 1 });
      }
    } else {
      view.hotT = this.time;
      this.hitStop.trigger(battleVisuals.battleHitStopFrames);
      this.thudT = this.real;
      this.thudAmp = battleVisuals.battleCameraThud * 0.6;
    }
  }

  // --- Frame -------------------------------------------------------------------------------------------------------

  private syncConfig(force: boolean): void {
    const rev = getBattleVisualRev();
    if (!force && rev === this.lastRev) {
      return;
    }
    this.lastRev = rev;
    this.ground.uniforms.uMistAmt.value = 0.1 + 0.4 * battleVisuals.battleValleyMist;
    this.lens.uniforms.uBlur.value = battleVisuals.battleTiltShift;
    this.scatterKey = "";
  }

  /** Advances the stage by `delta` seconds and poses the camera. */
  update(delta: number, camera: THREE.PerspectiveCamera, aspect: number): void {
    const dt = Math.min(0.05 * this.speed, Math.max(0, delta) * this.speed);
    this.real += dt;
    const step = this.hitStop.advance(dt);
    this.time += step;
    this.syncConfig(false);

    // The roster, and the events between this snapshot and the last.
    const feed = this.opts.getUnits();
    const snapshot = snapshotOf(feed);
    const key = feed.map((u) => `${u.uid}:${u.effectiveRank ?? ""}:${u.colIndex ?? ""}:${u.rowIndex ?? ""}:${u.pairedWithUid ?? ""}`).join("|");
    if (key !== this.rosterKey && feed.length > 0) {
      this.rosterKey = key;
      this.buildRoster(feed);
    }
    for (const event of diffSnapshots(this.previous, snapshot)) {
      this.handle(event, snapshot);
    }
    this.previous = snapshot;
    const state = new Map(snapshot.units.map((u) => [u.uid, u]));

    const sig = `${battleVisuals.battleScatterDensity.toFixed(2)}|${this.units.size}`;
    if (sig !== this.scatterKey && this.units.size > 0) {
      this.scatterKey = sig;
      this.buildScatter();
    }

    this.poseUnits(state);
    this.poseShips();
    if (this.sea) {
      this.sea.uniforms.uTime.value = this.time;
    }
    this.runPending();
    this.runShells();
    this.runBursts();
    this.runSmoke(step);
    this.pose(camera, aspect);
  }


  // --- The sea strip's ships ---------------------------------------------------------------------------------------

  private makeShip(kind: Ship["kind"]): Ship {
    const sheet = this.sheetFor(kind, "attacker");
    const material = spriteMaterial(this.flash, sheet.texture, v3(this.skin.grade.valleyMist));
    const mesh = new THREE.Mesh(this.standeeGeometry(sheet.width, sheet.height, sheet.centerX, sheet.centerZ), material);
    mesh.renderOrder = 6;
    const group = new THREE.Group();
    group.add(mesh);
    group.visible = false;
    this.root.add(group);
    return { kind, group, mesh, material, sheet };
  }

  /** The offshore battleship (one salvo, then it sails away) and the transport (it lands the soldiers, then leaves). */
  private buildShips(): void {
    const seaY = -STAGE_DEPTH / 2 + STAGE_DEPTH * 0.045;
    if (this.opts.coastal && this.opts.bombard) {
      this.ships.push(this.makeShip("battleship"));
      const fake = { x: -7.4, y: seaY, z: 0.5, scale: 0.9, fireT: -9, slot: { facing: 1, lane: "front" } } as unknown as UnitView;
      this.gunship = fake;
      for (let i = 0; i < 3; i++) {
        this.pending.push({
          at: this.time + 0.3 + i * 0.35,
          fn: () => {
            const [wx, wy] = toWorld(2 + this.rng() * 3, 0.25 + this.rng() * 0.2);
            this.shoot(fake, { x: wx, y: wy, z: 0.1 }, false, true);
          },
        });
      }
    }
    if (this.opts.coastal && this.opts.amphibious) {
      this.ships.push(this.makeShip("transport"));
    }
  }

  /** x of the transport now: in from the left edge, held while the soldiers go ashore, then away. */
  private transportX(t: number): number {
    if (t < 3) {
      return -11 + (t / 3) * 5.4;
    }
    if (t < 6.8) {
      return -5.6;
    }
    return -5.6 - (t - 6.8) * 1.5;
  }

  private poseShips(): void {
    if (this.epoch < 0) {
      return;
    }
    const t = this.time - this.epoch;
    const y = -STAGE_DEPTH / 2 + STAGE_DEPTH * 0.045;
    for (const ship of this.ships) {
      let x: number;
      if (ship.kind === "battleship") {
        // It fires its opening salvo, then drifts astern off the left edge.
        x = t < 2.2 ? -7.4 : -7.4 - (t - 2.2) * 0.9;
        if (this.gunship) {
          this.gunship.x = x;
          ship.group.rotation.set(0, -recoilPitch(this.time - this.gunship.fireT, 0.5), 0);
        }
      } else {
        x = this.transportX(t);
      }
      ship.group.position.set(x, y, Math.sin(this.time * 1.6 + x) * 0.04);
      ship.group.scale.setScalar(ship.kind === "battleship" ? 0.9 : 1);
      ship.group.visible = x > -11.5;
      ship.material.uniforms.uFade.value = 1;
    }
  }

  private poseUnits(state: Map<string, StageSnapshot["units"][number]>): void {
    const v = battleVisuals;
    for (const view of this.units.values()) {
      const s = state.get(view.uid);
      const lane = view.slot.lane;
      const scale = depthScale(lane, v);
      view.scale = scale;
      view.alive = s ? s.alive : true;
      if (!view.alive && view.deadAt < 0) {
        view.deadAt = this.time;
      }
      // A fallen unit's dither fades out over three seconds; its wreck's smoke stays.
      view.fade = view.alive ? 1 : Math.max(0, 1 - (this.time - view.deadAt) / 3) * Math.min(1, s?.fade ?? 1);
      let x: number;
      let d: number;
      let h = 0;
      let bank = 0;
      let face: 1 | -1 = view.slot.facing;
      if (lane === "air") {
        const p = airPose(view.side, view.slot.index, view.slot.count, this.time);
        x = p.x;
        d = p.d;
        h = p.y;
        bank = p.bank;
        face = p.facing;
      } else {
        x = view.slot.x;
        d = view.slot.d;
        h = lane === "front" && view.type === "infantry" ? Math.max(0, Math.sin(this.time * 3 + x) * 0.03) : 0;
      }
      if (this.opts.amphibious && this.opts.coastal && view.side === "attacker" && lane !== "air" && this.epoch >= 0) {
        // They come ashore off the transport into their rank columns, one after another.
        const u = Math.min(1, Math.max(0, (this.time - this.epoch - 3 - view.slot.index * 0.16) / 2.2));
        const e = u * u * (3 - 2 * u);
        const tx = this.transportX(this.time - this.epoch);
        const [slotX, slotY] = toWorld(x, d);
        const seaY = -STAGE_DEPTH / 2 + STAGE_DEPTH * 0.045;
        x = tx + (slotX - tx) * e;
        d = (seaY + (slotY - seaY) * e) / STAGE_DEPTH + 0.5;
        h += Math.sin(u * Math.PI) * 0.35;
        if (u <= 0) {
          view.fade = 0;
        }
      }
      const t = this.time - view.fireT;
      const kick = lane === "air" ? 0 : recoilKick(t, v.battleRecoilPitch) * face;
      const [wx, wy] = toWorld(x, d);
      view.x = wx - kick;
      view.y = wy;
      view.z = h;
      view.group.position.set(view.x, view.y, h);
      view.group.scale.setScalar(scale);
      view.group.rotation.set(bank, -face * recoilPitch(t, v.battleRecoilPitch), 0);
      view.mesh.scale.x = face;
      const u = view.material.uniforms;
      u.uDesat.value = depthDesat(lane, v);
      u.uMist.value.w = depthMist(lane, v);
      u.uFade.value = view.fade;
      u.uHot.value = Math.max(0, 1 - (this.time - view.hotT) / 0.14);
      view.mesh.visible = view.fade > 0.02;
      // The contact shadow disc: under the unit's feet, or on the ground below an aircraft, offset away from the sun.
      const sun = this.skin.grade.sunDir;
      if (lane === "air") {
        const g = groundShadow(x, d, h, sun);
        const [sx, sy] = toWorld(g.x, g.d);
        view.disc.position.set(sx, sy, 0.02);
        view.disc.scale.set(view.sheet.width * 0.32 * scale, view.sheet.width * 0.14 * scale, 1);
      } else {
        view.disc.position.set(wx - sun[0] * 0.06, wy - sun[1] * 0.06, 0.02);
        view.disc.scale.set(view.sheet.width * 0.3 * scale, view.sheet.width * 0.13 * scale, 1);
      }
      view.disc.visible = view.fade > 0.2;
      view.discMaterial.uniforms.uOpacity.value = (lane === "air" ? 0.32 : 0.55) * view.fade;
    }
    if (this.landmarkDisc) {
      this.landmarkDisc.visible = true;
    }
  }

  private runPending(): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.pending[i].at <= this.time) {
        const [item] = this.pending.splice(i, 1);
        item.fn();
      }
    }
  }

  private runShells(): void {
    for (const s of this.shells) {
      if (!s.active) {
        continue;
      }
      const u = (this.time - s.t0) / s.dur;
      if (u >= 1) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      const p = s.mesh.position;
      p.lerpVectors(s.from, s.to, u);
      p.z += Math.sin(u * Math.PI) * s.arc;
    }
  }

  private runBursts(): void {
    for (const b of this.bursts) {
      if (!b.active) {
        continue;
      }
      const t = (this.time - b.t0) / b.life;
      const frame = Math.min(4, Math.floor(t * 4));
      if (t >= 1) {
        b.active = false;
        b.mesh.visible = false;
        continue;
      }
      b.material.uniforms.uFrame.value = frame;
    }
    // The warm point lights: the strongest four, each a quick falloff over 90 ms.
    this.lights = this.lights.filter((l) => this.time - l.t0 < 0.1);
    const brightest = [...this.lights].sort((a, b) => muzzleLight(this.time - b.t0) * b.peak - muzzleLight(this.time - a.t0) * a.peak).slice(0, FLASH_LIGHTS);
    const slots = this.flash.uFlash.value;
    for (let i = 0; i < FLASH_LIGHTS; i++) {
      const l = brightest[i];
      if (l) {
        slots[i].set(l.x, l.y, l.z, muzzleLight(this.time - l.t0) * l.peak * battleVisuals.battleMuzzleLight);
      } else {
        slots[i].w = 0;
      }
    }
  }

  private runSmoke(step: number): void {
    const strength = battleVisuals.battleSmokeStrength;
    // Wrecks and craters keep smouldering: each emitter lets out a slow puff every so often.
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      if (this.time > e.until) {
        this.emitters.splice(i, 1);
        continue;
      }
      if (this.time >= e.next) {
        e.next = this.time + e.every * (0.7 + this.rng() * 0.6);
        this.puff(e.x + (this.rng() - 0.5) * 0.3, e.y + (this.rng() - 0.5) * 0.2, 0.2, 0.5, e.dark, 18 + this.rng() * 12);
      }
    }
    let n = 0;
    const ceiling = this.skin.grade.smokeLumaCeiling;
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      stepSmoke(p, step, this.time);
      if (p.age >= p.life) {
        this.puffs.splice(i, 1);
      }
    }
    for (const p of this.puffs) {
      BAYER_DUMMY.position.set(p.x, p.y, p.z);
      BAYER_DUMMY.scale.setScalar(p.size);
      BAYER_DUMMY.rotation.set(0, 0, 0);
      BAYER_DUMMY.updateMatrix();
      this.smoke.setMatrixAt(n, BAYER_DUMMY.matrix);
      const c = smokeColor(p.dark, ceiling);
      this.smoke.setColorAt(n, new THREE.Color().setRGB(c[0], c[1], c[2], THREE.NoColorSpace));
      this.smokeAlphaAttr.setX(n, smokeAlpha(p, strength));
      n++;
    }
    this.smoke.count = n;
    this.smoke.instanceMatrix.needsUpdate = true;
    if (this.smoke.instanceColor) {
      this.smoke.instanceColor.needsUpdate = true;
    }
    this.smokeAlphaAttr.needsUpdate = true;
    (this.smoke.material as THREE.ShaderMaterial).uniforms.uTime.value = this.time;
  }

  private pose(camera: THREE.PerspectiveCamera, aspect: number): void {
    this.activity = Math.max(0, this.activity - 0.012);
    const presets = this.skin.camera;
    const preset = blendPresets(presets.establishing, presets.exchange, this.activity);
    const pose = cameraPose(preset, aspect);
    const thud = cameraThud(this.real - this.thudT, this.thudAmp);
    camera.up.set(0, 0, 1);
    camera.position.set(pose.position[0], pose.position[1], pose.position[2] + thud);
    camera.fov = pose.fovDeg;
    camera.near = 0.5;
    camera.far = 120;
    camera.updateProjectionMatrix();
    camera.lookAt(pose.target[0], pose.target[1], pose.target[2] + thud * 0.5);
    camera.updateMatrixWorld();
  }

  /** Draws the stage through the tilt-shift pass. */
  render(gl: THREE.WebGLRenderer, camera: THREE.Camera, width: number, height: number): void {
    const w = Math.max(2, Math.floor(width));
    const h = Math.max(2, Math.floor(height));
    if (!this.target || w !== this.targetW || h !== this.targetH) {
      this.target?.dispose();
      this.target = new THREE.WebGLRenderTarget(w, h, { samples: 4, colorSpace: THREE.NoColorSpace, depthBuffer: true, stencilBuffer: false });
      this.targetW = w;
      this.targetH = h;
      this.lens.uniforms.uTexel.value.set(1 / w, 1 / h);
    }
    this.lens.uniforms.tDiffuse.value = this.target.texture;
    gl.setRenderTarget(this.target);
    gl.clear();
    gl.render(this.scene, camera);
    gl.setRenderTarget(null);
    gl.clear();
    gl.render(this.lensScene, this.lensCamera);
  }

  dispose(): void {
    this.disposed = true;
    this.timers.forEach(clearTimeout);
    this.target?.dispose();
    for (const view of this.units.values()) {
      view.material.dispose();
      view.discMaterial.dispose();
    }
    for (const mesh of this.scatterMeshes) {
      (mesh.material as THREE.Material).dispose();
      mesh.geometry.dispose();
    }
    this.discGeometry?.dispose();
    this.smoke.dispose();
    for (const r of this.resources) {
      r.dispose();
    }
    disposeScatter();
    this.units.clear();
    this.scatterMeshes = [];
  }
}

function smoothRange(x: number, a: number, b: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

