// A faction roundel as a thin disc on the board, built from its SVG (public/assets/roundels, written by
// scripts/generate_roundels.py). No React, no canvas.
//
// It piggybacks on the plinth: the same ebony wall, the same vertex-coloured faces and parts, drawn by the same prop
// material, so it takes the sun, the shadows and the grade the bases do. The model is one unit in radius and stands
// on z = 0; an instance scales its footprint and its height apart (see roundelPlacement.ts). Every filled shape of the
// SVG becomes a flat layer a hair above the last, in drawing order, so the art reads exactly as drawn.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { PLINTH_BRASS, PLINTH_EBONY } from "../map/basePlinth";
import { PART_FIXED } from "./propMeshes";
import { part, ring, rgbOf } from "./plinthMeshes";

/** The SVG's frame: the artboard, the centre, and the bezel's radius, which becomes the model's radius of 1. */
const CENTRE = 128;
const BEZEL_R = 122;
/** The clip radius inside the bezel, against the bezel's. Anything the art lets run past it is covered by the rim. */
const FACE_R = 114 / BEZEL_R;
/** Sides of the round parts. */
const SIDES = 48;
/** How far the wall runs below the footing, against the disc's height of 1, so a slope never shows daylight under it. */
const SKIRT = 1.5;
/** Each layer of the art lies this far above the last, against the disc's height of 1. */
export const LAYER_STEP = 0.1;
/** Curve segments per curve of the art's outlines. */
const CURVE_SEGMENTS = 10;

/** The SVG's own bezel disc, which the model draws itself, so it is skipped when the art is read. */
function isBezel(shape: THREE.Shape): boolean {
  const box = new THREE.Box2().setFromPoints(shape.getPoints(8));
  return box.max.x - box.min.x > 2 * BEZEL_R - 2;
}

/** The layers of a roundel's art in drawing order, as flat faces in the model's space (radius 1, y north, facing up). */
function artLayers(svg: string): { geometry: THREE.BufferGeometry; color: [number, number, number] }[] {
  const data = new SVGLoader().parse(svg);
  const layers: { geometry: THREE.BufferGeometry; color: [number, number, number] }[] = [];
  for (const path of data.paths) {
    const fill = (path.userData?.style as { fill?: string } | undefined)?.fill;
    if (!fill || fill === "none") {
      continue;
    }
    const shapes = SVGLoader.createShapes(path).filter((shape) => !isBezel(shape));
    if (shapes.length === 0) {
      continue;
    }
    const geometry = new THREE.ShapeGeometry(shapes, CURVE_SEGMENTS);
    // SVG space is y down; the board's is y north. The flip turns the faces over, so the winding is put back.
    geometry.translate(-CENTRE, -CENTRE, 0);
    geometry.scale(1 / BEZEL_R, -1 / BEZEL_R, 1);
    const index = geometry.getIndex();
    if (index) {
      const triangles = index.array as Uint16Array | Uint32Array;
      for (let i = 0; i < triangles.length; i += 3) {
        const swap = triangles[i + 1];
        triangles[i + 1] = triangles[i + 2];
        triangles[i + 2] = swap;
      }
      index.needsUpdate = true;
    }
    layers.push({ geometry, color: [path.color.r, path.color.g, path.color.b] });
  }
  return layers;
}

/** The roundel disc: radius 1, height 1, standing on z = 0. */
export function roundelGeometry(svg: string): THREE.BufferGeometry {
  const layers = artLayers(svg);
  const wall = new THREE.CylinderGeometry(1, 1, 1 + SKIRT, SIDES, 1, true).rotateX(Math.PI / 2).translate(0, 0, (1 - SKIRT) / 2);
  const parts: THREE.BufferGeometry[] = [part(wall, rgbOf(PLINTH_EBONY), PART_FIXED), part(ring(0, 1, 1), rgbOf(PLINTH_EBONY), PART_FIXED)];
  layers.forEach((layer, i) => {
    layer.geometry.translate(0, 0, 1 + LAYER_STEP * (i + 1));
    parts.push(part(layer.geometry, layer.color, PART_FIXED));
  });
  // The dark rim over the art's edge, and the brass hairline let into it, on top of every layer.
  const top = 1 + LAYER_STEP * (layers.length + 1);
  parts.push(part(ring(FACE_R, 1, top), rgbOf(PLINTH_EBONY), PART_FIXED));
  parts.push(part(ring(0.955, 0.972, top + LAYER_STEP * 0.5), rgbOf(PLINTH_BRASS), PART_FIXED));
  const merged = mergeGeometries(parts, false);
  for (const geometry of parts) {
    geometry.dispose();
  }
  if (!merged) {
    throw new Error("the roundel model did not merge");
  }
  merged.computeBoundingSphere();
  return merged;
}

/** How tall the roundel is against its radius at the shipped setting: thin, a little over a quarter of a base's. */
export const ROUNDEL_HEIGHT_RATIO = 0.05;

/** The art's total thickness above the footing, in units of the disc's height (for the tests, and for the lift). */
export function roundelThickness(layerCount: number): number {
  return 1 + LAYER_STEP * (layerCount + 1.5);
}
