// The pixel skin: the land and the sea drawn as square texels fixed to the board.
//
// A skin is a set of shader chunks that answer the same questions (see bakedSkin.ts for the other
// one), plus the uniforms the chunks read. The land and water materials in boardMaterials.ts are
// the same for every skin: they ask for `skinLand()` and for `seaTexel`, `seaBase`, `seaWaveAt`,
// `seaRings`, `seaGlints`, and `seaPopCell`, and the define `PIXIE` picks which skin answers.
import * as THREE from "three";
import { CLEARING_REACH } from "../unitShadows";
import { PIXIE_COAST_REACH, PIXIE_HEIGHT_TOP, PIXIE_INK, PIXIE_LAND, PIXIE_SEA, PIXIE_SHELF_WIDTH, unitRgb } from "../pixieSheet";

const LINE_REACH = "2.5";

// --- The pixel chart ----------------------------------------------------------------------------
//
// A material built with `PIXIE` draws the land or the sea as square texels fixed to the board
// (see pixieSheet.ts, and pixieLook in mapVisualConfig.ts). With the define absent none of this
// is in the shader. The numbers are uniforms, so a slider costs a frame; the palette is constant.

export interface PixieUniforms {
  /** Texels to a world unit on the coarse grid and on the fine one, the share of coarse texels split into four, and the dither. */
  uPixGrid: { value: THREE.Vector4 };
  /** Hillshade contrast, tones each side of level, the palette's saturation, and the coastal rim. */
  uPixShade: { value: THREE.Vector4 };
  /** Depth bands, the shelf's width and the coast field's reach in world units, and 1 while each territory wears its climate. */
  uPixSea: { value: THREE.Vector4 };
  /** Rivers, roads, the faction wash, and the border ink: each a strength from 0 to 1. */
  uPixLines: { value: THREE.Vector4 };
  /** The faction tint's rules: edge boost, inner border, frontier border, and the combat override (1 pushes tints and borders to full). */
  uPixTint: { value: THREE.Vector4 };
  /** The tint's tone and the border's: brightness, saturation, border brightness, border opacity. */
  uPixTone: { value: THREE.Vector4 };
  /** The border line: its width in screen px, the strength of its pale keyline, the value shift between territories, and the zoom (px per map unit). */
  uPixLine: { value: THREE.Vector4 };
  /** Each faction's land colour (rgb) and how much stronger its tint is (w), for the mid zoom. */
  uPixFactions: { value: THREE.Vector4[] };
  /** Relief and ground cover (see buildPixieSheet). */
  uPixSheet: { value: THREE.Texture | null };
  /** The share of each climate zone at a point (see climateZoneCanvas). */
  uPixZone: { value: THREE.Texture | null };
  /** Each territory's id (see regionIdCanvas). */
  uPixIds: { value: THREE.Texture | null };
  /** Each territory's faction colour, flat. */
  uPixFaction: { value: THREE.Texture | null };
  /** The signed distance to the coast (see buildCoastField). */
  uPixCoast: { value: THREE.Texture | null };
  /** How far the edge of the shallows breathes, and the strength of the surf rings. */
  uPixFoam: { value: THREE.Vector4 };
  /** How soft the land is, the brush stroke strength, and two spare. */
  uPixSoft: { value: THREE.Vector4 };
  /** The light and shade the soft land keeps, and three spare. */
  uPixSoft2: { value: THREE.Vector4 };
  /** Each unit's map x, map y, and base radius (see writeUnitClearings), and how many are set. */
  uPixUnits: { value: Float32Array };
  uPixUnitN: { value: number };
  /** Each ship afloat on screen: map x, map y, and the radius of its mark. For the next pass (hull bounce and sway). */
  uPixShips: { value: Float32Array };
  uPixShipN: { value: number };
}

/** Slots in the sea shader's ship list. */
export const PIXIE_SHIP_SLOTS = 32;

/** Slots in the terrain shader's unit list. The same number as MAX_UNIT_CLEARINGS in unitShadows.ts. */
export const PIXIE_UNIT_SLOTS = 96;
/** Where the dither and the slope shade stand under a unit: a share of what they are elsewhere. */
const PIXIE_CLEAR_LEVEL = 0.18;

export function pixieUniforms(): PixieUniforms {
  return {
    uPixGrid: { value: new THREE.Vector4(1, 2, 0, 0.7) },
    uPixShade: { value: new THREE.Vector4(1.4, 3, 1, 0.9) },
    uPixSea: { value: new THREE.Vector4(4, PIXIE_SHELF_WIDTH, PIXIE_COAST_REACH, 1) },
    uPixLines: { value: new THREE.Vector4(1, 0, 0.2, 1) },
    uPixTint: { value: new THREE.Vector4(0.6, 0.35, 0.7, 0) },
    uPixTone: { value: new THREE.Vector4(1, 1, 0.5, 1) },
    uPixLine: { value: new THREE.Vector4(2, 0.5, 0.05, 1) },
    uPixFactions: { value: Array.from({ length: 10 }, () => new THREE.Vector4(-1, -1, -1, 1)) },
    uPixSheet: { value: null },
    uPixZone: { value: null },
    uPixIds: { value: null },
    uPixFaction: { value: null },
    uPixCoast: { value: null },
    uPixFoam: { value: new THREE.Vector4(0.5, 1.2, 0, 0) },
    uPixSoft: { value: new THREE.Vector4(0, 0, 1, 1) },
    uPixSoft2: { value: new THREE.Vector4(1, 0, 0, 0) },
    uPixUnits: { value: new Float32Array(PIXIE_UNIT_SLOTS * 3) },
    uPixUnitN: { value: 0 },
    uPixShips: { value: new Float32Array(PIXIE_SHIP_SLOTS * 3) },
    uPixShipN: { value: 0 },
  };
}

export function glslColor(hex: string): string {
  return `vec3(${unitRgb(hex)
    .map((channel) => channel.toFixed(4))
    .join(", ")})`;
}

/** The texel grid, the ordered dither, and the chart's colours. It needs `hash21` from NOISE before it. */
export const PIXEL_COMMON = /* glsl */ `
uniform vec4 uPixGrid;
uniform vec3 uPixUnits[${PIXIE_UNIT_SLOTS}];
uniform float uPixUnitN;
// 1 at a unit's base and out to its edge, easing to 0 at ${CLEARING_REACH} times the base's radius. Where it is 1 the
// dither and the slope shade stand at a fraction of their strength, so a figure never sits on noise.
float pixClearing(vec2 p) {
  float near = 0.0;
  for (int i = 0; i < ${PIXIE_UNIT_SLOTS}; i++) {
    if (float(i) >= uPixUnitN) {
      break;
    }
    vec3 u = uPixUnits[i];
    near = max(near, 1.0 - smoothstep(u.z * 0.8, u.z * ${CLEARING_REACH.toFixed(2)}, distance(p, u.xy)));
  }
  return near;
}
float pixCalm(vec2 p) {
  return mix(1.0, ${PIXIE_CLEAR_LEVEL.toFixed(2)}, pixClearing(p));
}
const vec3 PIX_LAND[20] = vec3[20](${PIXIE_LAND.flat().map(glslColor).join(", ")});
const vec3 PIX_SEA[4] = vec3[4](${PIXIE_SEA.map(glslColor).join(", ")});
const vec3 PIX_UMBER = ${glslColor(PIXIE_INK.umber)};
const vec3 PIX_FLOOR = ${glslColor(PIXIE_INK.floor)};
const vec3 PIX_CHALK = ${glslColor(PIXIE_INK.chalk)};
const vec3 PIX_SNOW = ${glslColor(PIXIE_INK.snow)};
const vec3 PIX_SNOW_SHADE = ${glslColor(PIXIE_INK.snowShade)};
const vec3 PIX_RIM = ${glslColor(PIXIE_INK.rim)};
const vec3 PIX_RIM_RUST = ${glslColor(PIXIE_INK.rimRust)};
const vec3 PIX_RIVER = ${glslColor(PIXIE_INK.river)};
const vec3 PIX_ROAD = ${glslColor(PIXIE_INK.road)};
const vec3 PIX_INK = ${glslColor(PIXIE_INK.border)};
const vec3 PIX_SEAM = ${glslColor(PIXIE_INK.seam)};
// The 4 by 4 Bayer threshold of a texel, 0 to 15 sixteenths. The same sum as bayer4 in pixieSheet.ts.
float bayer2(vec2 a) {
  a = mod(floor(a), 2.0);
  return fract(a.x * 0.5 + a.y * 0.75);
}
float bayer4(vec2 a) {
  return bayer2(0.5 * a) * 0.25 + bayer2(a);
}
// The texel a point of the board lies in: its index in xy, and the texels to a world unit in z.
// The grid is fixed to the board. Between two densities the coarse texels split into four, a few
// at a time, and every line of the fine grid lies on a line of the coarse one.
vec3 pixTexel(vec2 p) {
  float density = mix(uPixGrid.x, uPixGrid.y, step(hash21(floor(p * uPixGrid.x) + 0.5), uPixGrid.z));
  return vec3(floor(p * density), density);
}
`;


/** The land's pixel-chart declarations: the sheets it reads, and the helpers that colour a texel. */
export const PIXEL_LAND_DECLS = /* glsl */ `
      uniform sampler2D uPixSheet;
      uniform sampler2D uPixZone;
      uniform sampler2D uPixIds;
      uniform sampler2D uPixFaction;
      uniform sampler2D uMask;
      uniform sampler2D uGround;
      uniform vec4 uPixShade;
      uniform vec4 uPixSea;
      uniform vec4 uPixLines;
      uniform vec4 uPixTint;
      uniform vec4 uPixTone;
      uniform vec4 uPixLine;
      uniform vec4 uPixFactions[10];
      uniform vec4 uPixSoft;
      uniform vec4 uPixSoft2;
      // Height of the ground at a map point, in world units: the ranges of the relief sheet, cut
      // into ridges, on lowlands that roll a little.
      float pixHeight(vec2 m) {
        float range = textureLod(uPixSheet, sheetUv(m), 0.0).r * ${PIXIE_HEIGHT_TOP.toFixed(1)};
        float ridged = 1.0 - abs(vnoise(m * 0.8 + 5.3) * 2.0 - 1.0);
        return range * (0.6 + 0.75 * ridged) + (fbm(m * 0.16) - 0.5) * 0.9 + (vnoise(m * 0.55 + 17.0) - 0.5) * 0.3;
      }
      // 1 on land, 0 on water.
      float pixLand(vec2 m) {
        return textureLod(uMask, sheetUv(m), 0.0).r;
      }
      // What lies across a border at a point p: x is 1 where the land there belongs to another territory than ids, and y is 1 where
      // that is another faction's land too. Sea does not count: a coast is no border.
      vec2 pixAcross(vec2 p, vec3 ids, vec3 faction) {
        vec3 nid = textureLod(uPixIds, sheetUv(p), 0.0).rgb;
        float other = step(0.002, max(abs(nid.r - ids.r), abs(nid.g - ids.g)));
        float land = step(0.5, pixLand(p)) * step(0.001, nid.r + nid.g) * step(nid.b, 0.5);
        vec3 nf = textureLod(uPixFaction, sheetUv(p), 0.0).rgb;
        float frontier = step(0.04, distance(nf, faction));
        return vec2(other * land, other * land * frontier);
      }
      // One zone colour at a tone and a height. wl and wh are how wide each step from one tone
      // to the next is eased: near 0 the steps are hard, as the strategic chart has them.
      vec3 pixTone(int zone, float xt, float high, float wl, float wh) {
        vec3 c = PIX_LAND[zone * 5];
        c = mix(c, PIX_LAND[zone * 5 + 1], smoothstep(1.0 - wl, 1.0 + wl, xt));
        c = mix(c, PIX_LAND[zone * 5 + 2], smoothstep(2.0 - wl, 2.0 + wl, xt));
        c = mix(c, PIX_LAND[zone * 5 + 3], smoothstep(1.05 - wh, 1.05 + wh, high));
        c = mix(c, PIX_LAND[zone * 5 + 4], smoothstep(2.5 - wh, 2.5 + wh, high));
        return c;
      }
`;

/** The land's colour from the pixel chart. `skinLand` is what the land material asks for. */
export const PIXEL_LAND_SKIN = /* glsl */ `
struct LandSkinOut { vec3 c; vec2 sceneShift; float snowy; float level; vec3 biome; float frost; };
LandSkinOut skinLand() {
  // Where the cloud's shadow is read: the chart reads it at the middle of a texel.
  vec2 sceneAt = vec2(0.0);
        // The texel this piece of land lies in, and the map point at its middle. Everything below
        // is read there, so a texel is one flat colour and it never slides under the camera.
        vec2 mapAt = vec2(vUv.x * uBounds.z + uBounds.x, (1.0 - vUv.y) * uBounds.w + uBounds.y);
        vec3 grid = pixTexel(mapAt);
        vec2 cell = grid.xy;
        float e = 1.0 / grid.z;
        vec2 m = (cell + 0.5) * e;
        sceneAt += vec2(m.x - mapAt.x, mapAt.y - m.y);
        vec2 uv = sheetUv(m);
        float bay = bayer4(cell) + 0.03125;
        // Under and around a unit the dither and the slope shade ease down, so the figure reads on quiet ground.
        // The soft land reads the ground where the pixel is, not at the middle of its texel, so its washes have no steps.
        // A range keeps the pixel chart, its height map and its light: only the flat land goes soft, and a range's foot eases into it.
        #ifdef RELIEF
        // The hills, low and broad, are flat land that rolls: only the foot of a range (above the hills) holds the pixel look.
        float softK = 1.0 - smoothstep(0.26, 0.5, vRise);
        #else
        float softK = 1.0;
        #endif
        float soft = uPixSoft.x * softK;
        // The ground is read at the middle of its texel until the land is half soft, so there is no blurred in-between.
        vec2 ms = mix(m, mapAt, smoothstep(0.5, 1.0, soft) * 0.9);
        float calm = mix(pixCalm(m), 0.5 + 0.5 * pixCalm(m), soft);
        float spread = (bay - 0.5) * uPixGrid.w * calm * mix(1.0, uPixSoft.z, soft);

        // The ground cover is read a little off its place, so the boxes of the biome table do
        // not show as straight lines. The height is read where it is.
        vec2 warp = (vec2(vnoise(ms * 0.06 + 3.7), vnoise(ms * 0.06 + 41.3)) - 0.5) * 12.0
          + (vec2(vnoise(ms * 0.019 + 71.1), vnoise(ms * 0.019 + 13.9)) - 0.5) * 26.0;
        vec4 field = textureLod(uPixSheet, sheetUv(ms + warp), 0.0);
        vec4 here = textureLod(uPixSheet, sheetUv(ms), 0.0);

        // The climate zone. Where two zones meet, the dither picks between them by their shares.
        int zone = 0;
        vec4 zoneShare = vec4(1.0, 0.0, 0.0, 0.0);
        if (uPixSea.w > 0.5) {
          vec3 zones = textureLod(uPixZone, sheetUv(ms + warp * 0.35), 0.0).rgb;
          float pick = 0.5 + spread;
          zone = pick < zones.r ? 0 : (pick < zones.r + zones.g ? 1 : (pick < zones.r + zones.g + zones.b ? 2 : 3));
          zoneShare = vec4(zone == 0 ? 1.0 : 0.0, zone == 1 ? 1.0 : 0.0, zone == 2 ? 1.0 : 0.0, zone == 3 ? 1.0 : 0.0);
          if (soft > 0.001) {
            // Soft, the zones run into each other by their shares and no dither picks between them.
            float zs = soft * 0.35;
            float b1 = zones.r;
            float b2 = b1 + zones.g;
            float b3 = b2 + zones.b;
            float s1 = smoothstep(b1 - zs, b1 + zs, pick);
            float s2 = smoothstep(b2 - zs, b2 + zs, pick);
            float s3 = smoothstep(b3 - zs, b3 + zs, pick);
            zoneShare = vec4(1.0 - s1, s1 * (1.0 - s2), s2 * (1.0 - s3), s3);
          }
        }

        // The tone inside the zone's ramp: dry ground, meadow, or forest by how green the place
        // is, then upland and crest by its height. The dither carries one tone into the next.
        float h0 = pixHeight(ms);
        float lush = field.g + (fbm(ms * 0.21 + 11.0) - 0.5) * 0.5;
        // Brush strokes: long, low noise that wanders where one band gives way to the next.
        float stroke = fbm(vec2(ms.x * 0.05, ms.y * 0.13) + 7.0) - 0.5;
        float xt = clamp(lush * 3.0 + spread * 0.9 + stroke * uPixSoft.y * softK * 1.6, 0.0, 2.999);
        float high = h0 + spread * 0.6;
        float wl = max(soft * 0.55, 1e-4);
        float wh = max(soft * 0.7, 1e-4);
        vec3 c = vec3(0.0);
        for (int zi = 0; zi < 4; zi++) {
          float share = zoneShare[zi];
          if (share > 0.001) {
            c += share * pixTone(zi, xt, high, wl, wh);
          }
        }
        c *= 1.0 + (fbm(ms * 0.5 + 3.0) - 0.5) * 0.07 * uPixSoft.y * softK;
        c = mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, uPixShade.z * mix(1.0, uPixSoft.w, soft));

        // Whose land it is: a wash of the faction's colour over the ground. Land nobody holds is left as it lies.
        vec3 ids = textureLod(uPixIds, uv, 0.0).rgb;
        vec3 faction = textureLod(uPixFaction, uv, 0.0).rgb;
        float owned = step(0.001, ids.r + ids.g) * step(ids.b, 0.5);
        // The tint is stronger along the outer edge of a faction's contiguous land: a ring of taps round the texel counts how much of
        // its surroundings is the sea, nobody's land, or another faction's, and that share adds to the wash. Deep inside it adds nothing.
        float edge = 0.0;
        if (owned > 0.5 && uPixTint.x > 0.001 && uPixLines.z > 0.001) {
          float reach = e * 6.0;
          for (int ei = 0; ei < 8; ei++) {
            float ang = float(ei) * 0.785398;
            vec2 tap = m + vec2(cos(ang), sin(ang)) * reach;
            vec3 nid = textureLod(uPixIds, sheetUv(tap), 0.0).rgb;
            float nown = step(0.001, nid.r + nid.g) * step(nid.b, 0.5);
            vec3 nfac = textureLod(uPixFaction, sheetUv(tap), 0.0).rgb;
            edge += (1.0 - nown * (1.0 - step(0.04, distance(nfac, faction)))) * 0.125;
          }
        }
        // A combat selection pushes the whole tint to full, so ownership and the frontlines read plainly.
        // Some factions carry a stronger tint than the rest at this zoom (a multiplier by the faction's own colour), and the tint's
        // brightness and saturation can be set.
        float boost = 1.0;
        for (int fi = 0; fi < 10; fi++) {
          boost = mix(boost, uPixFactions[fi].w, step(distance(faction, uPixFactions[fi].rgb), 0.03));
        }
        float tintLuma = dot(faction, vec3(0.299, 0.587, 0.114));
        vec3 tintCol = clamp(mix(vec3(tintLuma), faction, uPixTone.y) * uPixTone.x, 0.0, 1.0);
        float wash = mix(min(uPixLines.z * boost * (1.0 + uPixTint.x * edge), 1.0), 1.0, uPixTint.w);
        c = mix(c, tintCol, wash * owned);
        // Each territory sits a little lighter or darker than its neighbours, so two of one faction part even without a line.
        float shiftHash = fract(sin(dot(ids.rg * 255.0, vec2(12.9898, 78.233))) * 43758.5453);
        c *= 1.0 + (shiftHash - 0.5) * 2.0 * uPixLine.z * owned;

        // Snow: on the summits that carry it, and scattered over the cold north.
        // The cold ground is patched by a broad drift, so the snow line is no line of latitude. An ice sheet is whole.
        float cold = field.b * (0.5 + 1.1 * fbm(ms * 0.045 + 23.0));
        float frost = max(max(here.a, cold) + spread * 0.18 + (vnoise(ms * 0.33 + 9.0) - 0.5) * 0.12, smoothstep(0.8, 0.95, field.b));
        float snowy = step(0.56, frost);
        #ifdef RELIEF
        // The snow line slider sets where a range turns white, still cut into texels.
        snowy = max(snowy, step(0.5, smoothstep(uMountain.z - uMountain.w, uMountain.z + uMountain.w, vRise) + spread * 0.3) * step(0.05, vRise));
        #endif
        c = mix(c, PIX_SNOW, snowy);

        // Hillshade. The slope is taken across the texel's four neighbours, and the light on it
        // is cut into flat tones: umber on the side turned from the sun, chalk on the side turned to it.
        vec2 grad = vec2(pixHeight(ms + vec2(e, 0.0)) - pixHeight(ms - vec2(e, 0.0)), pixHeight(ms + vec2(0.0, e)) - pixHeight(ms - vec2(0.0, e))) / (2.0 * e);
        // Map y runs down the sheet and the sun's runs up it.
        vec2 sunward = normalize(vec2(uSunDir.x, -uSunDir.y) + vec2(1e-4));
        float lean = clamp(-dot(grad, sunward) * uPixShade.x * mix(1.0, uPixSoft2.x, soft), -1.0, 1.0);
        float level = clamp(floor(lean * uPixShade.y + 0.5 + spread * 0.5) / uPixShade.y, -1.0, 1.0);
        // Soft, the light and shade run on in a slope and not in flat tones.
        level = mix(level, lean, soft * 0.85);
        // The band between the darkest shade and the brightest light is held narrow, so a figure's own darks and lights stand clear of it.
        level *= calm;
        if (level < 0.0) {
          c = mix(c, mix(PIX_UMBER, PIX_SNOW_SHADE, snowy), -level * 0.52);
        } else {
          c = mix(c, mix(PIX_CHALK, vec3(1.0), snowy), level * 0.28);
        }

        // The coast: a texel that is on the water's edge, or has a neighbour that is.
        float landNear = min(min(pixLand(m + vec2(e, 0.0)), pixLand(m - vec2(e, 0.0))), min(pixLand(m + vec2(0.0, e)), pixLand(m - vec2(0.0, e))));
        float rim = 1.0 - step(0.5, min(pixLand(m), landNear));
        if (rim < 0.5) {
          // A border is where land of another territory lies within half the line's width of the texel. The width is in screen
          // px, so the line is as wide at every zoom (never thinner than one texel). A dark core carries a pale keyline either side
          // of it, so the line reads on dark and light ground alike. It is heavier between two factions than inside one.
          // Up close the line is a whole texel wide, so it stays a hard pixel-art step; the probes then reach the next texel.
          float hw = max(uPixLine.x * 0.5 / max(uPixLine.w, 1e-3), e);
          // Where a texel is under about a pixel and a half on screen, the probes start at the exact pixel, so the line is a clean
          // 2px at any zoom and not a ragged run of texels. Where texels are large it stays a stair of whole texels.
          vec2 lp = mix(m, mapAt, step(e * uPixLine.w, 1.5));
          vec2 c0 = pixAcross(lp + vec2(hw, 0.0), ids, faction);
          vec2 c1 = pixAcross(lp - vec2(hw, 0.0), ids, faction);
          vec2 c2 = pixAcross(lp + vec2(0.0, hw), ids, faction);
          vec2 c3 = pixAcross(lp - vec2(0.0, hw), ids, faction);
          float core = max(max(c0.x, c1.x), max(c2.x, c3.x));
          float coreFrontier = max(max(c0.y, c1.y), max(c2.y, c3.y));
          float kw = hw * 2.6;
          vec2 k0 = pixAcross(m + vec2(kw, 0.0), ids, faction);
          vec2 k1 = pixAcross(m - vec2(kw, 0.0), ids, faction);
          vec2 k2 = pixAcross(m + vec2(0.0, kw), ids, faction);
          vec2 k3 = pixAcross(m - vec2(0.0, kw), ids, faction);
          float ring = max(max(k0.x, k1.x), max(k2.x, k3.x)) * (1.0 - core);
          float ringFrontier = max(max(k0.y, k1.y), max(k2.y, k3.y));
          float lineBase = uPixLines.w * uPixTone.w;
          float coreAlpha = mix(clamp(mix(uPixTint.y, uPixTint.z, coreFrontier) * lineBase, 0.0, 1.0), 1.0, uPixTint.w);
          float keyAlpha = mix(clamp(mix(uPixTint.y, uPixTint.z, ringFrontier) * lineBase, 0.0, 1.0), 1.0, uPixTint.w) * uPixLine.y;
          // The keyline: the faction's colour lifted toward chalk. The core: the faction's colour taken darker.
          c = mix(c, mix(faction, vec3(1.0), 0.6), ring * keyAlpha);
          // On snow the border is laid over the faction's own ground colour, so it is as dark as the borders about it and not washed out.
          vec3 under = mix(c, tintCol, snowy * core);
          c = mix(under, clamp(faction * uPixTone.z, 0.0, 1.0), core * coreAlpha);
          // A thin line in the brightest of the faction's colour runs down the middle of a land border, about a pixel wide drawn at half
          // strength, so it reads as a hairline whatever the pixel density.
          float hr = 0.5 / max(uPixLine.w, 1e-3);
          float hairline = max(max(pixAcross(mapAt + vec2(hr, 0.0), ids, faction).x, pixAcross(mapAt - vec2(hr, 0.0), ids, faction).x),
            max(pixAcross(mapAt + vec2(0.0, hr), ids, faction).x, pixAcross(mapAt - vec2(0.0, hr), ids, faction).x));
          vec3 bright = faction / max(max(faction.r, max(faction.g, faction.b)), 0.05);
          c = mix(c, min(bright, vec3(0.95)), hairline * core * 0.6 * uPixLines.w);
          // A road and a river are each one texel wide: the texels whose middle is within half a texel of the line.
          vec4 lines = textureLod(uGround, uv, 0.0);
          float within = min(0.5 * e, 2.3);
          float roadAway = length((lines.ba * 255.0 - 128.0) * (${LINE_REACH} / 127.0));
          float riverAway = length((lines.rg * 255.0 - 128.0) * (${LINE_REACH} / 127.0));
          c = mix(c, PIX_ROAD, uPixLines.y * 0.7 * step(roadAway, within));
          c = mix(c, PIX_RIVER, uPixLines.x * step(riverAway, within));
        }
        c = mix(c, mix(PIX_RIM, PIX_RIM_RUST, step(0.8, bay)), rim * uPixShade.w);
  LandSkinOut result;
  result.c = c;
  result.sceneShift = sceneAt;
  result.snowy = snowy;
  result.level = level;
  // What the ground is, for the close-up surface: grass (temperate, boreal and tropical), sand (arid), and snow.
  float dry = zoneShare.z;
  float snowShare = snowy;
  result.biome = vec3((1.0 - dry) * (1.0 - snowShare), dry * (1.0 - snowShare), snowShare);
  // The frost before it is cut into texels: the close-up feathers the snow's edge by it.
  result.frost = frost;
  return result;
}
`;

/** The sea's pixel-chart answers. */
export const PIXEL_SEA_SKIN = /* glsl */ `
uniform sampler2D uPixCoast;
uniform sampler2D uPixIds;
uniform vec4 uPixSea;
uniform vec4 uPixLine;
uniform vec4 uPixFoam;
uniform vec3 uPixShips[${PIXIE_SHIP_SLOTS}];
uniform float uPixShipN;
// 1 where the skin mirrors the sky on the sea, and where it tints the swell. The chart keeps its depth bands flat.
const float SKIN_SKY = 0.0;
const float SKIN_SWELL = 0.0;
struct SeaTexel { vec2 at; float e; float bay; vec2 cell; };
SeaTexel seaTexel(vec2 p) {
  vec3 grid = pixTexel(p);
  SeaTexel t;
  t.e = 1.0 / grid.z;
  t.at = (grid.xy + 0.5) * t.e;
  t.bay = bayer4(grid.xy) + 0.03125;
  t.cell = grid.xy;
  return t;
}
// The distance from a point of the sea to the coast, in world units: the field the shallows are cut from.
// The next pass reads it for the swell that breaks on a cliff, and for the way a hull bounces near one.
float seaCoastDist(vec2 foot) {
  return (textureLod(uPixCoast, sheetUv(foot), 0.0).r * 255.0 - 128.0) / 127.0 * uPixSea.z;
}
// 1 on a ship's mark and out to its edge, easing to 0 a radius beyond it. Ships are the entries of uPixShips.
// Nothing reads it yet: it is the hook for displacement round a hull.
float seaShipNear(vec2 mapPoint) {
  float near = 0.0;
  for (int i = 0; i < ${PIXIE_SHIP_SLOTS}; i++) {
    if (float(i) >= uPixShipN) {
      break;
    }
    vec3 s = uPixShips[i];
    near = max(near, 1.0 - smoothstep(s.z, s.z * 2.0, distance(mapPoint, s.xy)));
  }
  return near;
}
// The tropics: the map y of the northern and the southern tropic, and how strong the turquoise lagoon is (see seaBase).
uniform vec3 uTropic;
// The sea colour at a map point m, measured from the cliff foot as foot.
vec3 seaBase(SeaTexel t, vec2 m, vec2 foot) {
        // Depth by the distance to the coast, in flat bands: pale on the shelf, steel teal in the
        // open ocean. The contours wander a little out at sea, and the dither carries one band into the next.
        float away = seaCoastDist(foot);
        away += (fbm(foot * 0.07 + 2.0) - 0.5) * 7.0 * smoothstep(1.0, 8.0, away);
        // The edge of the shallows breathes: it creeps in and out across the dither, a slow tide that is out of step along the coast.
        away += sin(uTime * 0.5 + vnoise(foot * 0.16) * 6.2832) * uPixFoam.x * 0.09 * uPixSea.y * smoothstep(-2.0, 3.0, away);
        float deep = pow(clamp(away / uPixSea.y, 0.0, 1.0), 0.7);
        float band = clamp(floor(deep * uPixSea.x + (t.bay - 0.5) * uPixGrid.w * 0.9), 0.0, uPixSea.x - 1.0) / max(uPixSea.x - 1.0, 1.0);
        vec3 c = band < 0.3333 ? mix(PIX_SEA[0], PIX_SEA[1], band * 3.0) : (band < 0.6667 ? mix(PIX_SEA[1], PIX_SEA[2], band * 3.0 - 1.0) : mix(PIX_SEA[2], PIX_SEA[3], band * 3.0 - 2.0));
        // A seam is where the texel to the east or the south lies in another sea zone.
        vec3 ids = textureLod(uPixIds, sheetUv(m), 0.0).rgb;
        // The probes reach out by half the line's screen width (never under a texel), so a seam is as wide at every zoom.
        float sw = max(uPixLine.x * 0.5 / max(uPixLine.w, 1e-3), t.e);
        vec3 east = textureLod(uPixIds, sheetUv(m + vec2(sw, 0.0)), 0.0).rgb;
        vec3 west = textureLod(uPixIds, sheetUv(m - vec2(sw, 0.0)), 0.0).rgb;
        vec3 south = textureLod(uPixIds, sheetUv(m + vec2(0.0, sw)), 0.0).rgb;
        vec3 north = textureLod(uPixIds, sheetUv(m - vec2(0.0, sw)), 0.0).rgb;
        float seam = step(0.5, ids.b) * max(max(step(0.5, east.b) * step(0.002, distance(east.rg, ids.rg)), step(0.5, west.b) * step(0.002, distance(west.rg, ids.rg))),
          max(step(0.5, south.b) * step(0.002, distance(south.rg, ids.rg)), step(0.5, north.b) * step(0.002, distance(north.rg, ids.rg))));
        // The sea zones' seams hold one strength at every zoom, dark enough to read on every band.
        c = mix(c, PIX_SEAM * 0.6, seam * 0.9);
        // In the tropics the shallows by the coast are a translucent turquoise-teal lagoon before the sea drops to deep navy.
        float lagoon = (1.0 - smoothstep(0.0, uPixSea.y * 0.5, away)) * smoothstep(uTropic.x - 5.0, uTropic.x + 5.0, m.y) * (1.0 - smoothstep(uTropic.y - 5.0, uTropic.y + 5.0, m.y));
        c = mix(c, vec3(0.17, 0.66, 0.63) * (0.9 + 0.1 * fbm(foot * 0.3)), lagoon * uTropic.z);
  return c;
}
// Where the surf is read: the pixel itself, not the middle of its texel, so its rings stay smooth.
vec2 seaWaveAt(vec2 scenePoint, vec2 m) {
  return vec2(scenePoint.x, uShift - scenePoint.y);
}
float seaRings() {
  return uPixFoam.y;
}
// The sun's glints: one texel each, on a lattice turned off the board's axes.
float seaGlints(SeaTexel t, vec2 m, float glare) {
        // Glints sit on a lattice turned off the board's axes, each cell holding one at a jittered place,
        // so they scatter and show no square grid. A glint is one texel, so it holds its size at every zoom.
        float dashes = 0.0;
        if (glare > 0.01) {
          float cellSize = t.e * 2.6 * uSheenShape.y;
          vec2 q = mat2(0.891, 0.454, -0.454, 0.891) * t.at / cellSize;
          vec2 base = floor(q);
          float chance = min(0.9, 0.5 * glare * uSheenFreq);
          for (int j = -1; j <= 1; j++) {
            for (int i = -1; i <= 1; i++) {
              vec2 id = base + vec2(float(i), float(j));
              vec2 pt = id + 0.5 + (vec2(hash21(id + 3.1), hash21(id + 9.7)) - 0.5) * (0.5 + 0.5 * uSheenShape.z);
              float on = step(hash21(id + floor(uTime * 2.2 * max(uSheenFreq, 0.3) + hash21(id.yx) * 3.0) * 17.0), chance);
              vec2 gap = abs((q - pt) * cellSize);
              dashes = max(dashes, on * step(max(gap.x, gap.y), t.e * 0.55));
            }
          }
        }
  return dashes;
}
vec2 seaPopCell(SeaTexel t, vec2 m) {
  return t.cell;
}
`;
