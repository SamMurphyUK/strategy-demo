// The harbor and the airbase as miniature models, in the same low-poly style as the board's houses and factories. No React, no canvas.
//
// Each is built from flat-faced boxes and posts, a colour and a part number a vertex (see propMeshes.ts), and is drawn by the
// landmark material, so it takes the sun, the shadows and the zoom reveal as a landmark does. Like a landmark it is placed, moved,
// turned and resized in the placement editor, under the key `landmark:harbor:<territory>` or `landmark:airbase:<territory>`.
//
// Axes: the model stands on z = 0, its long axis runs along +x, and it is about one unit long.
//   harbor   +x points out to sea. z = 0 is the quay's deck; the pilings run down to z = -0.55 and the breakwater is built from below.
//            It is stood at the foot of a cliff, with its deck a hair above the water, and the pilings go on into the swell.
//   airbase  +x runs along the strip. z = 0 is the ground.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { gableRoof, part, PART_FIXED, post } from "./propMeshes";
import type { Rgb } from "./propPlan";

export type FacilityKind = "harbor" | "airbase";

/** Footprint of a facility on the board, in world units for a model one unit long. */
export const FACILITY_SCALE: Readonly<Record<FacilityKind, number>> = Object.freeze({ harbor: 9, airbase: 7.5 });

// The walls are fixed colours: a landmark's tint is white, so a tinted wall would shine.
const WALL: Rgb = [0.72, 0.64, 0.55];
const WALL_SHADE: Rgb = [0.64, 0.57, 0.5];
const STONE: Rgb = [0.5, 0.48, 0.47];
const STONE_DARK: Rgb = [0.4, 0.38, 0.38];
const PLANK: Rgb = [0.46, 0.37, 0.31];
const PILING: Rgb = [0.3, 0.25, 0.23];
const CRANE: Rgb = [0.56, 0.33, 0.3];
const ROOF: Rgb = [0.62, 0.38, 0.33];
const ROOF_DARK: Rgb = [0.33, 0.28, 0.31];
const ASPHALT: Rgb = [0.3, 0.3, 0.32];
const PSP: Rgb = [0.42, 0.41, 0.38];
const PAINT: Rgb = [0.8, 0.77, 0.68];
const GLASS: Rgb = [0.38, 0.46, 0.5];
const SOCK: Rgb = [0.85, 0.45, 0.22];

/** A box with its footprint centred on (x, y) and its underside at z0. */
function box(width: number, depth: number, height: number, x: number, y: number, z0: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(width, depth, height).translate(x, y, z0 + height / 2);
}

function harborParts(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  // The quay against the cliff: a stone apron with a lip, deep enough to take the cranes and a shed.
  out.push(part(box(0.56, 0.7, 0.08, 0.04, 0, -0.08), STONE, PART_FIXED));
  out.push(part(box(0.56, 0.04, 0.03, 0.04, 0.34, 0), STONE_DARK, PART_FIXED));
  out.push(part(box(0.56, 0.04, 0.03, 0.04, -0.34, 0), STONE_DARK, PART_FIXED));
  // Two finger piers on pilings, reaching out to sea.
  for (const y of [-0.22, 0.22]) {
    out.push(part(box(0.78, 0.1, 0.04, 0.62, y, -0.04), PLANK, PART_FIXED));
    for (const x of [0.4, 0.6, 0.8, 0.98]) {
      for (const side of [-0.04, 0.04]) {
        out.push(part(post(0.022, 0.022, 0.55, 5, -0.55), PILING, PART_FIXED).translate(x, y + side, 0));
      }
    }
  }
  // The breakwater: a long stone mole across the seaward side, with a hooked end, laid low so a ship rides in its lee.
  out.push(part(box(0.9, 0.09, 0.15, 0.62, 0.45, -0.15), STONE, PART_FIXED));
  out.push(part(box(0.09, 0.32, 0.15, 1.04, 0.31, -0.15), STONE, PART_FIXED));
  out.push(part(box(0.9, 0.05, 0.04, 0.62, 0.45, 0), STONE_DARK, PART_FIXED));
  // A shed on the quay, in the house's walls and roof.
  out.push(part(box(0.3, 0.24, 0.16, 0.0, -0.2, 0), WALL, PART_FIXED));
  const [slopes, gables] = gableRoof(0.17, 0.13, 0.16, 0.25, 0).map((roof) => roof.translate(0.0, -0.2, 0));
  out.push(part(slopes, ROOF, PART_FIXED), part(gables, WALL_SHADE, PART_FIXED));
  // A gantry crane at the end of the left pier: four legs, a beam, and a jib that reaches over the water.
  for (const [lx, ly] of [
    [0.9, -0.27],
    [1.0, -0.27],
    [0.9, -0.17],
    [1.0, -0.17],
  ] as const) {
    out.push(part(box(0.022, 0.022, 0.32, lx, ly, 0), CRANE, PART_FIXED));
  }
  out.push(part(box(0.15, 0.13, 0.03, 0.95, -0.22, 0.32), CRANE, PART_FIXED));
  out.push(part(box(0.3, 0.025, 0.025, 1.08, -0.22, 0.33), CRANE, PART_FIXED));
  // Bollards on the quay edge.
  for (const y of [-0.28, 0, 0.28]) {
    out.push(part(post(0.02, 0.025, 0.05, 5), PILING, PART_FIXED).translate(0.3, y, 0));
  }
  return out;
}

function airbaseParts(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  // The strip: a graded runway with a worn centre line, and an apron of pierced steel plank beside it.
  out.push(part(box(1.4, 0.2, 0.014, 0, 0, 0), ASPHALT, PART_FIXED));
  for (let i = 0; i < 7; i++) {
    out.push(part(box(0.09, 0.014, 0.006, -0.57 + i * 0.19, 0, 0.014), PAINT, PART_FIXED));
  }
  out.push(part(box(0.06, 0.2, 0.006, -0.62, 0, 0.014), PAINT, PART_FIXED));
  out.push(part(box(0.06, 0.2, 0.006, 0.62, 0, 0.014), PAINT, PART_FIXED));
  out.push(part(box(0.62, 0.3, 0.012, 0.12, -0.27, 0), PSP, PART_FIXED));
  // A control tower: a squat shaft with a glazed cab and a flat roof.
  out.push(part(box(0.1, 0.1, 0.2, -0.45, -0.42, 0), WALL, PART_FIXED));
  out.push(part(box(0.14, 0.14, 0.07, -0.45, -0.42, 0.2), GLASS, PART_FIXED));
  out.push(part(box(0.16, 0.16, 0.02, -0.45, -0.42, 0.27), ROOF_DARK, PART_FIXED));
  // A hangar on the apron, in the factory's walls and low sawtooth roof.
  out.push(part(box(0.34, 0.22, 0.12, 0.22, -0.4, 0), WALL, PART_FIXED));
  const [slopes, gables] = gableRoof(0.18, 0.12, 0.12, 0.19, 0).map((roof) => roof.translate(0.22, -0.4, 0));
  out.push(part(slopes, ROOF_DARK, PART_FIXED), part(gables, WALL_SHADE, PART_FIXED));
  // A wind sock at the strip's end: a pole with an orange cone leaning off the wind.
  out.push(part(post(0.008, 0.01, 0.16, 4), PILING, PART_FIXED).translate(0.66, 0.2, 0));
  out.push(part(new THREE.ConeGeometry(0.03, 0.11, 6).rotateZ(-Math.PI / 2).translate(0.71, 0.2, 0.15), SOCK, PART_FIXED));
  return out;
}

const BUILDERS: Record<FacilityKind, () => THREE.BufferGeometry[]> = { harbor: harborParts, airbase: airbaseParts };

/** The model for a facility. The caller owns it and disposes it. Carries `aNormY`, so the landmark reveal can rise through it. */
export function facilityGeometry(kind: FacilityKind): THREE.BufferGeometry {
  const parts = BUILDERS[kind]();
  const merged = mergeGeometries(parts, false);
  for (const geometry of parts) {
    geometry.dispose();
  }
  if (!merged) {
    throw new Error(`facility model "${kind}" did not merge`);
  }
  const at = merged.getAttribute("position");
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < at.count; i++) {
    low = Math.min(low, at.getZ(i));
    high = Math.max(high, at.getZ(i));
  }
  const span = Math.max(high - low, 1e-6);
  const norm = new Float32Array(at.count);
  for (let i = 0; i < at.count; i++) {
    norm[i] = (at.getZ(i) - low) / span;
  }
  merged.setAttribute("aNormY", new THREE.BufferAttribute(norm, 1));
  merged.computeBoundingSphere();
  return merged;
}
