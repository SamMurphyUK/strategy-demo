// The height of the sea at a point and a moment: one function, written twice. `waterY` is the JS mirror, read by
// the ship waterline, the waterline rings and the tests. `WATER_Y_GLSL` is the same arithmetic as a shader chunk,
// included by the water's vertex shader and the cliff's, and so by both skins (pixelSkin.ts, bakedSkin.ts), which
// only differ in how they colour the surface. Keep the two in step: a test compares them term by term.
//
// The sea is a gentle ambient swell (the long set that heaves the ships, plus a shorter cross set) and the
// 20-second travelling wave front, a single smooth crest that sweeps the board (see shipSway.ts).
import { frontDirection, frontPosition, SWELL_RATE, SWELL_WAVES, SWELL_WORLD_WIDTH } from "../../map/shipSway";

/** Half width of the front's crest, in world units. */
export const FRONT_CREST_WIDTH = 16;
/** The crest's height against the ambient swell's, so the front is the tallest thing on the water. */
export const FRONT_CREST_GAIN = 2.2;

export interface SwellInput {
  /** The slider: height of the ambient swell, in world units. 0 is a flat sea. */
  amp: number;
  seconds: number;
  loopSeconds: number;
  directionDeg: number;
}

/** Height of the water above its rest level at a board point, in world units. */
export function waterY(x: number, z: number, input: SwellInput): number {
  const { amp, seconds } = input;
  if (!(amp > 0) || !Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(seconds)) {
    return 0;
  }
  const long = Math.sin(seconds * SWELL_RATE - (x / SWELL_WORLD_WIDTH) * SWELL_WAVES * Math.PI * 2);
  const cross = Math.sin(seconds * 0.71 + x * 0.043 + z * 0.057);
  const d = frontDirection(input.directionDeg);
  const away = (x * d.x + z * d.y - frontPosition(seconds, input.loopSeconds, input.directionDeg)) / FRONT_CREST_WIDTH;
  const crest = Math.exp(-away * away);
  return amp * (0.6 * long + 0.22 * cross + FRONT_CREST_GAIN * crest);
}

/** How steeply the water climbs toward a point (rise over a world unit) along x and z, for foam and the wet band. */
export function waterSlope(x: number, z: number, input: SwellInput): { x: number; z: number } {
  const e = 0.5;
  return {
    x: (waterY(x + e, z, input) - waterY(x - e, z, input)) / (2 * e),
    z: (waterY(x, z + e, input) - waterY(x, z - e, input)) / (2 * e),
  };
}

/** The same function for a shader. Needs `uTime`, `uSwell` (amp, loop seconds, direction x, direction y) and `uFrontAt`. */
export const WATER_Y_GLSL = /* glsl */ `
uniform vec4 uSwell;
uniform float uFrontAt;
float waterY(vec2 p, float t) {
  if (uSwell.x <= 0.0) {
    return 0.0;
  }
  float longSet = sin(t * ${SWELL_RATE.toFixed(4)} - (p.x / ${SWELL_WORLD_WIDTH.toFixed(1)}) * ${SWELL_WAVES.toFixed(1)} * 6.2831853);
  float crossSet = sin(t * 0.71 + p.x * 0.043 + p.y * 0.057);
  float away = (dot(p, uSwell.zw) - uFrontAt) / ${FRONT_CREST_WIDTH.toFixed(1)};
  float crest = exp(-away * away);
  return uSwell.x * (0.6 * longSet + 0.22 * crossSet + ${FRONT_CREST_GAIN.toFixed(1)} * crest);
}
`;
