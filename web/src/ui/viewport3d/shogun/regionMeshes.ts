// Region shapes as Three.js geometry. No React, no canvas.
//
// Input is the same MultiPolygon the 2D map fills and hit-tests (see regionClip.ts). Map y points
// down and scene y points up, so every point is written as (x, -y).
import * as THREE from "three";
import type { MultiPolygon, Ring } from "../../map/regionClip";

function scenePoints(ring: Ring): THREE.Vector2[] {
  const last = ring.length - 1;
  const closed = last > 0 && ring[0][0] === ring[last][0] && ring[0][1] === ring[last][1];
  const open = closed ? ring.slice(0, last) : ring;
  return open.map(([x, y]) => new THREE.Vector2(x, -y));
}

/** One shape per polygon: the first ring is the outline, the rest are holes. */
export function shapesOf(mp: MultiPolygon): THREE.Shape[] {
  const shapes: THREE.Shape[] = [];
  for (const polygon of mp) {
    const [outline, ...holes] = polygon;
    if (!outline || outline.length < 3) {
      continue;
    }
    const shape = new THREE.Shape(scenePoints(outline));
    for (const hole of holes) {
      if (hole.length >= 3) {
        shape.holes.push(new THREE.Path(scenePoints(hole)));
      }
    }
    shapes.push(shape);
  }
  return shapes;
}

/** A flat fill on the plane z = 0. */
export function flatGeometry(mp: MultiPolygon): THREE.ShapeGeometry {
  return new THREE.ShapeGeometry(shapesOf(mp));
}

/**
 * A raised slab from z = 0 to z = `height`. Material slot 0 is the top and bottom, slot 1 is the
 * cliff around the edge.
 */
export function slabGeometry(mp: MultiPolygon, height: number): THREE.ExtrudeGeometry {
  return new THREE.ExtrudeGeometry(shapesOf(mp), { depth: height, bevelEnabled: false, curveSegments: 1 });
}

/** Every ring of every shape as line segments at height `z`. */
export function outlineGeometry(shapes: readonly MultiPolygon[], z: number): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const mp of shapes) {
    for (const polygon of mp) {
      for (const ring of polygon) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          if (ring[i][0] === ring[j][0] && ring[i][1] === ring[j][1]) {
            continue;
          }
          positions.push(ring[j][0], -ring[j][1], z, ring[i][0], -ring[i][1], z);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

/** Sum of the triangle areas of a geometry, projected on the board plane. */
export function planArea(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  let total = 0;
  for (let i = 0; i < count; i += 3) {
    const a = index ? index.getX(i) : i;
    const b = index ? index.getX(i + 1) : i + 1;
    const c = index ? index.getX(i + 2) : i + 2;
    const abx = position.getX(b) - position.getX(a);
    const aby = position.getY(b) - position.getY(a);
    const acx = position.getX(c) - position.getX(a);
    const acy = position.getY(c) - position.getY(a);
    total += Math.abs(abx * acy - aby * acx) / 2;
  }
  return total;
}

/** A CSS colour as a Three.js colour and an opacity. Reads `#rrggbb` and `rgba(r, g, b, a)`. */
export function paintOf(css: string): { color: THREE.Color; opacity: number } {
  const match = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(css.trim());
  if (!match) {
    return { color: new THREE.Color(css), opacity: 1 };
  }
  const color = new THREE.Color().setRGB(
    Number(match[1]) / 255,
    Number(match[2]) / 255,
    Number(match[3]) / 255,
    THREE.SRGBColorSpace,
  );
  return { color, opacity: match[4] === undefined ? 1 : Number(match[4]) };
}
