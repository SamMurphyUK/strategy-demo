// The close-up ground: a world-space tiled surface that comes in over the pixel chart as the camera nears the board.
//
// Four sets, one for each kind of ground the chart already knows: flocked grass, wind-rippled sand, crystalline snow, and
// coarse slate rock for the ranges and the cliffs. Each is a height field in world space, so it never slides under the
// camera, and a slope, a roughness, and a tint come out of it. They are procedural, not sampled, so there is no albedo map
// to put through a colour curve: the chart's own palette stays the albedo, and the set only moves its light, its cavities,
// and its highlights. Everything stays in the display space the board is lit in (see CLAUDE.md): nothing here is tone
// mapped, sand is held under 0.92 so it shimmers without blooming, and only snow is let past 1.0, by a hair (SNOW_PEAK).
//
// `uDiorama` is (blend, tile scale, normal strength, 0). The blend is 0 below the diorama zoom, so the chart is untouched there.

/** How far past white a lit snow crest is pushed, so it alone feeds the bloom. */
export const SNOW_PEAK = 1.08;
/** The brightest sand can be. */
export const SAND_CEILING = 0.92;

/** The zoom the cross-fade starts at and finishes at. */
export const DIORAMA_FROM = 3.8;
export const DIORAMA_TO = 4.3;

/** The cross-fade at a zoom: 0 up to `DIORAMA_FROM`, 1 from `DIORAMA_TO`, an ease between. Pure. */
export function dioramaFade(k: number): number {
  const t = Math.min(1, Math.max(0, (k - DIORAMA_FROM) / (DIORAMA_TO - DIORAMA_FROM)));
  return t * t * (3 - 2 * t);
}

export const DIORAMA_GLSL = /* glsl */ `
uniform vec4 uDiorama;

// Flocked static grass: tufts at three sizes.
float dioFlock(vec2 p) {
  return vnoise(p * 2.6) * 0.5 + vnoise(p * 6.3) * 0.32 + vnoise(p * 15.0) * 0.18;
}
// Wind-rippled sand: long ripples with a lazy bend, steeper on the lee side, and a fine grain between.
float dioRipple(vec2 p) {
  float ph = dot(p, vec2(4.6, 2.6)) + vnoise(p * 0.9) * 3.2;
  float s = sin(ph);
  float ripple = 0.5 + 0.5 * (s - 0.25 * sin(ph * 2.0 + 0.8));
  return ripple * 0.82 + vnoise(p * 14.0) * 0.18;
}
// Crystalline snow: a fine crust and glints.
float dioSnowH(vec2 p) {
  return vnoise(p * 9.0) * 0.45 + vnoise(p * 21.0) * 0.35 + vnoise(p * 47.0) * 0.2;
}
// Slate: ridged strata, read on all three faces and blended by which way the surface looks.
float dioRidge(vec2 p) {
  float a = 1.0 - abs(vnoise(p) * 2.0 - 1.0);
  float b = 1.0 - abs(vnoise(p * 2.7 + 5.1) * 2.0 - 1.0);
  return a * 0.62 + b * 0.38;
}
float dioRock(vec3 q, vec3 w) {
  return dioRidge(q.yz * 1.4) * w.x + dioRidge(q.xz * 1.4) * w.y + dioRidge(q.xy * 1.4) * w.z;
}

// The ground's height at a point, by how much of each kind it is: grass, sand, snow, rock.
float dioHeight(vec3 q, vec4 w, vec3 faces) {
  // The tiles are sized for a figure's scale: a tuft about half a base's width.
  q *= 0.45;
  vec2 p = q.xy;
  float h = dioFlock(p) * w.x + dioRipple(p) * w.y + dioSnowH(p) * w.z;
  h += dioRock(q, faces) * w.w;
  return h / max(w.x + w.y + w.z + w.w, 1e-3);
}

// How rough the surface is, from 0 (glossy) to 1 (matte).
float dioRough(vec3 q, vec4 w) {
  q *= 0.45;
  vec2 p = q.xy;
  float grass = 0.97 - 0.12 * dioFlock(p);
  float sand = 0.66 + 0.26 * vnoise(p * 33.0);
  float snow = 0.42 + 0.22 * vnoise(p * 61.0);
  float rock = 0.8 + 0.15 * vnoise(p * 5.0);
  return (grass * w.x + sand * w.y + snow * w.z + rock * w.w) / max(w.x + w.y + w.z + w.w, 1e-3);
}
`;
