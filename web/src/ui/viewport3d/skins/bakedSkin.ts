// The baked skin: the land and the sea as the painted sheet the board is baked to, with the grain,
// rivers and roads of the land's own material. It is the fallback: whenever the pixel chart is off
// or not ready, this is what the board draws. It answers the same questions as pixelSkin.ts.

/** The land's colour from the baked sheet. */
export const BAKED_LAND_SKIN = /* glsl */ `
struct LandSkinOut { vec3 c; vec2 sceneShift; float snowy; float level; };
LandSkinOut skinLand() {
  LandSkinOut result;
  result.c = texture2D(uBake, vUv, uBias).rgb;
  result.sceneShift = vec2(0.0);
  result.snowy = 0.0;
  result.level = 0.0;
  return result;
}
`;

/** The sea's answers from the baked sheet. */
export const BAKED_SEA_SKIN = /* glsl */ `
// The baked sea mirrors the sky, and its swell is tinted.
const float SKIN_SKY = 1.0;
const float SKIN_SWELL = 1.0;
struct SeaTexel { vec2 at; float e; float bay; vec2 cell; };
SeaTexel seaTexel(vec2 p) {
  SeaTexel t;
  t.at = p;
  t.e = 0.0;
  t.bay = 0.0;
  t.cell = vec2(0.0);
  return t;
}
float seaSwellGlint(SeaTexel t, vec2 foot) {
  return 0.0;
}
vec3 seaBase(SeaTexel t, vec2 m, vec2 foot) {
  return texture2D(uBake, sheetUv(m), uBias).rgb;
}
vec2 seaWaveAt(vec2 scenePoint, vec2 m) {
  return m;
}
float seaRings() {
  return 1.0;
}
float seaGlints(SeaTexel t, vec2 m, float glare) {
  vec2 cell = vec2(floor(m.x * 1.9 + floor(m.y * 4.2) * 0.37), floor(m.y * 4.2));
  float flick = hash21(cell + floor(uTime * 2.5 + hash21(cell.yx) * 3.0) * 17.0);
  return step(1.0 - 0.1 * glare * glare, flick) * step(fract(m.y * 4.2), 0.5);
}
vec2 seaPopCell(SeaTexel t, vec2 m) {
  return floor(m * 3.0);
}
`;
