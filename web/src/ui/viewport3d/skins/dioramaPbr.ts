// The close-up ground: a world-space surface that comes in over the pixel chart as the camera nears the board.
//
// Three CC0 photographed sets, one for each kind of ground the chart knows: meadow, sand, and snow (terrainTextures.ts packs each
// into one texture: normal, roughness, and the diffuse's luminance against its own average). Each is read twice, at two scales
// and two turns, and the two are blended by a slow noise, so no repeat shows. The photographs' colour is never used: the chart's
// own palette stays the albedo, and only the centred luminance modulates it, so the hues stay those of the unit sprites and the
// landmarks. A set that is missing falls back to soft procedural noise. Slate for the ranges stays procedural.
// Everything stays in the display space the board is lit in (see CLAUDE.md): nothing here is tone mapped, sand is held under
// 0.92 so it shimmers without blooming, and only snow is let past 1.0, by a hair (SNOW_PEAK).
//
// `uDiorama` is (blend, tile scale, normal strength, 1 with the textures loaded). The blend is 0 below the diorama zoom, so the
// chart is untouched there. `uDioLook` is (albedo detail strength, snow cold tint, desert heat haze, forest understory tint).

/** How far past white a lit snow crest is pushed, so it alone feeds the bloom. */
export const SNOW_PEAK = 1.05;
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
uniform vec4 uDioLook;
uniform vec4 uDioLook2;
uniform vec4 uTheater0;
uniform vec4 uTheater1;
uniform vec4 uTheater2;
uniform sampler2D uDioSand;
uniform sampler2D uDioGrass;
uniform sampler2D uDioSnow;
uniform sampler2D uForest;

struct DioSample { vec2 slope; float rough; float detail; };

// A soft stand-in for a missing set: no stripes and no static, just a quiet swell.
DioSample dioSoft(vec2 uv) {
  DioSample s;
  float h = vnoise(uv * 3.0) * 0.6 + vnoise(uv * 8.0) * 0.4;
  float hx = vnoise((uv + vec2(0.02, 0.0)) * 3.0) * 0.6 + vnoise((uv + vec2(0.02, 0.0)) * 8.0) * 0.4;
  float hy = vnoise((uv + vec2(0.0, 0.02)) * 3.0) * 0.6 + vnoise((uv + vec2(0.0, 0.02)) * 8.0) * 0.4;
  s.slope = vec2(hx - h, hy - h) / 0.02 * 0.12;
  s.rough = 0.85;
  s.detail = (h - 0.5) * 1.2;
  return s;
}

// One set, read at two scales and two turns and blended by a slow noise: the mesoscale at the tile's own size, the macro at a
// third of it and turned, and the share of each wanders with the ground, so no repeat can be found.
DioSample dioFetch(sampler2D t, vec2 uv) {
  DioSample s;
  mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
  vec4 meso = texture2D(t, uv);
  vec4 macro = texture2D(t, turn * uv * 0.37 + vec2(0.37, 0.71));
  float share = 0.3 + 0.4 * smoothstep(0.25, 0.75, vnoise(uv * 0.55 + 3.1));
  // The macro normal is turned back to the board's axes.
  vec2 macroSlope = ((macro.xy - 0.5) * 2.0) * turn;
  s.slope = (meso.xy - 0.5) * 2.0 * (1.0 - share * 0.5) + macroSlope * share;
  s.rough = mix(meso.z, macro.z, share);
  s.detail = (mix(meso.w, macro.w, share) - 0.5) * 2.0;
  return s;
}

// Broad sweeping dune swells: a long, low undulation the fine ripple rides on. Its slope is what gives silky sand its form.
vec2 dioSwell(vec2 uv) {
  float e = 0.05;
  float h = vnoise(uv * 0.9 + 3.0) * 0.65 + vnoise(uv * 2.1) * 0.35;
  float hx = vnoise((uv + vec2(e, 0.0)) * 0.9 + 3.0) * 0.65 + vnoise((uv + vec2(e, 0.0)) * 2.1) * 0.35;
  float hy = vnoise((uv + vec2(0.0, e)) * 0.9 + 3.0) * 0.65 + vnoise((uv + vec2(0.0, e)) * 2.1) * 0.35;
  return vec2(hx - h, hy - h) / e;
}

// The three kinds of ground blended by their shares (grass, sand, snow).
DioSample dioMix(vec2 uv, vec3 w) {
  DioSample o;
  o.slope = vec2(0.0);
  o.rough = 0.0;
  o.detail = 0.0;
  float sum = max(w.x + w.y + w.z, 1e-3);
  bool real = uDiorama.w > 0.5;
  if (w.x > 0.002) {
    DioSample g = dioSoft(uv);
    if (real) {
      g = dioFetch(uDioGrass, uv);
    }
    o.slope += g.slope * w.x * 0.5;
    o.rough += g.rough * w.x;
    o.detail += g.detail * w.x * 0.25;
  }
  if (w.y > 0.002) {
    DioSample d = dioSoft(uv);
    if (real) {
      d = dioFetch(uDioSand, uv * 1.4);
    }
    // Silky: the photographed ripple is held to a faint 0.18 of its relief, over the broad sweeping swell.
    o.slope += (d.slope * 0.18 + dioSwell(uv) * 0.32) * w.y;
    o.rough += d.rough * w.y;
    o.detail += d.detail * w.y * 0.4;
  }
  if (w.z > 0.002) {
    DioSample n = dioSoft(uv);
    if (real) {
      n = dioFetch(uDioSnow, uv * 1.2);
    }
    o.slope += n.slope * w.z * 0.7;
    o.rough += n.rough * w.z;
    o.detail += n.detail * w.z * 0.5;
  }
  o.slope /= sum;
  o.rough /= sum;
  o.detail /= sum;
  return o;
}

// Slate: ridged strata, read on all three faces and blended by which way the surface looks. The ranges stay procedural.
float dioRidge(vec2 p) {
  float a = 1.0 - abs(vnoise(p) * 2.0 - 1.0);
  float b = 1.0 - abs(vnoise(p * 2.7 + 5.1) * 2.0 - 1.0);
  return a * 0.62 + b * 0.38;
}
float dioRock(vec3 q, vec3 w) {
  q *= 0.45;
  return dioRidge(q.yz * 1.4) * w.x + dioRidge(q.xz * 1.4) * w.y + dioRidge(q.xy * 1.4) * w.z;
}
`;
