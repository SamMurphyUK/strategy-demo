// The turned base under a standing figure, as a real model on the board. No React, no canvas.
//
// It is the base basePlinth.ts draws flat, built in three dimensions: an ebony wall, a walnut top with
// a pale bevel, a brass ring let into it, and the faction's colour in the middle. The model stands on
// the plane z = 0, is one unit in radius and one unit tall, and has flat faces, so the sun picks each
// facet out the way it does on a landmark or a roof. An instance scales the footprint and the height
// apart (see plinthPlacement.ts). It is drawn by the prop material, so it takes the sun, the cast
// shadows, and the grade the rest of the board does, and it has the board's own perspective.
//
// Each vertex carries a colour and a part number, as a prop's does:
//   0  a fixed colour (the wall, the top, the bevel, the brass)
//   1  the instance's tint, times the red channel as a shade (the faction's field)
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PLINTH_BEVEL, PLINTH_BRASS, PLINTH_EBONY, PLINTH_WALNUT } from "../map/basePlinth";
import { PART_FIXED, PART_TINT } from "./propMeshes";

/** Sides of every round part. Enough to read as round at the size of a base, few enough to stay faceted. */
const SIDES = 32;

function rgbOf(hex: string): [number, number, number] {
  return [Number.parseInt(hex.slice(1, 3), 16) / 255, Number.parseInt(hex.slice(3, 5), 16) / 255, Number.parseInt(hex.slice(5, 7), 16) / 255];
}

/** Paints a geometry one colour and one part, with flat faces and no height of its own to reveal. */
function part(source: THREE.BufferGeometry, color: readonly [number, number, number], mode: number): THREE.BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source;
  geometry.deleteAttribute("uv");
  geometry.deleteAttribute("normal");
  const count = geometry.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  const parts = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    colors.set(color, i * 3);
    parts[i] = mode;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aPart", new THREE.BufferAttribute(parts, 1));
  // The same attribute a landmark has, at 0 everywhere, so the base is solid whenever it is shown.
  geometry.setAttribute("aNormY", new THREE.BufferAttribute(new Float32Array(count), 1));
  geometry.computeVertexNormals();
  return geometry;
}

/** A flat disc or ring lying at height `z`, facing up. */
function ring(inner: number, outer: number, z: number): THREE.BufferGeometry {
  const geometry = inner > 0 ? new THREE.RingGeometry(inner, outer, SIDES, 1) : new THREE.CircleGeometry(outer, SIDES);
  geometry.translate(0, 0, z);
  return geometry;
}

/** The base: radius 1, height 1, standing on z = 0. */
export function plinthGeometry(bevel = 0.11): THREE.BufferGeometry {
  // The wall narrows a little toward the top, the way a turned base does.
  const wall = new THREE.CylinderGeometry(0.97, 1, 1, SIDES, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  const parts = [
    part(wall, rgbOf(PLINTH_EBONY), PART_FIXED),
    // The top face, and the pale bevel round its edge, a hair above it so the two never fight.
    part(ring(0, 0.97, 1), rgbOf(PLINTH_WALNUT), PART_FIXED),
    ...(bevel > 0.005 ? [part(ring(Math.max(0.64, 0.97 - bevel), 0.97, 1.004), rgbOf(PLINTH_BEVEL), PART_FIXED)] : []),
    // The brass ring let into the wood, and the faction's colour inside it.
    part(ring(0.62, 0.7, 1.008), rgbOf(PLINTH_BRASS), PART_FIXED),
    part(ring(0, 0.62, 1.012), [1, 1, 1], PART_TINT),
  ];
  const merged = mergeGeometries(parts, false);
  for (const geometry of parts) {
    geometry.dispose();
  }
  if (!merged) {
    throw new Error("the base model did not merge");
  }
  merged.computeBoundingSphere();
  return merged;
}
