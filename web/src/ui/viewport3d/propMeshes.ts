// The table dressing as low-poly models, and the buffers that place them. No React, no canvas.
//
// Every model stands on the plane z = 0, is about one unit wide and one unit tall, and has flat
// faces, so the sun picks each facet out the way it does on a cast miniature. An instance scales
// the footprint and the height separately (see PropInstance).
//
// Each vertex carries a colour and a part number:
//   0  a fixed colour (trunk, roof, chimney)
//   1  the instance's tint, times the red channel as a shade (foliage, rock, walls)
//   2  as 1, and snow when the instance's flag is set (the top of a peak)
//   3  a fixed colour, shown only when the instance's flag is set (a factory's second chimney)
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FACTORY_CHIMNEY, type PropInstance, type PropKind, type Rgb } from "./propPlan";

export const PART_FIXED = 0;
export const PART_TINT = 1;
export const PART_SNOW = 2;
export const PART_OPTIONAL = 3;

const TRUNK: Rgb = [0.4, 0.33, 0.3];
const PALM_TRUNK: Rgb = [0.6, 0.5, 0.39];
const ROOF: Rgb = [0.62, 0.38, 0.33];
const FACTORY_ROOF: Rgb = [0.33, 0.28, 0.31];
const CHIMNEY: Rgb = [0.5, 0.33, 0.33];
const SOOT: Rgb = [0.25, 0.21, 0.24];

/** Paints a geometry one colour and one part, and gives it flat faces. */
export function part(source: THREE.BufferGeometry, color: Rgb, mode: number): THREE.BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source;
  geometry.deleteAttribute("uv");
  geometry.deleteAttribute("normal");
  const count = geometry.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  const parts = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color[0];
    colors[i * 3 + 1] = color[1];
    colors[i * 3 + 2] = color[2];
    parts[i] = mode;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aPart", new THREE.BufferAttribute(parts, 1));
  geometry.computeVertexNormals();
  return geometry;
}

export const shadeOf = (value: number): Rgb => [value, value, value];

/** A cone standing on z = `base`. */
export function cone(radius: number, height: number, sides: number, base: number): THREE.BufferGeometry {
  return new THREE.ConeGeometry(radius, height, sides, 1).rotateX(Math.PI / 2).translate(0, 0, base + height / 2);
}

/** A tapered post standing on z = `base`. */
export function post(top: number, bottom: number, height: number, sides: number, base = 0): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(top, bottom, height, sides, 1).rotateX(Math.PI / 2).translate(0, 0, base + height / 2);
}

function blob(radius: number, x: number, y: number, z: number, squash = 0.85): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(radius, 0).scale(1, 1, squash).translate(x, y, z);
}

/** A repeatable number in [0, 1) from a position, so the copies of a shared corner move together. */
function jitterOf(x: number, y: number, z: number, salt: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + salt * 19.19) * 43758.5453;
  return s - Math.floor(s);
}

function triangles(points: readonly (readonly [number, number, number])[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points.flat(), 3));
  return geometry;
}

/** A roof with its ridge along x: two slopes and two gable ends. */
export function gableRoof(halfLength: number, halfSpan: number, eaves: number, ridge: number, cx = 0): THREE.BufferGeometry[] {
  const a: [number, number, number] = [cx - halfLength, -halfSpan, eaves];
  const b: [number, number, number] = [cx + halfLength, -halfSpan, eaves];
  const c: [number, number, number] = [cx + halfLength, halfSpan, eaves];
  const d: [number, number, number] = [cx - halfLength, halfSpan, eaves];
  const e: [number, number, number] = [cx - halfLength, 0, ridge];
  const f: [number, number, number] = [cx + halfLength, 0, ridge];
  const slopes = triangles([a, b, f, a, f, e, c, d, e, c, e, f]);
  const gables = triangles([d, a, e, b, c, f]);
  return [slopes, gables];
}

function pine(): THREE.BufferGeometry[] {
  return [
    part(post(0.05, 0.065, 0.22, 4), TRUNK, PART_FIXED),
    part(cone(0.34, 0.44, 6, 0.14), shadeOf(0.8), PART_TINT),
    part(cone(0.27, 0.42, 6, 0.38), shadeOf(0.94), PART_TINT),
    part(cone(0.18, 0.38, 6, 0.62), shadeOf(1.1), PART_TINT),
  ];
}

function broadleaf(): THREE.BufferGeometry[] {
  return [
    part(post(0.05, 0.075, 0.42, 4), TRUNK, PART_FIXED),
    part(blob(0.36, 0, 0, 0.66), shadeOf(1), PART_TINT),
    part(blob(0.25, 0.21, 0.08, 0.52), shadeOf(0.84), PART_TINT),
    part(blob(0.2, -0.15, -0.12, 0.83), shadeOf(1.1), PART_TINT),
  ];
}

function acacia(): THREE.BufferGeometry[] {
  return [
    part(post(0.035, 0.06, 0.76, 4), TRUNK, PART_FIXED),
    part(post(0.5, 0.34, 0.13, 7, 0.74), shadeOf(0.9), PART_TINT),
    part(cone(0.5, 0.13, 7, 0.87), shadeOf(1.08), PART_TINT),
  ];
}

function palm(): THREE.BufferGeometry[] {
  const out = [part(post(0.03, 0.055, 0.88, 4), PALM_TRUNK, PART_FIXED)];
  for (let i = 0; i < 6; i++) {
    const frond = new THREE.ConeGeometry(0.085, 0.5, 3, 1)
      .rotateZ(-Math.PI / 2)
      .scale(1, 1, 0.4)
      .translate(0.25, 0, 0)
      .rotateY(0.42)
      .rotateZ((i / 6) * Math.PI * 2 + 0.3)
      .translate(0, 0, 0.9);
    out.push(part(frond, shadeOf(i % 2 === 0 ? 0.92 : 1.1), PART_TINT));
  }
  return out;
}

function rock(): THREE.BufferGeometry[] {
  const geometry = new THREE.IcosahedronGeometry(0.5, 0);
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const f = 0.78 + 0.4 * jitterOf(Math.round(x * 100), Math.round(y * 100), Math.round(z * 100), 3);
    position.setXYZ(i, x * f, y * f, z * f);
  }
  return [part(geometry.scale(1, 0.85, 1.25).translate(0, 0, 0.42), shadeOf(1), PART_TINT)];
}

function dune(): THREE.BufferGeometry[] {
  const geometry = new THREE.SphereGeometry(0.5, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 0.52, 2);
  const position = geometry.getAttribute("position");
  // Lean the crest downwind, so one side is a long slope and the other a short face.
  for (let i = 0; i < position.count; i++) {
    position.setX(i, position.getX(i) + 0.2 * position.getZ(i));
  }
  return [part(geometry, shadeOf(1), PART_TINT)];
}

/** One faceted summit: a jittered foot, a shoulder ring, a small crown ring, and an apex. Snow lies above the crown. */
function summit(cx: number, cy: number, radius: number, height: number, salt: number, snow: boolean): THREE.BufferGeometry[] {
  const sides = 7;
  const foot: [number, number, number][] = [];
  const shoulder: [number, number, number][] = [];
  const crown: [number, number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const b = ((i + 0.5) / sides) * Math.PI * 2;
    const rf = radius * (0.84 + 0.3 * jitterOf(i, salt, 1, 5));
    const rs = radius * (0.44 + 0.18 * jitterOf(i, salt, 2, 7));
    const rc = radius * (0.17 + 0.07 * jitterOf(i, salt, 4, 13));
    foot.push([cx + Math.cos(a) * rf, cy + Math.sin(a) * rf, 0]);
    shoulder.push([cx + Math.cos(b) * rs, cy + Math.sin(b) * rs, height * (0.42 + 0.14 * jitterOf(i, salt, 3, 11))]);
    crown.push([cx + Math.cos(a) * rc, cy + Math.sin(a) * rc, height * (0.76 + 0.06 * jitterOf(i, salt, 5, 17))]);
  }
  const apex: [number, number, number] = [cx + radius * 0.03, cy - radius * 0.02, height];
  const skirt: [number, number, number][] = [];
  const flank: [number, number, number][] = [];
  const cap: [number, number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    skirt.push(foot[i], foot[next], shoulder[i]);
    skirt.push(foot[next], shoulder[next], shoulder[i]);
    // The crown ring sits on the foot's angles, half a step round from the shoulder's.
    flank.push(shoulder[i], shoulder[next], crown[next]);
    flank.push(shoulder[i], crown[next], crown[i]);
    cap.push(crown[i], crown[next], apex);
  }
  return [
    part(triangles(skirt), shadeOf(0.94), PART_TINT),
    part(triangles(flank), shadeOf(1), PART_TINT),
    part(triangles(cap), shadeOf(1.06), snow ? PART_SNOW : PART_TINT),
  ];
}

function peak(): THREE.BufferGeometry[] {
  return [
    ...summit(0, 0, 0.5, 1, 1, true),
    ...summit(0.36, 0.12, 0.3, 0.58, 2, false),
    ...summit(-0.3, -0.2, 0.26, 0.48, 3, false),
  ];
}

function house(): THREE.BufferGeometry[] {
  const [slopes, gables] = gableRoof(0.35, 0.27, 0.5, 0.84);
  return [
    part(new THREE.BoxGeometry(0.62, 0.46, 0.5).translate(0, 0, 0.25), shadeOf(1), PART_TINT),
    part(gables, shadeOf(0.94), PART_TINT),
    part(slopes, ROOF, PART_FIXED),
  ];
}

function factory(): THREE.BufferGeometry[] {
  const out = [part(new THREE.BoxGeometry(0.92, 0.5, 0.42).translate(0, -0.04, 0.21), shadeOf(1), PART_TINT)];
  // A sawtooth roof: three short ridges across the shed.
  for (const cx of [-0.3, 0, 0.3]) {
    const [slopes, gables] = gableRoof(0.25, 0.155, 0.42, 0.56).map((geometry) => geometry.rotateZ(Math.PI / 2).translate(cx, -0.04, 0));
    out.push(part(slopes, FACTORY_ROOF, PART_FIXED), part(gables, shadeOf(0.9), PART_TINT));
  }
  const stack = (x: number, mode: number) => {
    const shaft = FACTORY_CHIMNEY.top - 0.07 - 0.3;
    out.push(
      part(new THREE.BoxGeometry(0.1, 0.1, shaft).translate(x, FACTORY_CHIMNEY.y, 0.3 + shaft / 2), CHIMNEY, mode),
      part(new THREE.BoxGeometry(0.13, 0.13, 0.07).translate(x, FACTORY_CHIMNEY.y, FACTORY_CHIMNEY.top - 0.035), SOOT, mode),
    );
  };
  stack(FACTORY_CHIMNEY.x, PART_FIXED);
  stack(-FACTORY_CHIMNEY.x, PART_OPTIONAL);
  return out;
}

const BUILDERS: Record<PropKind, () => THREE.BufferGeometry[]> = { pine, broadleaf, acacia, palm, rock, dune, peak, house, factory };

/** The model for a kind of prop. The caller owns it and disposes it. */
export function propGeometry(kind: PropKind): THREE.BufferGeometry {
  const parts = BUILDERS[kind]();
  const merged = mergeGeometries(parts, false);
  for (const geometry of parts) {
    geometry.dispose();
  }
  if (!merged) {
    throw new Error(`prop model "${kind}" did not merge`);
  }
  merged.computeBoundingSphere();
  return merged;
}

export interface PropBuffers {
  count: number;
  /** Sixteen numbers per instance, column-major: the instance's place, turn, footprint, and height. */
  matrices: Float32Array;
  /** Three per instance: the tint. */
  tints: Float32Array;
  /**
   * Three per instance: the optional-part flag, a number in [0, 1) that is the instance's own, and
   * how much of the ground's colour the prop takes at its foot.
   */
  flags: Float32Array;
}

/**
 * How far each kind takes on the colour of the land it stands on. Peaks, dunes, and rocks are the
 * board itself raised up, so they wear their territory's colour. Trees and roofs keep their own.
 */
export const GROUND_SHARE: Record<PropKind, number> = {
  pine: 0,
  broadleaf: 0,
  acacia: 0,
  palm: 0,
  rock: 0.45,
  dune: 0.62,
  peak: 0.9,
  house: 0,
  factory: 0,
};

/** Instance buffers for a list of props. Map y points down, so the scene's y is its negative. */
export function propBuffers(instances: readonly PropInstance[], ground = 0): PropBuffers {
  const matrices = new Float32Array(instances.length * 16);
  const tints = new Float32Array(instances.length * 3);
  const flags = new Float32Array(instances.length * 3);
  instances.forEach((prop, i) => {
    const c = Math.cos(prop.turn) * prop.scale;
    const s = Math.sin(prop.turn) * prop.scale;
    const m = i * 16;
    matrices[m] = c;
    matrices[m + 1] = s;
    matrices[m + 4] = -s;
    matrices[m + 5] = c;
    matrices[m + 10] = prop.height;
    matrices[m + 12] = prop.x;
    matrices[m + 13] = -prop.y;
    matrices[m + 14] = prop.lift ?? 0;
    matrices[m + 15] = 1;
    tints.set(prop.tint, i * 3);
    flags[i * 3] = prop.snow;
    flags[i * 3 + 1] = jitterOf(prop.x, prop.y, prop.turn, 13);
    flags[i * 3 + 2] = ground;
  });
  return { count: instances.length, matrices, tints, flags };
}
