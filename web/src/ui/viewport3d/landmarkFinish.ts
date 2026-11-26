// The miniature finish of the city landmarks, worked out when a model loads. Pure but for the geometry it writes into.
//
// A landmark is flat-faced and carries its colour in its vertices. The finish needs two things the shader cannot find for itself on flat faces
// (the normal is the same all over a face, so its screen derivative is zero): which kind of material a vertex is, and whether the surface
// there is a crevice or an edge. Both are found here, once, and written as vertex attributes:
//
//   aMat    1 stone, 2 brick, 3 metal, 4 timber and tile, 5 gilded. 0 means no finish at all, which is what every other model has.
//   aCurve  positive in a recess (neighbouring faces rise in front of this one), negative on a ridge (they fall away behind it), 0 on a plane.
import * as THREE from "three";

export type MaterialClass = 1 | 2 | 3 | 4 | 5;

export const MATERIAL_NAMES: Readonly<Record<MaterialClass, string>> = Object.freeze({ 1: "stone", 2: "brick", 3: "metal", 4: "timber", 5: "gilded" });

/** The class a material's name asks for, or null when the name says nothing. */
export function classOfName(name: string): MaterialClass | null {
  const n = name.toLowerCase();
  if (/gold|gild|brass|dial|finial|brazier|eagle/.test(n)) {
    return 5;
  }
  if (/iron|steel|copper|verdigris|patina|metal|cable|bridge|spire|dome/.test(n)) {
    return 3;
  }
  if (/wood|timber|tile|terracotta|lacquer|roof|torii|pagoda|vermil/.test(n)) {
    return 4;
  }
  if (/brick|sandstone|coral|masonry|ruin|adobe|pyramid/.test(n)) {
    return 2;
  }
  if (/stone|marble|limestone|granite|concrete|plaster|column/.test(n)) {
    return 1;
  }
  return null;
}

/** The class a colour signature suggests, for a vertex whose material has no useful name. Colours are 0 to 1. */
export function classOfColor(r: number, g: number, b: number): MaterialClass {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max > 0 ? (max - min) / max : 0;
  // Gold and brass: yellow and bright.
  if (r > 0.55 && g > 0.42 && b < 0.4 && r - b > 0.25 && g > b + 0.12 && sat > 0.4) {
    return 5;
  }
  // Verdigris and patina: green leaning to teal, muted.
  if (g > r + 0.04 && b > r - 0.05 && sat > 0.12 && max < 0.75) {
    return 3;
  }
  // Vermilion, lacquer and terracotta: strong red-orange.
  if (r > 0.62 && r - g > 0.3 && g > b - 0.02 && sat > 0.6) {
    return 4;
  }
  // Brick and sandstone: warm brown-red or sand, mid-dark.
  if (r > g && g >= b && sat > 0.22 && max < 0.8) {
    return 2;
  }
  // Dark neutral: iron and steel.
  if (sat < 0.18 && max < 0.42) {
    return 3;
  }
  // The rest is pale stone and marble.
  return 1;
}

/** Writes `aMat` for every vertex: the material's class from its name where it has one, else from the vertex's own colour. */
export function writeMaterialClasses(geometry: THREE.BufferGeometry, nameClass: MaterialClass | null = null): void {
  const color = geometry.getAttribute("color");
  const count = geometry.getAttribute("position").count;
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = nameClass ?? classOfColor(color.getX(i), color.getY(i), color.getZ(i));
  }
  geometry.setAttribute("aMat", new THREE.BufferAttribute(out, 1));
}

/**
 * Writes `aCurve` for a non-indexed triangle geometry. For each vertex of a face it looks at the other faces that meet at the same point, and
 * averages how far their centres lie in front of (+) or behind (-) this face's plane, as a share of the distance. In front means the surface
 * curls up round it: a recess, where a wash pools. Behind means it falls away: a ridge, where an edge catches the light. A flat run gives 0.
 */
export function writeCurvature(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute("position");
  const triangles = Math.floor(position.count / 3);
  const normals = new Float32Array(triangles * 3);
  const centres = new Float32Array(triangles * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let t = 0; t < triangles; t++) {
    a.fromBufferAttribute(position, t * 3);
    b.fromBufferAttribute(position, t * 3 + 1);
    c.fromBufferAttribute(position, t * 3 + 2);
    n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
    normals.set([n.x, n.y, n.z], t * 3);
    centres.set([(a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3], t * 3);
  }
  const key = (v: THREE.Vector3) => `${Math.round(v.x * 2000)},${Math.round(v.y * 2000)},${Math.round(v.z * 2000)}`;
  const meet = new Map<string, number[]>();
  for (let i = 0; i < position.count; i++) {
    a.fromBufferAttribute(position, i);
    const k = key(a);
    const list = meet.get(k);
    if (list) {
      list.push(Math.floor(i / 3));
    } else {
      meet.set(k, [Math.floor(i / 3)]);
    }
  }
  const out = new Float32Array(position.count);
  for (let i = 0; i < position.count; i++) {
    const t = Math.floor(i / 3);
    a.fromBufferAttribute(position, i);
    const list = meet.get(key(a)) ?? [];
    let sum = 0;
    let used = 0;
    for (const other of list) {
      if (other === t) {
        continue;
      }
      const dx = centres[other * 3] - a.x;
      const dy = centres[other * 3 + 1] - a.y;
      const dz = centres[other * 3 + 2] - a.z;
      const length = Math.hypot(dx, dy, dz);
      if (length < 1e-6) {
        continue;
      }
      sum += (dx * normals[t * 3] + dy * normals[t * 3 + 1] + dz * normals[t * 3 + 2]) / length;
      used += 1;
    }
    // Scaled so a right angle reads as a solid recess or ridge, and held to one.
    out[i] = used > 0 ? Math.max(-1, Math.min(1, (sum / used) * 2.2)) : 0;
  }
  geometry.setAttribute("aCurve", new THREE.BufferAttribute(out, 1));
}
