// Shaders for the board. No React.
//
// Colours are the strip's sRGB numbers, used as they are: textures are read raw and nothing is
// converted on the way out, so a palette colour on the board is the same colour the 2D map paints.
// Light is a multiplier on that colour (see sun.ts), and it is stepped, so a lit facet and a shaded
// one are two flat tones the way they are in the sprites.
import * as THREE from "three";
import { MILITARY } from "../theme/militaryPalette";

export type Rgb = [number, number, number];

export function rgbOf(hex: string): THREE.Vector3 {
  return new THREE.Vector3(
    Number.parseInt(hex.slice(1, 3), 16) / 255,
    Number.parseInt(hex.slice(3, 5), 16) / 255,
    Number.parseInt(hex.slice(5, 7), 16) / 255,
  );
}

function blend(a: string, b: string, t: number): THREE.Vector3 {
  return rgbOf(a).lerp(rgbOf(b), t);
}

/** Uniforms every board material reads. One object each, shared by reference. */
export interface SharedUniforms {
  uTime: { value: number };
  /** `uTime` held to twelve steps a second, for smoke that moves like stop-motion. */
  uStepTime: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Vector3 };
  uAmbient: { value: THREE.Vector3 };
  uDirect: { value: number };
  uRelief: { value: number };
  /** Ground offset of a shadow for each unit of height, in scene x and y. */
  uShadowVec: { value: THREE.Vector2 };
  uShadowAlpha: { value: number };
  uMask: { value: THREE.Texture | null };
  uBake: { value: THREE.Texture | null };
  /** The sheet: x, y, width, height in world units. */
  uBounds: { value: THREE.Vector4 };
  /** The sun's shadow map, read only by a material built with `SUN_SHADOW` (see setSunShadow). */
  uSunMap: { value: THREE.Texture | null };
  /** Scene point to shadow-map coordinates: x and y across the map, z the depth, all 0 to 1. */
  uSunMatrix: { value: THREE.Matrix4 };
  /** One texel of the map across and down, the depth bias, and the normal offset for raised ground. */
  uSunTexel: { value: THREE.Vector4 };
  /** What a full shadow multiplies the ground by. White is no shadow. */
  uSunTint: { value: THREE.Vector3 };
  /** The shadow map's colour: 1 where a standing figure cast. Read only with `BASES_ONLY`. */
  uSunCards: { value: THREE.Texture | null };
  /**
   * The sculpted ranges: height of the tallest summit now in world units, how ridged (0 dome, 1
   * massif), the snow line, and half the snow's blend. A height of 0 is flat ground.
   */
  uMountain: { value: THREE.Vector4 };
}

export function sharedUniforms(): SharedUniforms {
  return {
    uSunCards: { value: null },
    uMountain: { value: new THREE.Vector4(0, 0.6, 0.56, 0.2) },
    uSunMap: { value: null },
    uSunMatrix: { value: new THREE.Matrix4() },
    uSunTexel: { value: new THREE.Vector4(1 / 2048, 1 / 2048, 0.0005, 0.3) },
    uSunTint: { value: new THREE.Vector3(1, 1, 1) },
    uTime: { value: 0 },
    uStepTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.3, 0.4, 0.86) },
    uSunColor: { value: new THREE.Vector3(1, 1, 1) },
    uAmbient: { value: new THREE.Vector3(0.8, 0.84, 0.9) },
    uDirect: { value: 1 },
    uRelief: { value: 0 },
    uShadowVec: { value: new THREE.Vector2(0, 0) },
    uShadowAlpha: { value: 0 },
    uMask: { value: null },
    uBake: { value: null },
    uBounds: { value: new THREE.Vector4(0, 0, 800, 504) },
  };
}

const NOISE = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  return vnoise(p) * 0.6 + vnoise(p * 2.1 + 7.3) * 0.3 + vnoise(p * 4.3 + 1.7) * 0.1;
}
`;

const LIGHT = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform float uDirect;
uniform float uRelief;
// The colour multiplier for a face turned ndl toward the sun. The same sum as litFactor in sun.ts.
vec3 lit(float ndl) {
  float n = max(ndl, 0.0) * uDirect;
  float fill = 1.0 - 0.42 * uDirect;
  vec3 l = uAmbient * fill + uSunColor * n * 0.62 + vec3(0.2, 0.16, 0.1) * (1.0 - uDirect);
  return mix(vec3(1.0), l, uRelief);
}
float stepped(float ndl) {
  return floor(clamp(ndl, 0.0, 1.0) * 3.0 + 0.5) / 3.0;
}
// Slow cloud shadow over the whole table, in scene coordinates so land and water agree.
float cloudShade(vec2 at) {
  float c = fbm(at * 0.011 + vec2(uTime * 0.0035, uTime * 0.0012));
  return smoothstep(0.52, 0.7, c) * 0.13 * uRelief * uDirect;
}
`;

const SHEET = /* glsl */ `
uniform vec4 uBounds;
// Texture coordinates on the sheet for a map point. The sheet repeats sideways.
vec2 sheetUv(vec2 m) {
  return vec2((m.x - uBounds.x) / uBounds.z, 1.0 - (m.y - uBounds.y) / uBounds.w);
}
`;

function lightUniforms(shared: SharedUniforms) {
  return {
    uTime: shared.uTime,
    uSunDir: shared.uSunDir,
    uSunColor: shared.uSunColor,
    uAmbient: shared.uAmbient,
    uDirect: shared.uDirect,
    uRelief: shared.uRelief,
  };
}

// --- The sun's shadow map -----------------------------------------------------------------------
//
// A material that takes cast shadows carries these two blocks behind `SUN_SHADOW`. With the define
// absent the shader has no map, no matrix, and no taps: it is the shader it was before. The define
// is 1 for the plain kernel and 2 for the wide one the largest map uses.
//
// The map is a depth texture read through a comparing sampler, so each tap is already filtered
// across four texels by the hardware. The taps are written out one by one: no loop, and an explicit
// level, so no driver has to guess a gradient.

export const SUN_VERTEX = /* glsl */ `
#ifdef SUN_SHADOW
uniform mat4 uSunMatrix;
varying vec3 vSun;
#endif
`;

export const SUN_FRAGMENT = /* glsl */ `
#ifdef SUN_SHADOW
uniform highp sampler2DShadow uSunMap;
uniform vec4 uSunTexel;
uniform vec3 uSunTint;
varying vec3 vSun;
// 0 in the light, 1 in full shadow.
float sunShade(vec3 at) {
  float ref = min(at.z - uSunTexel.z, 1.0);
  vec2 d = uSunTexel.xy * 1.15;
  float lit = textureLod(uSunMap, vec3(at.xy, ref), 0.0);
  float ring = textureLod(uSunMap, vec3(at.xy + d, ref), 0.0);
  ring += textureLod(uSunMap, vec3(at.xy - d, ref), 0.0);
  ring += textureLod(uSunMap, vec3(at.xy + vec2(d.x, -d.y), ref), 0.0);
  ring += textureLod(uSunMap, vec3(at.xy + vec2(-d.x, d.y), ref), 0.0);
  #if SUN_SHADOW > 1
  vec2 w = uSunTexel.xy * 2.3;
  float wide = textureLod(uSunMap, vec3(at.xy + vec2(w.x, 0.0), ref), 0.0);
  wide += textureLod(uSunMap, vec3(at.xy - vec2(w.x, 0.0), ref), 0.0);
  wide += textureLod(uSunMap, vec3(at.xy + vec2(0.0, w.y), ref), 0.0);
  wide += textureLod(uSunMap, vec3(at.xy - vec2(0.0, w.y), ref), 0.0);
  return 1.0 - (lit * 0.24 + ring * 0.12 + wide * 0.07);
  #else
  return 1.0 - (lit * 0.36 + ring * 0.16);
  #endif
}
#ifdef BASES_ONLY
uniform sampler2D uSunCards;
// 1 where a standing figure is what stands between this point and the sun. Read a little wide,
// so the soft edge of the figure's shadow is covered too.
float sunCards(vec3 at) {
  vec2 d = uSunTexel.xy * 2.4;
  vec2 e = uSunTexel.xy * 1.7;
  float m = textureLod(uSunCards, at.xy, 0.0).r;
  m = max(m, textureLod(uSunCards, at.xy + vec2(d.x, 0.0), 0.0).r);
  m = max(m, textureLod(uSunCards, at.xy - vec2(d.x, 0.0), 0.0).r);
  m = max(m, textureLod(uSunCards, at.xy + vec2(0.0, d.y), 0.0).r);
  m = max(m, textureLod(uSunCards, at.xy - vec2(0.0, d.y), 0.0).r);
  m = max(m, textureLod(uSunCards, at.xy + e, 0.0).r);
  m = max(m, textureLod(uSunCards, at.xy - e, 0.0).r);
  m = max(m, textureLod(uSunCards, at.xy + vec2(e.x, -e.y), 0.0).r);
  m = max(m, textureLod(uSunCards, at.xy + vec2(-e.x, e.y), 0.0).r);
  return clamp(m * 2.0, 0.0, 1.0);
}
#endif
#endif
`;

function sunUniforms(shared: SharedUniforms) {
  return {
    uSunMap: shared.uSunMap,
    uSunMatrix: shared.uSunMatrix,
    uSunTexel: shared.uSunTexel,
    uSunTint: shared.uSunTint,
    uSunCards: shared.uSunCards,
  };
}

/**
 * Sets or clears a shader define. The program is rebuilt only when the value changes, so calling
 * this every frame is free.
 */
export function setDefine(material: THREE.ShaderMaterial, name: string, value: number | null): void {
  const defines = (material.defines ??= {});
  const now = name in defines ? (defines[name] as number) : null;
  if (now === value) {
    return;
  }
  if (value === null) {
    delete defines[name];
  } else {
    defines[name] = value;
  }
  material.needsUpdate = true;
}

// --- Land ---------------------------------------------------------------------------------------

/**
 * What is drawn on the land besides its printed colour: the grain, the rivers, and the roads (see
 * groundSheet.ts), and the look of the sculpted ranges. One object, shared by the flat land, the
 * ranges, and the cliff. Each part is read only by a shader built with its define.
 */
export interface GroundUniforms {
  /** The way to the nearest river in red and green, and to the nearest road in blue and alpha. */
  uGround: { value: THREE.Texture | null };
  /** 1 where the grain is fine: sand, snow, tundra. */
  uCover: { value: THREE.Texture | null };
  /** The grain tile: slope in red and green, height in blue. */
  uTile: { value: THREE.Texture | null };
  /** Depth of the grain, roughness, repeats per world unit, and the land's saturation. */
  uSurface: { value: THREE.Vector4 };
  /** Half width, depth shade, bank strength. */
  uRiver: { value: THREE.Vector3 };
  /** Half width, opacity, warmth. */
  uRoad: { value: THREE.Vector3 };
  /** World units across one pixel of the frame. Lines are never drawn thinner than a pixel. */
  uPixel: { value: number };
  /** Unit vector from the board toward the camera. */
  uToEye: { value: THREE.Vector3 };
  /** How far sunlit snow goes above white, and how far the rock and snow have come in. */
  uSnowLook: { value: THREE.Vector2 };
}

export function groundUniforms(): GroundUniforms {
  return {
    uGround: { value: null },
    uCover: { value: null },
    uTile: { value: null },
    uSurface: { value: new THREE.Vector4(0.5, 0.8, 1 / 21, 1) },
    uRiver: { value: new THREE.Vector3(0.3, 0.4, 0.5) },
    uRoad: { value: new THREE.Vector3(0.15, 0.7, 0.5) },
    uPixel: { value: 0.1 },
    uToEye: { value: new THREE.Vector3(0, 0, 1) },
    uSnowLook: { value: new THREE.Vector2(0, 1) },
  };
}

/** The furthest the ground sheet can tell, in world units. The same number as GROUND_REACH in groundSheet.ts. */
const LINE_REACH = "2.5";

export { pixieUniforms, PIXIE_UNIT_SLOTS, type PixieUniforms } from "./skins/pixelSkin";
import { BAKED_LAND_SKIN, BAKED_SEA_SKIN } from "./skins/bakedSkin";
import { PIXEL_COMMON, PIXEL_LAND_DECLS, PIXEL_LAND_SKIN, PIXEL_SEA_SKIN, pixieUniforms, type PixieUniforms } from "./skins/pixelSkin";

/**
 * The top of the land: the baked sheet, under the sun.
 *
 * Built plain, it is that and nothing more. Four defines add to it, and each is absent from the
 * shader when its define is: `SURFACE` lights a fine grain and thins the colour, `RIVERS` and
 * `ROADS` draw the lines of the ground sheet, and `BASES_ONLY` keeps a figure's shadow off the
 * ground. With `relief` the same material is built for the sculpted ranges: its vertices are
 * lifted by `uMountain`, and the lifted ground goes from the territory's colour through slate and
 * rock to snow. Where a range's height is 0 it draws exactly what the flat land draws, so the two
 * join with no seam.
 *
 * `PIXIE` replaces all of that colour with the pixel chart: the land is read at the middle of a
 * texel fixed to the board, coloured from the chart's palette by its climate, its cover, and its
 * height, and shaded in flat steps by the slope of the relief sheet. The grain, the painted
 * rivers and roads, and the range's own rock and snow are left out of the shader while it is on.
 */
export function landTopMaterial(
  shared: SharedUniforms,
  ground: GroundUniforms = groundUniforms(),
  relief = false,
  pixie: PixieUniforms = pixieUniforms(),
): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    defines: relief ? { RELIEF: 1 } : {},
    uniforms: {
      ...lightUniforms(shared),
      ...sunUniforms(shared),
      ...ground,
      ...pixie,
      uMask: shared.uMask,
      uBake: shared.uBake,
      uBounds: shared.uBounds,
      uMountain: shared.uMountain,
      uBias: { value: 0 },
      uSlate: { value: blend(MILITARY.spruce, MILITARY.taupe, 0.52) },
      uRock: { value: blend(MILITARY.feldgrau, MILITARY.bone, 0.3) },
      uSnow: { value: new THREE.Vector3(0.94, 0.94, 0.91) },
      uSnowShade: { value: new THREE.Vector3(0.6, 0.66, 0.74) },
      // The sea's own colours, so a river reads as the same water running inland.
      uRiverShallow: { value: blend(MILITARY.spruce, MILITARY.steel, 0.35) },
      uRiverDeep: { value: blend(MILITARY.steel, MILITARY.charcoal, 0.3) },
      uRoadCool: { value: new THREE.Vector3(0.9, 0.89, 0.84) },
      uRoadWarm: { value: new THREE.Vector3(0.95, 0.87, 0.7) },
    },
    vertexShader: /* glsl */ `
      ${SHEET}
      ${SUN_VERTEX}
      varying vec2 vUv;
      varying vec2 vScene;
      #ifdef RELIEF
      attribute vec2 aField;
      attribute vec4 aSlope;
      uniform vec4 uMountain;
      varying float vRise;
      varying vec2 vSlope;
      #ifdef SUN_SHADOW
      uniform vec4 uSunTexel;
      #endif
      #endif
      void main() {
        vec3 p = position;
        #ifdef RELIEF
        vRise = mix(aField.x, aField.y, uMountain.y);
        vSlope = mix(aSlope.xy, aSlope.zw, uMountain.y) * uMountain.x;
        p.z += vRise * uMountain.x;
        #endif
        vUv = sheetUv(vec2(p.x, -p.y));
        vec4 world = modelMatrix * vec4(p, 1.0);
        vScene = world.xy;
        #ifdef SUN_SHADOW
        #ifdef RELIEF
        // Read a little off the slope, so a ridge does not shade itself in stripes.
        vSun = (uSunMatrix * vec4(world.xyz + normalize(vec3(-vSlope, 1.0)) * uSunTexel.w, 1.0)).xyz;
        #else
        vSun = (uSunMatrix * world).xyz;
        #endif
        #endif
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      #ifdef PIXIE
      // The chart draws its own ground, rivers, and roads.
      #undef SURFACE
      #undef RIVERS
      #undef ROADS
      #endif
      ${NOISE}
      ${LIGHT}
      ${SUN_FRAGMENT}
      uniform sampler2D uBake;
      uniform float uBias;
      varying vec2 vUv;
      varying vec2 vScene;
      #ifdef PIXIE
      ${SHEET}
      ${PIXEL_COMMON}
      ${PIXEL_LAND_DECLS}
      #endif
      #if defined(RELIEF) || defined(RIVERS) || defined(ROADS)
      uniform float uPixel;
      #endif
      #ifdef RELIEF
      uniform vec4 uMountain;
      uniform vec2 uSnowLook;
      uniform vec3 uSlate;
      uniform vec3 uRock;
      uniform vec3 uSnow;
      uniform vec3 uSnowShade;
      varying float vRise;
      varying vec2 vSlope;
      #endif
      #if defined(RIVERS) || defined(ROADS)
      uniform sampler2D uGround;
      #endif
      #ifdef SURFACE
      uniform sampler2D uTile;
      uniform sampler2D uCover;
      uniform vec4 uSurface;
      uniform vec3 uToEye;
      #endif
      #ifdef RIVERS
      uniform vec3 uRiver;
      uniform vec3 uRiverShallow;
      uniform vec3 uRiverDeep;
      #endif
      #ifdef ROADS
      uniform vec3 uRoad;
      uniform vec3 uRoadCool;
      uniform vec3 uRoadWarm;
      #endif
      #ifdef PIXIE
      ${PIXEL_LAND_SKIN}
      #else
      ${BAKED_LAND_SKIN}
      #endif
      void main() {
        // The surface's facing, in scene space. Flat land looks straight up.
        vec3 n = vec3(0.0, 0.0, 1.0);
        // Where the cloud's shadow is read. The chart reads it at the middle of a texel.
        vec2 sceneAt = vScene;
        LandSkinOut skin = skinLand();
        sceneAt += skin.sceneShift;
        vec3 c = skin.c;
        float snowy = skin.snowy;
        float level = skin.level;
        #ifdef SURFACE
        // A printed sheet under flock: a little of the colour comes out.
        c = mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, uSurface.w);
        #endif

        #if defined(RELIEF) && !defined(PIXIE)
        // The range is low, so its slopes are read steeper than they are for the light.
        n = normalize(vec3(-vSlope * 2.4, 1.0));
        float foot = smoothstep(0.02, 0.3, vRise);
        vec3 rock = mix(uSlate, uRock, smoothstep(0.24, 0.72, vRise));
        rock *= 0.9 + 0.2 * vnoise(vScene * 1.7);
        // Faint benches up the slope, the way a carved model shows its layers.
        rock *= 1.0 - 0.08 * smoothstep(0.1, 0.0, abs(fract(vRise * 8.0) - 0.5)) * foot;
        c = mix(c, rock, foot * 0.8 * uSnowLook.y);
        // Snow comes on over a band and is scattered through it: a speckle a pixel or two across
        // while there is room for one, and a soft drift under that.
        float speck = mix(vnoise(vScene * 2.6), hash21(floor(vScene * 9.0)), 0.6 * smoothstep(0.5, 1.2, 0.111 / uPixel));
        float snow = smoothstep(uMountain.z - uMountain.w, uMountain.z + uMountain.w, vRise + (speck - 0.5) * uMountain.w * 1.7);
        // A steep face holds less of it.
        snow *= 1.0 - 0.55 * smoothstep(0.12, 0.42, 1.0 - n.z);
        snow *= uSnowLook.y;
        // Snow shows its ridges by colour as well as by light: white toward the sun, and a cold
        // blue-grey on the face turned from it. Level snow is nearly white.
        float facing = dot(normalize(vec3(-vSlope * 4.0, 1.0)), uSunDir) - uSunDir.z;
        c = mix(c, mix(uSnowShade, uSnow, smoothstep(-0.25, 0.1, facing)), snow);
        #endif

        #if defined(RIVERS) || defined(ROADS)
        vec4 ground = texture2D(uGround, vUv);
        #endif
        #ifdef RIVERS
        {
          vec2 way = (ground.rg * 255.0 - 128.0) * (${LINE_REACH} / 127.0);
          float d = length(way);
          vec2 away = way / max(d, 1e-4);
          float half_ = max(uRiver.x, uPixel * 0.6);
          float wet = 1.0 - smoothstep(half_ - uPixel, half_ + uPixel, d);
          // The channel is not cut into the land. Its banks are shaded as if it were: the bank
          // that faces the sun is lit, and the one under the sun is dark.
          float bank = (1.0 - wet) * (1.0 - smoothstep(half_, half_ * 1.9 + 0.14, d));
          float toSun = dot(-away, normalize(uSunDir.xy + 1e-4));
          c *= 1.0 + uRiver.z * 0.42 * toSun * bank * uRelief * uDirect;
          vec3 water = mix(uRiverShallow, uRiverDeep, uRiver.y * smoothstep(half_, 0.0, d));
          water += 0.05 * (vnoise(vScene * 3.1 + vec2(uTime * 0.21, uTime * 0.07)) - 0.5) * uRelief;
          c = mix(c, water, wet);
        }
        #endif
        #ifdef ROADS
        {
          vec2 way = (ground.ba * 255.0 - 128.0) * (${LINE_REACH} / 127.0);
          float d = length(way);
          float half_ = max(uRoad.x, uPixel * 0.55);
          float line = 1.0 - smoothstep(half_ - uPixel, half_ + uPixel, d);
          float edge = 1.0 - smoothstep(half_ * 1.8 - uPixel, half_ * 1.8 + uPixel, d);
          // A hair of shade either side keeps the pale line readable on pale ground.
          c *= 1.0 - 0.3 * (edge - line) * uRoad.y;
          c = mix(c, mix(uRoadCool, uRoadWarm, uRoad.z), line * uRoad.y);
        }
        #endif

        #ifdef SURFACE
        // The grain: one tile read at three sizes and three turns, so the eye finds no repeat.
        // Flock and soil are coarse. Sand and snow are fine and shallow. A slope is cut rock.
        float fine = texture2D(uCover, vUv).r;
        vec2 at = vScene * uSurface.z;
        vec3 broad = texture2D(uTile, mat2(0.6, 0.8, -0.8, 0.6) * at * 0.31 + 0.11).xyz;
        vec3 mid = texture2D(uTile, at).xyz;
        vec3 small = texture2D(uTile, mat2(0.8, -0.6, 0.6, 0.8) * at * 2.7 + 0.37).xyz;
        vec2 tilt = (broad.xy - 0.502) * 0.6 * (1.0 - fine) + (mid.xy - 0.502) * mix(1.0, 0.3, fine) + (small.xy - 0.502) * mix(0.7, 0.9, fine);
        float bump = broad.z * 0.2 * (1.0 - fine) + mid.z * 0.45 + small.z * 0.35;
        float depth = uSurface.x * mix(1.0, 0.6, fine);
        #ifdef RELIEF
        depth *= 1.0 + 1.3 * foot;
        #endif
        // A low sun rakes every bump, and flock would turn to fur. The grain is eased as the sun drops.
        n = normalize(n + vec3(-tilt * depth * 6.0 * clamp(uSunDir.z * 1.1, 0.5, 1.0), 0.0));
        // The hollows of the grain hold a little shade.
        c *= 1.0 + (bump - 0.5) * 0.24 * depth * uRelief;
        #endif

        c *= lit(dot(n, uSunDir));
        c *= 1.0 - cloudShade(sceneAt);
        // Alpha carries the light that reaches the ground, for the pieces painted over it (see gradeMaterial).
        float reach = 1.0;
        float lightShare = 1.0;
        #ifdef SUN_SHADOW
        float shade = sunShade(vSun);
        reach = 1.0 - shade;
        #ifdef BASES_ONLY
        // A figure's shadow belongs to the bases. The ground keeps what the land itself casts.
        shade *= 1.0 - sunCards(vSun);
        #endif
        c *= mix(vec3(1.0), uSunTint, shade);
        lightShare = 1.0 - shade;
        #endif
        #ifdef SURFACE
        // Satin: a soft return toward the sun, wider and fainter as the ground gets rougher.
        float gloss = 1.0 - uSurface.y;
        float shine = pow(max(dot(n, normalize(uSunDir + uToEye)), 0.0), mix(8.0, 48.0, gloss));
        c += uSunColor * shine * gloss * 0.3 * uDirect * uRelief * lightShare;
        #endif
        #if defined(SURFACE) || defined(RELIEF)
        // The land is paper white at most, so the grain never glows.
        c = min(c, vec3(1.0));
        #endif
        #if defined(RELIEF) && !defined(PIXIE)
        // Snow on a face turned to the sun goes past white, and the glow spreads from it.
        c *= 1.0 + uSnowLook.x * snow * smoothstep(-0.02, 0.16, facing) * lightShare * uDirect;
        #endif
        #if defined(RELIEF) && defined(PIXIE)
        // Snow on the ranges blooms: the lit side goes past white and the glow spreads from it, as on a Shogun II peak.
        c *= 1.0 + uSnowLook.x * snowy * (0.35 + 0.65 * smoothstep(-0.1, 0.5, level)) * lightShare * uDirect;
        #endif
        #ifdef PIXIE
        // Shade stops at warm slate umber. Nothing on the chart goes to black, so a dark piece still reads on it.
        c = max(c, PIX_FLOOR);
        #endif
        gl_FragColor = vec4(c, reach);
      }
    `,
  });
  if (relief) {
    // The range lies on the land's top face where its height is 0. It wins that tie.
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -2;
  }
  return material;
}

/** The sculpted ranges, as the sun sees them. `uMountain` is the land's, so they rise together. */
export function mountainCasterMaterial(shared: SharedUniforms): THREE.ShaderMaterial {
  return caster(
    new THREE.ShaderMaterial({
      uniforms: { uMountain: shared.uMountain },
      vertexShader: /* glsl */ `
        attribute vec2 aField;
        uniform vec4 uMountain;
        void main() {
          vec3 p = position;
          p.z += mix(aField.x, aField.y, uMountain.y) * uMountain.x;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: CASTER_FRAGMENT,
    }),
  );
}

/** The cliff between land and water: strata, darker and wet toward the foot, lit by its facing. */
export function cliffMaterial(shared: SharedUniforms, drop: number, ground: GroundUniforms = groundUniforms()): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...lightUniforms(shared),
      uTile: ground.uTile,
      uSurface: ground.uSurface,
      uDrop: { value: drop },
      uRockHigh: { value: blend(MILITARY.brown, MILITARY.tan, 0.28) },
      uRockLow: { value: blend(MILITARY.taupe, MILITARY.brown, 0.2) },
      uRockWet: { value: blend(MILITARY.taupe, MILITARY.charcoal, 0.6) },
      uRockLip: { value: blend(MILITARY.tan, MILITARY.brown, 0.3) },
    },
    vertexShader: /* glsl */ `
      uniform float uDrop;
      varying vec3 vNormal;
      varying float vHeight;
      varying float vAlong;
      void main() {
        vNormal = normal;
        vHeight = position.z / uDrop;
        vAlong = dot(position.xy, vec2(-normal.y, normal.x));
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE}
      ${LIGHT}
      uniform vec3 uRockHigh;
      uniform vec3 uRockLow;
      uniform vec3 uRockWet;
      uniform vec3 uRockLip;
      varying vec3 vNormal;
      varying float vHeight;
      varying float vAlong;
      #ifdef SURFACE
      uniform sampler2D uTile;
      uniform vec4 uSurface;
      uniform float uDrop;
      #endif
      void main() {
        float wobble = vnoise(vec2(vAlong * 0.8, 3.0)) * 1.3;
        float band = floor(vHeight * 5.0 + wobble);
        vec3 rock = mix(uRockLow, uRockHigh, clamp(band / 5.0, 0.0, 1.0));
        rock *= 0.9 + 0.2 * hash21(vec2(band, floor(vAlong * 0.5)));
        rock *= 0.95 + 0.1 * vnoise(vec2(vAlong * 3.0, vHeight * 2.0));
        rock = mix(rock, uRockWet, smoothstep(0.26, 0.04, vHeight));
        rock = mix(rock, uRockLip, step(0.92, vHeight) * 0.7);
        vec3 n = normalize(vNormal);
        float ndl = dot(n, uSunDir);
        #ifdef SURFACE
        // Cut plaster: the same grain as the land, laid along the face, a little deeper.
        vec3 cut = texture2D(uTile, vec2(vAlong, vHeight * uDrop) * uSurface.z * 2.2).xyz;
        rock *= 1.0 + (cut.z - 0.5) * 0.36 * uSurface.x * uRelief;
        ndl += (cut.x - 0.502) * 3.0 * uSurface.x;
        #endif
        // The cliffs in view face the viewer and away from the sun. A fill from the near side keeps the strata readable.
        vec3 light = lit(stepped(ndl * 1.15)) + vec3(0.14, 0.14, 0.16) * max(-n.y, 0.0) * uRelief;
        gl_FragColor = vec4(rock * light, 1.0);
      }
    `,
  });
}

// --- Water --------------------------------------------------------------------------------------

/**
 * The sea. It lies below the land and is slid north by `uShift`, so the sheet drawn on it lands
 * where the 2D view puts it (see boardCamera.ts). The cliff's foot is the coast moved south by the
 * same amount, and the surf and the cliff's shadow are measured from there.
 *
 * `PIXIE` draws it as the pixel chart's sea: read at the middle of a texel fixed to the board,
 * and coloured in flat depth bands by the distance to the coast, which is read from a field made
 * once for the map (see buildCoastField). The dashes, the surf, and the glints are drawn on the
 * same texels.
 */
export function waterMaterial(shared: SharedUniforms, drop: number, pixie: PixieUniforms = pixieUniforms()): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...lightUniforms(shared),
      uPixGrid: pixie.uPixGrid,
      uPixSea: pixie.uPixSea,
      uPixIds: pixie.uPixIds,
      uPixCoast: pixie.uPixCoast,
      uPixFoam: pixie.uPixFoam,
      uPixShips: pixie.uPixShips,
      uPixShipN: pixie.uPixShipN,
      uBake: shared.uBake,
      uMask: shared.uMask,
      uBounds: shared.uBounds,
      uShadowVec: shared.uShadowVec,
      uShadowAlpha: shared.uShadowAlpha,
      uBias: { value: 0 },
      uShift: { value: 0 },
      uDrop: { value: drop },
      uWater: { value: 0 },
      uFoam: { value: blend(MILITARY.cream, MILITARY.sage, 0.38) },
      uWaveTint: { value: blend(MILITARY.spruce, MILITARY.sage, 0.4) },
      uTable: { value: blend(MILITARY.charcoal, MILITARY.brown, 0.22) },
      uNeat: { value: rgbOf(MILITARY.cream) },
      ...sunUniforms(shared),
      /** The sky the sea mirrors, read only with `SKY_SHEEN`: a prefiltered cube with y up. */
      uSky: { value: null },
      /** Share of the sky laid over the painted sea, and the brightness of the sun's glitter. */
      uSheen: { value: new THREE.Vector2(0, 0) },
      /** Unit vector from the board toward the camera. */
      uToEye: { value: new THREE.Vector3(0, 0, 1) },
      /** 1 with the camera far out: the glitter is then read as if the eye stood on the sun path. */
      uSheenFar: { value: 0 },
      /** Patch size, glint spacing, scatter, and how often a breaking wave pops. */
      uSheenShape: { value: new THREE.Vector4(0.7, 1.2, 0.7, 0.5) },
      /** How many glints are lit at once, and how fast each flickers: 1 is the usual, 2 twice as many and twice as quick, 0 none. */
      uSheenFreq: { value: 1 },
      /** The middle of the view, and one over its half reach each way: the glitter gathers under the sun. */
      uEye: { value: new THREE.Vector4(0, 0, 1, 1) },
    },
    vertexShader: /* glsl */ `
      ${SUN_VERTEX}
      varying vec2 vScene;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vScene = world.xy;
        #ifdef SUN_SHADOW
        vSun = (uSunMatrix * world).xyz;
        #endif
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE}
      ${LIGHT}
      ${SHEET}
      ${SUN_FRAGMENT}
      #ifdef SKY_SHEEN
      uniform samplerCube uSky;
      uniform vec2 uSheen;
      uniform vec3 uToEye;
      uniform vec4 uEye;
      uniform float uSheenFar;
      uniform vec4 uSheenShape;
      uniform float uSheenFreq;
      // Height of the swell at a scene point: two long sets crossing.
      float seaHeight(vec2 p) {
        float h = vnoise(p * 0.42 + vec2(uTime * 0.09, uTime * 0.05)) * 0.6;
        h += vnoise(p * 0.95 - vec2(uTime * 0.13, uTime * 0.04)) * 0.4;
        return h;
      }
      #endif
      uniform sampler2D uBake;
      uniform sampler2D uMask;
      uniform vec2 uShadowVec;
      uniform float uShadowAlpha;
      uniform float uBias;
      uniform float uShift;
      uniform float uDrop;
      uniform float uWater;
      uniform vec3 uFoam;
      uniform vec3 uWaveTint;
      uniform vec3 uTable;
      uniform vec3 uNeat;
      varying vec2 vScene;
      #ifdef PIXIE
      ${PIXEL_COMMON}
      ${PIXEL_SEA_SKIN}
      #else
      ${BAKED_SEA_SKIN}
      #endif
      void main() {
        // The texel this piece of water lies in, if the skin has texels. Everything below is read at its middle.
        SeaTexel tx = seaTexel(vScene);
        vec2 at = tx.at;
        // The map point this piece of water shows, and the same point measured from the cliff's foot.
        vec2 m = vec2(at.x, uShift - at.y);
        vec2 foot = m - vec2(0.0, uShift);
        vec3 c = seaBase(tx, m, foot);
        // The surf is read where the pixel is, not at the middle of its texel, so its rings stay smooth round the coast.
        vec2 mw = seaWaveAt(vScene, m);
        vec2 footW = mw - vec2(0.0, uShift);
        vec3 mask = texture2D(uMask, sheetUv(footW)).rgb;
        float shore = clamp(mask.b * 2.0, 0.0, 1.0);
        float edge = mask.g;

        // A slow swell, then drifting dashes on the open sea.
        float swell = fbm(mw * 0.05 + vec2(uTime * 0.03, uTime * 0.011));
        c += (swell - 0.5) * 0.05 * uWater * SKIN_SWELL;
        float row = floor(mw.y / 1.4);
        float rowSeed = hash21(vec2(row, 7.0));
        float along = mw.x * 0.55 + uTime * (0.12 + 0.2 * rowSeed) + rowSeed * 40.0;
        float dash = step(0.74, vnoise(vec2(along, row * 1.7))) * step(0.45, rowSeed) * step(fract(mw.y / 1.4), 0.22);
        c = mix(c, uWaveTint, dash * 0.24 * uWater * (1.0 - shore));

        // Surf: bands that roll in toward the cliff and break, and a line of foam that laps at its foot.
        float phase = shore * 3.2 - uTime * 0.16 + (vnoise(mw * 0.35) - 0.5) * 0.9;
        float crest = smoothstep(0.78, 0.86, fract(phase)) * smoothstep(0.1, 0.5, shore);
        float broken = step(0.35, vnoise(vec2(mw.x * 1.3 + uTime * 0.2, mw.y * 1.3)));
        float rings = seaRings();
        float foam = min(crest * broken * 0.6 * rings, 1.0);
        float lap = 0.05 * sin(uTime * 0.8 + vnoise(mw * 0.5) * 6.2832);
        foam = max(foam, smoothstep(0.3 + lap, 0.42 + lap, edge) * (0.55 + 0.45 * vnoise(mw * 2.2 + uTime * 0.3)));
        foam = floor(foam * 3.0 + 0.5) / 3.0;
        c = mix(c, uFoam, foam * uWater);

        // The cliff's shadow on the water, and glints where the sun still reaches.
        #ifdef SUN_SHADOW
        float shade = sunShade(vSun);
        float thrown = shade;
        #ifdef BASES_ONLY
        // A ship's shadow belongs to its base. The water keeps what the cliff casts.
        shade *= 1.0 - sunCards(vSun);
        #endif
        #else
        vec2 toSun = vec2(-uShadowVec.x, uShadowVec.y) * uDrop;
        float shade = max(texture2D(uMask, sheetUv(foot + toSun * 0.5)).g, texture2D(uMask, sheetUv(foot + toSun)).g);
        shade = smoothstep(0.4, 0.6, shade);
        #endif

        #ifdef SKY_SHEEN
        // The sky on the swell. The camera is orthographic, so the eye is bent across the view, the
        // way a real lens would see it, and the sun's light gathers in one patch of the sea, under
        // the sun, and not evenly over all of it.
        vec2 p = vec2(m.x, -m.y);
        float h0 = seaHeight(p);
        vec2 slope = vec2(seaHeight(p + vec2(0.3, 0.0)) - h0, seaHeight(p + vec2(0.0, 0.3)) - h0) / 0.3;
        vec3 n = normalize(vec3(-slope * 0.3, 1.0));
        // The patch is smaller as the radius falls, and its edge is scattered by a slow noise so it is not a clean oval.
        vec2 off = (at - uEye.xy) * uEye.zw / max(uSheenShape.x, 0.05);
        off += (vec2(vnoise(m * 0.09 + 4.0), vnoise(m * 0.09 + 19.0)) - 0.5) * 0.5 * uSheenShape.z;
        vec3 eye = normalize(uToEye - vec3(off.x * 0.6, off.y * 0.3, 0.0));
        // From straight above, the sun path is out of reach of a flat sea. Far out, the eye is read as if it stood on that path, so the glitter still gathers under the sun.
        eye = normalize(mix(eye, normalize(vec3(-uSunDir.xy, uSunDir.z) - vec3(off.x * (0.6 + 1.6 * uSheenFar), off.y * (0.3 + 1.2 * uSheenFar), 0.0)), uSheenFar * 0.9));
        vec3 r = reflect(-eye, n);
        // A slope turned from the eye mirrors the pale haze low in the sky. A flat one mirrors the zenith.
        vec3 sky = textureLod(uSky, vec3(r.x, r.z, -r.y), 1.5).rgb;
        float calm = 1.0 - shore * 0.7;
        // A skin that keeps its depth bands flat takes none of the sky and leaves SKIN_SKY at 0.
        c = mix(c, sky, SKIN_SKY * uSheen.x * calm * (0.55 + 0.45 * smoothstep(0.0, 0.35, 1.0 - dot(n, eye))));
        // The sun's patch: a warm wash, and inside it short dashes of light that come and go, drawn
        // the way the sea's own dashes are. Most of the patch stays water.
        float glare = pow(max(dot(r, uSunDir), 0.0), mix(26.0, 18.0, uSheenFar)) * calm * uDirect * (1.0 - shade);
        vec3 sunlit = uSunColor * vec3(1.0, 0.92, 0.76);
        c += sunlit * glare * uSheen.x * 0.32;
        float dashes = seaGlints(tx, m, glare);
        c += sunlit * dashes * uSheen.y;
        // Now and then a wave breaks in the sun and throws a glint. It is rare, and only where the light could catch it.
        float catchSun = smoothstep(0.15, 0.85, dot(r, uSunDir)) * calm * uDirect * (1.0 - shade);
        float breaking = max(crest * broken, dash);
        vec2 popCell = seaPopCell(tx, m);
        float popRoll = hash21(popCell + 5.0 + floor(uTime * 3.0 + hash21(popCell.yx) * 5.0) * 29.0);
        float pop = step(1.0 - 0.03 * uSheenShape.w, popRoll) * step(0.2, breaking) * catchSun;
        c += sunlit * pop * uSheen.y * 1.4;
        #endif

        #ifdef SUN_SHADOW
        c *= mix(vec3(1.0), uSunTint, shade);
        #else
        c *= 1.0 - uShadowAlpha * shade;
        #endif
        float glint = hash21(floor(m * 3.0) + floor(uTime * 2.0) * 13.0);
        c += uSunColor * step(0.9978, glint) * 0.14 * uWater * uDirect * (1.0 - shade);

        c *= lit(uSunDir.z);
        c *= 1.0 - cloudShade(at);

        // Past the top and bottom of the sheet the board ends and the table shows.
        float past = max(uBounds.y - m.y, m.y - (uBounds.y + uBounds.w));
        c = mix(c, uNeat, 0.3 * step(-1.1, past) * step(past, -0.7));
        vec3 table = uTable * (0.92 + 0.12 * vnoise(vec2(m.x * 0.12, m.y * 2.4))) * (0.62 + 0.38 * smoothstep(0.0, 6.0, past));
        c = mix(c, table, step(0.0, past));
        #ifdef SUN_SHADOW
        gl_FragColor = vec4(c, 1.0 - thrown * step(past, 0.0));
        #else
        gl_FragColor = vec4(c, 1.0 - shade * step(past, 0.0));
        #endif
      }
    `,
  });
}

// --- Props --------------------------------------------------------------------------------------

const PROP_VERTEX = /* glsl */ `
attribute float aPart;
attribute vec3 aFlag;
attribute vec2 aRise;
uniform float uGrow;
uniform vec4 uMountain;
#ifdef LANDMARK
// How high up the monument a vertex is, from 0 at its base to 1 at its spire.
attribute float aNormY;
varying float vNormY;
#endif
// The model point in the board's space: an optional part folds away, and everything rises with uGrow.
// A prop on a sculpted range stands on it: aRise is the range's two shapes at its foot (see mountainRelief.ts).
vec3 propPoint() {
  vec3 p = position;
  float rise = mix(aRise.x, aRise.y, uMountain.y);
  // Nothing grows above the tree line. Rock and dunes (aFlag.z) stand wherever they are put.
  if ((aPart > 2.5 && aFlag.x < 0.5) || (uMountain.x > 0.0 && aFlag.z < 0.01 && rise > 0.4)) {
    p = vec3(0.0);
  }
  // A tree grows from the board as the camera comes in. A landmark does not: it stands at its own size, and
  // is revealed by its height instead (see LANDMARK_REVEAL).
  #ifdef LANDMARK
  vNormY = aNormY;
  #else
  p.xy *= mix(0.35, 1.0, uGrow);
  p.z *= uGrow;
  #endif
  vec3 at = (instanceMatrix * vec4(p, 1.0)).xyz;
  at.z += rise * uMountain.x;
  return at;
}
`;

/**
 * The reveal of a city landmark, from `uLandmarkReveal` 0 to 1. The first share of it fades the base in
 * (the lowest tenth of the monument: its plinth), and the rest raises the monument from the base up: a
 * vertex shows once the rising height has passed it, and the top of that height is a soft band.
 */
const LANDMARK_REVEAL = /* glsl */ `
#ifdef LANDMARK
varying float vNormY;
uniform float uLandmarkReveal;
uniform float uLandmarkBand;
const float LM_PLINTH = 0.1;
uniform float uLandmarkBaseShare;
// The base takes the first stretch of the window (a fixed bit of zoom), the monument the rest.
float lmAlpha(float y) {
  float base = smoothstep(0.0, uLandmarkBaseShare, uLandmarkReveal);
  if (y < LM_PLINTH) {
    return base;
  }
  float rise = clamp((uLandmarkReveal - uLandmarkBaseShare) / (1.0 - uLandmarkBaseShare), 0.0, 1.0);
  float top = rise * (1.0 + uLandmarkBand);
  return 1.0 - smoothstep(top - uLandmarkBand, top, y);
}
float lmBayer2(vec2 a) {
  a = mod(floor(a), 2.0);
  return fract(a.x * 0.5 + a.y * 0.75);
}
// A 4 by 4 ordered threshold, so the fade is made of whole pixels: the chart's own dither.
float lmBayer(vec2 p) {
  return lmBayer2(0.5 * p) * 0.25 + lmBayer2(p) + 0.03125;
}
#endif
`;

/** What a landmark's materials share: how far through its reveal it is, and how soft the top of it is. */
export interface LandmarkUniforms {
  uLandmarkReveal: { value: number };
  uLandmarkBand: { value: number };
  /** The share of the reveal the base takes before the monument rises. */
  uLandmarkBaseShare: { value: number };
}

export function landmarkUniforms(): LandmarkUniforms {
  return { uLandmarkReveal: { value: 0 }, uLandmarkBand: { value: 0.08 }, uLandmarkBaseShare: { value: 0.3 } };
}

/** Trees, peaks, and buildings. With `landmark` it is a city landmark, at a fixed size and revealed from the ground up. */
export function propMaterial(shared: SharedUniforms, landmark?: LandmarkUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexColors: true,
    defines: landmark ? { LANDMARK: 1 } : {},
    uniforms: {
      ...lightUniforms(shared),
      ...sunUniforms(shared),
      ...(landmark ?? {}),
      uBake: shared.uBake,
      uBounds: shared.uBounds,
      uMountain: shared.uMountain,
      uGrow: { value: 0 },
      uSnow: { value: new THREE.Vector3(0.88, 0.86, 0.8) },
    },
    vertexShader: /* glsl */ `
      ${NOISE}
      ${LIGHT}
      ${SHEET}
      ${PROP_VERTEX}
      ${SUN_VERTEX}
      #ifdef SUN_SHADOW
      uniform vec4 uSunTexel;
      varying float vSunFacing;
      #endif
      uniform sampler2D uBake;
      uniform vec3 uSnow;
      varying vec3 vColor;
      void main() {
        vec3 local = propPoint();
        // Footprint and height scale apart, so the normal is carried by the inverse scale.
        vec3 sx = instanceMatrix[0].xyz;
        vec3 sz = instanceMatrix[2].xyz;
        vec3 scale2 = vec3(dot(sx, sx), dot(sx, sx), dot(sz, sz));
        vec3 n = normalize(mat3(instanceMatrix) * (normal / scale2));
        vec3 base = color;
        if (aPart > 0.5 && aPart < 2.5) {
          base = instanceColor * color.r;
          if (aFlag.z > 0.0) {
            // Raised ground wears its territory's colour at the foot and its own toward the top.
            // A coarse level of the sheet gives the territory's colour without its ink and grain.
            vec2 origin = instanceMatrix[3].xy;
            vec3 ground = textureLod(uBake, sheetUv(vec2(origin.x, -origin.y)), 3.0).rgb;
            float share = aFlag.z * mix(1.0, 0.7, smoothstep(0.0, 0.85, position.z));
            base = mix(base, ground * color.r, share);
          }
          if (aPart > 1.5) {
            base = mix(base, uSnow * color.r, aFlag.x);
          }
        }
        // A little darker where it meets the ground.
        base *= mix(0.84, 1.0, smoothstep(0.0, 0.45, position.z));
        vec4 world = modelMatrix * vec4(local, 1.0);
        // Wrapped light in three flat steps: a slope turned from the sun dims and does not go black,
        // and a top facing the sky comes out a little brighter than the land around it.
        // The sun stays on the far side of the table, so the slopes that face the viewer take a
        // fill from the near side and keep their colour.
        vec3 light = lit(stepped(dot(n, uSunDir) * 0.62 + 0.4)) + vec3(0.2, 0.2, 0.22) * max(-n.y, 0.0) * uRelief;
        vColor = base * light * (1.0 - cloudShade(world.xy));
        #ifdef SUN_SHADOW
        // Looked up a little off the face, so a slope does not shade itself in stripes. A face
        // already turned from the sun is dark by its own light and takes no cast shadow on top.
        vSun = (uSunMatrix * vec4(world.xyz + n * uSunTexel.w, 1.0)).xyz;
        vSunFacing = smoothstep(0.04, 0.3, dot(n, uSunDir));
        #endif
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      ${SUN_FRAGMENT}
      ${LANDMARK_REVEAL}
      #ifdef SUN_SHADOW
      varying float vSunFacing;
      #endif
      varying vec3 vColor;
      void main() {
        vec3 c = vColor;
        #ifdef SUN_SHADOW
        c *= mix(vec3(1.0), uSunTint, sunShade(vSun) * vSunFacing);
        #endif
        #ifdef LANDMARK
        float shown = lmAlpha(vNormY);
        if (shown < lmBayer(gl_FragCoord.xy)) {
          discard;
        }
        // A warm edge where the monument is still rising, and held under 1.0 so it never reaches the bloom.
        float edge = shown < 0.999 ? shown * (1.0 - shown) * 4.0 : 0.0;
        c = mix(c, min(c + vec3(0.16, 0.1, 0.03), vec3(0.97)), edge);
        #endif
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
}

/**
 * Ordinary alpha blending for the colour, and the frame's own alpha left as it is. The land and
 * the water write how much sun reaches them there (see gradeMaterial), and a mark or a puff laid
 * over them must not change it.
 */
function keepAlpha<T extends THREE.Material>(material: T): T {
  material.blending = THREE.CustomBlending;
  material.blendSrc = THREE.SrcAlphaFactor;
  material.blendDst = THREE.OneMinusSrcAlphaFactor;
  material.blendSrcAlpha = THREE.ZeroFactor;
  material.blendDstAlpha = THREE.OneFactor;
  return material;
}

/** Every shadow shares one stencil bit, so two that overlap darken the ground once. */
function shadowStencil(material: THREE.ShaderMaterial): THREE.ShaderMaterial {
  keepAlpha(material);
  material.transparent = true;
  material.depthWrite = false;
  material.stencilWrite = true;
  material.stencilRef = 1;
  material.stencilFunc = THREE.NotEqualStencilFunc;
  material.stencilFail = THREE.KeepStencilOp;
  material.stencilZFail = THREE.KeepStencilOp;
  material.stencilZPass = THREE.ReplaceStencilOp;
  return material;
}

const SHADOW_COLOR = blend(MILITARY.charcoal, MILITARY.plum, 0.25).multiplyScalar(0.55);

/** A prop's shadow: the model laid flat on the land along the sun's ray. It stops at the coast. */
export function propShadowMaterial(shared: SharedUniforms, landmark?: LandmarkUniforms): THREE.ShaderMaterial {
  return shadowStencil(
    new THREE.ShaderMaterial({
      defines: landmark ? { LANDMARK: 1 } : {},
      uniforms: {
        ...(landmark ?? {}),
        uGrow: { value: 0 },
        // The flattened shadow lies on level ground. It is the stand-in for boards with no shadow map.
        uMountain: { value: new THREE.Vector4(0, 0, 0, 0) },
        uShadowVec: shared.uShadowVec,
        uShadowAlpha: shared.uShadowAlpha,
        uMask: shared.uMask,
        uBounds: shared.uBounds,
        uColor: { value: SHADOW_COLOR },
      },
      vertexShader: /* glsl */ `
        ${PROP_VERTEX}
        uniform vec2 uShadowVec;
        varying vec2 vMap;
        void main() {
          vec3 local = propPoint();
          vec2 ground = local.xy + uShadowVec * local.z;
          vMap = vec2(ground.x, -ground.y);
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(ground, 0.03, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${SHEET}
        ${LANDMARK_REVEAL}
        uniform sampler2D uMask;
        uniform float uShadowAlpha;
        uniform vec3 uColor;
        varying vec2 vMap;
        void main() {
          if (texture2D(uMask, sheetUv(vMap)).r < 0.5) {
            discard;
          }
          #ifdef LANDMARK
          if (lmAlpha(vNormY) < 0.5) {
            discard;
          }
          #endif
          gl_FragColor = vec4(uColor, uShadowAlpha);
        }
      `,
    }),
  );
}

// --- What the sun's shadow map is drawn with ----------------------------------------------------
//
// The map holds depth only, so these write no colour. Both faces are drawn, and the depth is
// pushed a little away from the sun along a slope, which keeps a lit face from shading itself.

function caster(material: THREE.ShaderMaterial): THREE.ShaderMaterial {
  material.colorWrite = false;
  material.side = THREE.DoubleSide;
  material.polygonOffset = true;
  material.polygonOffsetFactor = 1.4;
  material.polygonOffsetUnits = 2;
  return material;
}

const CASTER_FRAGMENT = /* glsl */ `
void main() {
  gl_FragColor = vec4(1.0);
}
`;

/** The cliff, as the sun sees it. */
export function cliffCasterMaterial(): THREE.ShaderMaterial {
  return caster(
    new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        void main() {
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: CASTER_FRAGMENT,
    }),
  );
}

/** Trees, peaks, and buildings, as the sun sees them. `uGrow` is the prop material's, so they rise together. */
export function propCasterMaterial(
  grow: { value: number },
  mountain: { value: THREE.Vector4 },
  landmark?: LandmarkUniforms,
): THREE.ShaderMaterial {
  return caster(
    new THREE.ShaderMaterial({
      defines: landmark ? { LANDMARK: 1 } : {},
      uniforms: { uGrow: grow, uMountain: mountain, ...(landmark ?? {}) },
      vertexShader: /* glsl */ `
        ${PROP_VERTEX}
        void main() {
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(propPoint(), 1.0);
        }
      `,
      // The same height cut as the building's own, so its shadow grows as it does.
      fragmentShader: /* glsl */ `
        ${LANDMARK_REVEAL}
        void main() {
          #ifdef LANDMARK
          if (lmAlpha(vNormY) < 0.5) {
            discard;
          }
          #endif
          gl_FragColor = vec4(1.0);
        }
      `,
    }),
  );
}

/**
 * Standing figures, as the sun sees them. Each instance is a card on the figure's feet, turned
 * square to the sun, and cut to the figure's own picture: `uFigures` is the canvas the map
 * stamped the figures on (see figureCards.ts), and a texel under half opacity casts nothing.
 *
 * `aFoot` is the feet in scene coordinates. `aBox` is the picture's rectangle measured from the
 * feet in world units: across, up, width, height. `aSheet` is the same rectangle on the canvas.
 */
export function cardCasterMaterial(): THREE.ShaderMaterial {
  return caster(
    new THREE.ShaderMaterial({
      uniforms: {
        uFigures: { value: null },
        /** Level unit vector across the light. The card's width runs along it. */
        uSide: { value: new THREE.Vector3(1, 0, 0) },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aFoot;
        attribute vec4 aBox;
        attribute vec4 aSheet;
        uniform vec3 uSide;
        varying vec2 vUv;
        void main() {
          float across = aBox.x + position.x * aBox.z;
          // Nothing of a figure is below its feet. Rows under them fold onto the ground.
          float up = max(0.0, aBox.y + position.y * aBox.w);
          vec3 world = aFoot + uSide * across + vec3(0.0, 0.0, up);
          vUv = mix(aSheet.xy, aSheet.zw, position.xy);
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uFigures;
        varying vec2 vUv;
        void main() {
          float a = texture2D(uFigures, vUv).a;
          if (a < 0.5) {
            discard;
          }
          gl_FragColor = vec4(1.0);
        }
      `,
    }),
  );
}

/** The shadow under a counter or a figure: an ellipse on the board. One unit quad per instance. */
export function unitShadowMaterial(): THREE.ShaderMaterial {
  return shadowStencil(
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: SHADOW_COLOR }, uAlpha: { value: 0.25 } },
      vertexShader: /* glsl */ `
        varying vec2 vAt;
        void main() {
          vAt = position.xy;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uAlpha;
        varying vec2 vAt;
        void main() {
          if (dot(vAt, vAt) > 1.0) {
            discard;
          }
          gl_FragColor = vec4(uColor, uAlpha);
        }
      `,
    }),
  );
}

// --- Battle marks -------------------------------------------------------------------------------

/** A shell crater: a rim and a pit, on the board. One unit quad per instance. */
export function craterMaterial(shared: SharedUniforms): THREE.ShaderMaterial {
  return keepAlpha(new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      ...lightUniforms(shared),
      uRim: { value: rgbOf(MILITARY.taupe) },
      uPit: { value: rgbOf(MILITARY.charcoal) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vAt;
      void main() {
        vAt = position.xy;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE}
      ${LIGHT}
      uniform vec3 uRim;
      uniform vec3 uPit;
      varying vec2 vAt;
      void main() {
        float d = length(vAt);
        if (d > 1.0) {
          discard;
        }
        // The pit is lit on the side away from the sun, the way a hollow is.
        float side = dot(normalize(vAt + 0.0001), normalize(uSunDir.xy + 0.0001));
        vec3 c = d < 0.46 ? uPit * (1.0 + 0.25 * step(0.2, -side) * uRelief) : uRim * (1.0 + 0.18 * step(0.2, side) * uRelief);
        // The churned rim lets the territory's colour through. The pit is nearly solid.
        gl_FragColor = vec4(c * lit(uSunDir.z), d < 0.46 ? 0.9 : 0.55);
      }
    `,
  }));
}

/**
 * Smoke: square puffs that face the camera, rise, drift, swell, and thin out. Each instance is one
 * puff of a column and loops on its own phase. `aOrigin` is the foot of the column in the board's
 * space, and `aPuff` is phase, kind (0 chimney, 1 battle), ember (0 or 1), and a seed.
 */
export function smokeMaterial(shared: SharedUniforms): THREE.ShaderMaterial {
  return keepAlpha(new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uStepTime: shared.uStepTime,
      uSmoke: { value: 0 },
      uCamUp: { value: new THREE.Vector3(0, 1, 0) },
      uSoot: { value: rgbOf(MILITARY.charcoal) },
      uAsh: { value: rgbOf(MILITARY.feldgrau) },
      uSteam: { value: blend(MILITARY.bone, MILITARY.cream, 0.4) },
      uEmber: { value: rgbOf(MILITARY.terracotta) },
      /** Brightness of an ember. 1 is the painted colour; above it the ember is hot enough to glow (see bloom). */
      uGlow: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aOrigin;
      attribute vec4 aPuff;
      uniform float uStepTime;
      uniform float uSmoke;
      uniform vec3 uCamUp;
      varying vec2 vAt;
      varying vec4 vPuff;
      varying float vAge;
      varying float vFade;
      float hash11(float n) {
        return fract(sin(n * 91.345) * 47453.5453);
      }
      void main() {
        float kind = aPuff.y;
        float t = uStepTime * mix(0.15, 0.2, kind) + aPuff.x;
        float age = fract(t);
        float turn = floor(t) + aPuff.w * 17.0;
        float r1 = hash11(turn);
        float r2 = hash11(turn + 3.7);
        float rise = mix(5.0, 10.0, kind) * (0.75 + 0.5 * r1) * age;
        vec2 drift = vec2(0.9, 0.25) * age * age * mix(2.6, 5.0, kind);
        drift += vec2(sin(age * 7.0 + r2 * 6.2832), cos(age * 5.0 + r1 * 6.2832)) * 0.35 * age;
        float size = mix(0.45, 1.0, pow(age, 0.6)) * mix(1.3, 3.2, kind) * (0.8 + 0.4 * r2);
        vec3 centre = (modelMatrix * vec4(aOrigin, 1.0)).xyz + vec3(drift, rise);
        vec3 corner = centre + vec3(1.0, 0.0, 0.0) * position.x * size + uCamUp * position.y * size;
        vAt = position.xy;
        vPuff = aPuff;
        vAge = age;
        vFade = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.5, 1.0, age)) * uSmoke;
        gl_Position = projectionMatrix * viewMatrix * vec4(corner, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform vec3 uSoot;
      uniform vec3 uAsh;
      uniform vec3 uSteam;
      uniform vec3 uEmber;
      uniform float uGlow;
      varying vec2 vAt;
      varying vec4 vPuff;
      varying float vAge;
      varying float vFade;
      void main() {
        float d = length(vAt);
        float ragged = vnoise(vAt * 2.6 + vPuff.w * 31.0);
        if (d > 0.5 - 0.16 * ragged || vFade <= 0.01) {
          discard;
        }
        vec3 dark = mix(uAsh, uSoot, vPuff.y);
        vec3 pale = mix(uSteam, uAsh, vPuff.y);
        vec3 c = mix(dark, pale, smoothstep(0.1, 0.8, vAge));
        c = mix(c, uEmber * uGlow, vPuff.z * (1.0 - smoothstep(0.0, 0.2, vAge)));
        // Two tones: the side toward the light is a step paler.
        c *= 0.9 + 0.18 * step(0.0, dot(vAt, vec2(-0.5, 0.85)));
        float alpha = floor(vFade * 4.0 + 0.5) / 4.0;
        gl_FragColor = vec4(c, alpha * mix(0.62, 0.82, vPuff.y));
      }
    `,
  }));
}

// --- Post ---------------------------------------------------------------------------------------

const SCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** How many 2D canvases the grade pass can lay over the board. */
export const OVERLAY_SLOTS = 3;
/** How many stacks the outline can mark at once: the one picked up, and the one under the pointer. */
export const OUTLINE_SLOTS = 2;

/**
 * Paper tooth over the finished picture, behind `GRAIN`. Two sizes of it: a fine one a pixel
 * across, and a fibre a few pixels long. It holds still, the way a print's does, and it bites the
 * mid tones: paper white and solid ink stay clean. `uGrain` is depth, pixel size, and nothing.
 */
const GRAIN = /* glsl */ `
#ifdef GRAIN
uniform vec3 uGrain;
float grainHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
vec3 grain(vec3 c) {
  vec2 at = gl_FragCoord.xy / max(uGrain.y, 1.0);
  float fine = grainHash(floor(at));
  vec2 cell = at / vec2(3.4, 2.2);
  vec2 i = floor(cell);
  vec2 f = fract(cell);
  f = f * f * (3.0 - 2.0 * f);
  float fibre = mix(
    mix(grainHash(i + 17.0), grainHash(i + vec2(18.0, 17.0)), f.x),
    mix(grainHash(i + vec2(17.0, 18.0)), grainHash(i + 18.0), f.x),
    f.y
  );
  float tooth = (fine - 0.5) * 1.3 + (fibre - 0.5) * 1.1;
  float tone = dot(c, vec3(0.299, 0.587, 0.114));
  float take = 0.3 + 0.7 * (1.0 - abs(tone * 2.0 - 1.0));
  return c + tooth * uGrain.x * take;
}
#endif
`;

/**
 * Grades the board and lays the 2D canvases over it. The board loses a little saturation so the
 * pieces stand off it; the canvases go on untouched. The menu's dim covers both.
 *
 * Four things can be built in, each behind its own define, and each absent from the shader when
 * its define is: `AO` multiplies the board by the shade buffer, `BLOOM` adds the glow buffer,
 * `SUN_SHADOW` lays the ground's cast shadow over the first canvas, and `OUTLINE` lines the
 * figures of a stack. With none of them this is the grade as it was.
 */
export function gradeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uAo: { value: null },
      /** The colour the deepest shade multiplies the board by: a warm ink, not a grey. */
      uAoInk: { value: new THREE.Vector3(0.34, 0.29, 0.33) },
      uBloom: { value: null },
      /** The glow's colour and strength. */
      uBloomTint: { value: new THREE.Vector3(1, 0.9, 0.74) },
      uSunTint: { value: new THREE.Vector3(1, 1, 1) },
      /** 1 while the round icon tokens are showing, 0 once the detailed figures are: no shadow lies over a token. */
      uTokenClear: { value: 0 },
      /** The figures of the marked stacks, alone on a clear canvas. */
      uOutMap: { value: null },
      uOutSize: { value: new THREE.Vector2(1, 1) },
      /** Each stack's rectangle on the frame, from its top-left corner: x, y, width, height. Width 0 is unused. */
      uOutRect: { value: [new THREE.Vector4(), new THREE.Vector4()] },
      /** Where each rectangle sits on `uOutMap`. */
      uOutAt: { value: [new THREE.Vector2(), new THREE.Vector2()] },
      /** Each line's colour and strength. */
      uOutInk: { value: [new THREE.Vector4(1, 1, 1, 1), new THREE.Vector4(1, 1, 1, 1)] },
      /** Line on or off, wash on or off, line width, wash reach: the last two in frame pixels. */
      uOutLook: { value: new THREE.Vector4(1, 0, 1.5, 6) },
      /** The dark edge outside the line, which keeps it readable on pale ground. */
      uOutEdge: { value: new THREE.Vector3(0.23, 0.2, 0.21) },
      uGrain: { value: new THREE.Vector3(0, 1, 0) },
      uScene: { value: null },
      uLayer0: { value: null },
      uLayer1: { value: null },
      uLayer2: { value: null },
      /** 1 for each slot that holds a canvas. */
      uOn: { value: new THREE.Vector3(0, 0, 0) },
      /** Added to a frame pixel to get the canvas texel: canvases are top-aligned and may be a row taller. */
      uLayerShift: { value: new THREE.Vector2(0, 0) },
      uLayerSize: { value: new THREE.Vector2(1, 1) },
      /** 1 reads the canvases texel for texel. 0 stretches them, when their size is not the frame's. */
      uExact: { value: 1 },
      uSaturation: { value: 0.86 },
      uWarm: { value: 0 },
      uDusk: { value: 0 },
      uDim: { value: 0 },
    },
    vertexShader: SCREEN_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D uScene;
      uniform sampler2D uLayer0;
      uniform sampler2D uLayer1;
      uniform sampler2D uLayer2;
      uniform vec3 uOn;
      uniform vec2 uLayerShift;
      uniform vec2 uLayerSize;
      uniform float uExact;
      uniform float uSaturation;
      uniform float uWarm;
      uniform float uDusk;
      uniform float uDim;
      varying vec2 vUv;
      #ifdef AO
      uniform sampler2D uAo;
      uniform vec3 uAoInk;
      #endif
      #ifdef BLOOM
      uniform sampler2D uBloom;
      uniform vec3 uBloomTint;
      #endif
      #ifdef SUN_SHADOW
      uniform vec3 uSunTint;
      uniform float uTokenClear;
      #endif
      ${GRAIN}
      #ifdef OUTLINE
      uniform sampler2D uOutMap;
      uniform vec2 uOutSize;
      uniform vec4 uOutRect[${OUTLINE_SLOTS}];
      uniform vec2 uOutAt[${OUTLINE_SLOTS}];
      uniform vec4 uOutInk[${OUTLINE_SLOTS}];
      uniform vec4 uOutLook;
      uniform vec3 uOutEdge;
      // Opacity of the stack's figures at a point of its rectangle. Every read names its level, so
      // none of them needs a gradient and all of them can sit behind the rectangle test.
      float figureAt(vec2 local, vec4 rect, vec2 at) {
        vec2 p = clamp(local, vec2(0.5), rect.zw - 0.5);
        return textureLod(uOutMap, vec2(at.x + p.x, uOutSize.y - at.y - p.y) / uOutSize, 0.0).a;
      }
      // The eight points of a ring. x is the most opaque of them, y is their mean.
      vec2 figureRing(vec2 local, vec4 rect, vec2 at, float r) {
        float d = r * 0.7071;
        float a = figureAt(local + vec2(r, 0.0), rect, at);
        float b = figureAt(local - vec2(r, 0.0), rect, at);
        float e = figureAt(local + vec2(0.0, r), rect, at);
        float f = figureAt(local - vec2(0.0, r), rect, at);
        float g = figureAt(local + vec2(d, d), rect, at);
        float h = figureAt(local - vec2(d, d), rect, at);
        float i = figureAt(local + vec2(d, -d), rect, at);
        float j = figureAt(local + vec2(-d, d), rect, at);
        return vec2(max(max(max(a, b), max(e, f)), max(max(g, h), max(i, j))), (a + b + e + f + g + h + i + j) / 8.0);
      }
      float outPaper(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        vec2 s = vec2(127.1, 311.7);
        float a = fract(sin(dot(i, s)) * 43758.5453);
        float b = fract(sin(dot(i + vec2(1.0, 0.0), s)) * 43758.5453);
        float c = fract(sin(dot(i + vec2(0.0, 1.0), s)) * 43758.5453);
        float d = fract(sin(dot(i + vec2(1.0, 1.0), s)) * 43758.5453);
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      vec3 outline(vec3 c, vec2 frag, vec4 rect, vec2 at, vec4 ink) {
        vec2 local = frag - rect.xy;
        if (rect.z < 1.0 || local.x < 0.0 || local.y < 0.0 || local.x > rect.z || local.y > rect.w) {
          return c;
        }
        float self = figureAt(local, rect, at);
        float outside = 1.0 - smoothstep(0.3, 0.7, self);
        if (uOutLook.y > 0.5) {
          // A wash: pigment let out past the figures, pooled at its own edge and broken by the paper.
          float near = figureRing(local, rect, at, uOutLook.w * 0.45).y;
          float far = figureRing(local, rect, at, uOutLook.w).y;
          float spread = near * 0.6 + far * 0.4;
          float tooth = 0.72 + 0.56 * outPaper(frag / (uOutLook.z * 2.4));
          float pool = smoothstep(0.02, 0.3, spread) * (1.0 - 0.45 * smoothstep(0.3, 0.8, spread));
          c = mix(c, ink.rgb, clamp(pool * tooth, 0.0, 1.0) * 0.62 * ink.a * outside);
        }
        if (uOutLook.x > 0.5) {
          // A line the width of a pen stroke, and a hair of dark outside it.
          float line = smoothstep(0.2, 0.55, figureRing(local, rect, at, uOutLook.z).x);
          float edge = smoothstep(0.2, 0.55, figureRing(local, rect, at, uOutLook.z * 1.85).x);
          c = mix(c, uOutEdge, edge * (1.0 - line) * 0.6 * ink.a * outside);
          c = mix(c, ink.rgb, line * ink.a * outside);
        }
        return c;
      }
      #endif
      vec4 layer(sampler2D map) {
        if (uExact > 0.5) {
          ivec2 at = ivec2(gl_FragCoord.xy + uLayerShift);
          at = clamp(at, ivec2(0), ivec2(uLayerSize) - 1);
          return texelFetch(map, at, 0);
        }
        return texture2D(map, vUv);
      }
      void main() {
        vec4 scene = texture2D(uScene, vUv);
        vec3 c = scene.rgb;
        #ifdef BLOOM
        // With the glow on, the hot marks are brighter than white. Brought back by their own
        // brightest channel they keep their colour: an ember stays orange and does not clip to white.
        c /= max(1.0, max(c.r, max(c.g, c.b)));
        #endif
        #ifdef AO
        // Shade in the crevices: under a cliff, at the foot of a mountain, between two roofs.
        c *= mix(uAoInk, vec3(1.0), texture2D(uAo, vUv).r);
        #endif
        float grey = dot(c, vec3(0.299, 0.587, 0.114));
        c = mix(vec3(grey), c, uSaturation);
        // Close in, a touch of warmth, the colour of a lamp over a table.
        c *= mix(vec3(1.0), vec3(1.035, 1.0, 0.955), uWarm);
        // The dusk look: thinner colour, harder contrast, a cold cast.
        vec3 dusk = (mix(vec3(grey), c, 0.75) - 0.5) * 1.12 + 0.5;
        c = mix(c, dusk * vec3(0.9, 0.96, 1.07), uDusk);
        #ifdef BLOOM
        // The glow goes on under the canvases, so it spreads over the board and never over a piece.
        c += texture2D(uBloom, vUv).rgb * uBloomTint;
        #endif
        // The canvases hold premultiplied colour.
        vec4 o = layer(uLayer0) * uOn.x;
        #ifdef SUN_SHADOW
        // The first canvas is what lies flat on the board: the washes, the counters, the bases the
        // figures stand on. A shadow cast across the ground crosses them too.
        // The round icon tokens are not under the sun: a cliff's shadow does not cross them. The detailed figures' bases are.
        o.rgb *= mix(mix(uSunTint, vec3(1.0), scene.a), vec3(1.0), uTokenClear);
        #endif
        c = c * (1.0 - o.a) + o.rgb;
        o = layer(uLayer1) * uOn.y;
        c = c * (1.0 - o.a) + o.rgb;
        #ifdef OUTLINE
        vec2 frag = vec2(gl_FragCoord.x + uLayerShift.x, uLayerSize.y - gl_FragCoord.y - uLayerShift.y);
        c = outline(c, frag, uOutRect[1], uOutAt[1], uOutInk[1]);
        c = outline(c, frag, uOutRect[0], uOutAt[0], uOutInk[0]);
        #endif
        o = layer(uLayer2) * uOn.z;
        c = c * (1.0 - o.a) + o.rgb;
        c = mix(c, ((c - 0.5) * 0.72 + 0.5) * 0.55, uDim);
        #ifdef GRAIN
        c = grain(c);
        #endif
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }
    `,
  });
}

/**
 * One direction of the miniature lens: sharp across the middle of the screen, softer toward the top
 * and bottom. Run across, then down. The second run also darkens the corners.
 */
export function lensMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uSource: { value: null },
      /** One texel along the blur direction. */
      uStep: { value: new THREE.Vector2(1, 0) },
      /** Blur radius at the screen's top and bottom edge, in texels. */
      uRadius: { value: 0 },
      uVignette: { value: 0 },
      /** Paper tooth, with `GRAIN`. Its depth is 0 on the first run, so it goes on once. */
      uGrain: { value: new THREE.Vector3(0, 1, 0) },
    },
    vertexShader: SCREEN_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D uSource;
      uniform vec2 uStep;
      uniform float uRadius;
      uniform float uVignette;
      varying vec2 vUv;
      ${GRAIN}
      void main() {
        float away = abs(vUv.y - 0.5) * 2.0;
        float reach = uRadius * smoothstep(0.46, 1.0, away) / 4.0;
        vec3 c = texture2D(uSource, vUv).rgb * 0.18;
        c += (texture2D(uSource, vUv + uStep * reach).rgb + texture2D(uSource, vUv - uStep * reach).rgb) * 0.15;
        c += (texture2D(uSource, vUv + uStep * reach * 2.0).rgb + texture2D(uSource, vUv - uStep * reach * 2.0).rgb) * 0.12;
        c += (texture2D(uSource, vUv + uStep * reach * 3.0).rgb + texture2D(uSource, vUv - uStep * reach * 3.0).rgb) * 0.09;
        c += (texture2D(uSource, vUv + uStep * reach * 4.0).rgb + texture2D(uSource, vUv - uStep * reach * 4.0).rgb) * 0.05;
        vec2 fromCentre = (vUv - 0.5) * vec2(1.1, 1.25);
        c *= 1.0 - uVignette * 0.5 * smoothstep(0.42, 1.0, length(fromCentre) * 1.35);
        #ifdef GRAIN
        c = grain(c);
        #endif
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
}

// --- Shade in the crevices ----------------------------------------------------------------------

/**
 * Ambient shade from the board's depth. The camera is orthographic, so a pixel's place in view
 * space is its screen position scaled by the frustum, and its depth as stored. Each pixel looks at
 * `AO_SAMPLES` neighbours inside `uReach` world units and darkens by how much of them stands above
 * its own surface: the water under a cliff, the ground at the foot of a mountain, the gap between
 * two roofs. Flat land and open sea see nothing above them and stay as painted.
 *
 * The taps turn by a pattern that repeats every four pixels, and aoBlurMaterial averages four by
 * four, which removes the pattern exactly.
 */
export function aoMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    defines: { AO_SAMPLES: 10 },
    uniforms: {
      uDepth: { value: null },
      /** Half the frustum's width and height, then near and far. */
      uFrustum: { value: new THREE.Vector4(1, 1, 1, 4000) },
      /** One texel of the depth buffer. */
      uDepthTexel: { value: new THREE.Vector2(1, 1) },
      uReach: { value: 2.4 },
      uStrength: { value: 0.6 },
    },
    vertexShader: SCREEN_VERTEX,
    fragmentShader: /* glsl */ `
      uniform highp sampler2D uDepth;
      uniform vec4 uFrustum;
      uniform vec2 uDepthTexel;
      uniform float uReach;
      uniform float uStrength;
      varying vec2 vUv;
      vec3 viewAt(vec2 uv) {
        float d = textureLod(uDepth, uv, 0.0).r;
        return vec3((uv * 2.0 - 1.0) * uFrustum.xy, -(uFrustum.z + d * (uFrustum.w - uFrustum.z)));
      }
      void main() {
        vec3 p = viewAt(vUv);
        // The surface's facing, from whichever neighbour on each axis lies on the same surface.
        vec3 east = viewAt(vUv + vec2(uDepthTexel.x, 0.0));
        vec3 west = viewAt(vUv - vec2(uDepthTexel.x, 0.0));
        vec3 north = viewAt(vUv + vec2(0.0, uDepthTexel.y));
        vec3 south = viewAt(vUv - vec2(0.0, uDepthTexel.y));
        vec3 dx = abs(east.z - p.z) < abs(p.z - west.z) ? east - p : p - west;
        vec3 dy = abs(north.z - p.z) < abs(p.z - south.z) ? north - p : p - south;
        vec3 n = normalize(cross(dx, dy));
        vec2 cell = mod(floor(gl_FragCoord.xy), 4.0);
        float spin = (cell.x * 5.0 + cell.y * 3.0) * 0.3927 + cell.x * cell.y * 1.1;
        vec2 reach = uReach / (2.0 * uFrustum.xy);
        float r2 = uReach * uReach;
        float sum = 0.0;
        for (int i = 0; i < AO_SAMPLES; i++) {
          float t = (float(i) + 0.5) / float(AO_SAMPLES);
          float a = spin + float(i) * 2.399963;
          vec3 v = viewAt(vUv + vec2(cos(a), sin(a)) * sqrt(t) * reach) - p;
          float vv = dot(v, v);
          // Nothing past the reach counts, so the land a cliff's height above the sea casts no shade on it.
          float near = max(1.0 - vv / r2, 0.0);
          sum += near * near * max(dot(v, n) - 0.08, 0.0) * inversesqrt(vv + 0.01);
        }
        float shade = clamp(sum * 2.6 / float(AO_SAMPLES), 0.0, 1.0);
        gl_FragColor = vec4(vec3(1.0 - uStrength * shade), 1.0);
      }
    `,
  });
}

/** Averages the shade four texels by four: four reads, each already the mean of four. */
export function aoBlurMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: { uSource: { value: null }, uTexel: { value: new THREE.Vector2(1, 1) } },
    vertexShader: SCREEN_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D uSource;
      uniform vec2 uTexel;
      varying vec2 vUv;
      void main() {
        float a = texture2D(uSource, vUv + uTexel * vec2(-1.0, -1.0)).r;
        a += texture2D(uSource, vUv + uTexel * vec2(1.0, -1.0)).r;
        a += texture2D(uSource, vUv + uTexel * vec2(-1.0, 1.0)).r;
        a += texture2D(uSource, vUv + uTexel * vec2(1.0, 1.0)).r;
        gl_FragColor = vec4(vec3(a * 0.25), 1.0);
      }
    `,
  });
}

// --- Glow ---------------------------------------------------------------------------------------

/**
 * One step down the glow chain: the source at half the size, through a five-point filter. The
 * first step also keeps only what is brighter than `uThreshold`, measured on the brightest
 * channel so a deep orange ember passes as readily as a white glint. The board is painted at or
 * under 1, so nothing on it passes unless a shader made it brighter on purpose.
 */
export function bloomDownMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uSource: { value: null },
      /** One texel of the source. */
      uTexel: { value: new THREE.Vector2(1, 1) },
      /** Negative on every step but the first. */
      uThreshold: { value: -1 },
    },
    vertexShader: SCREEN_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D uSource;
      uniform vec2 uTexel;
      uniform float uThreshold;
      varying vec2 vUv;
      vec3 bright(vec2 uv) {
        vec3 c = texture2D(uSource, uv).rgb;
        if (uThreshold >= 0.0) {
          float peak = max(c.r, max(c.g, c.b));
          c *= max(peak - uThreshold, 0.0) / max(peak, 1e-4);
        }
        return c;
      }
      void main() {
        vec3 c = bright(vUv) * 4.0;
        c += bright(vUv + uTexel);
        c += bright(vUv - uTexel);
        c += bright(vUv + vec2(uTexel.x, -uTexel.y));
        c += bright(vUv + vec2(-uTexel.x, uTexel.y));
        gl_FragColor = vec4(c / 8.0, 1.0);
      }
    `,
  });
}

/** One step back up the chain: the smaller level, spread with a tent, added to this level's own. */
export function bloomUpMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uSource: { value: null },
      uOwn: { value: null },
      /** One texel of the smaller level. */
      uTexel: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: SCREEN_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D uSource;
      uniform sampler2D uOwn;
      uniform vec2 uTexel;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(uSource, vUv + uTexel * vec2(-0.75, -0.75)).rgb;
        c += texture2D(uSource, vUv + uTexel * vec2(0.75, -0.75)).rgb;
        c += texture2D(uSource, vUv + uTexel * vec2(-0.75, 0.75)).rgb;
        c += texture2D(uSource, vUv + uTexel * vec2(0.75, 0.75)).rgb;
        gl_FragColor = vec4(texture2D(uOwn, vUv).rgb + c * 0.25, 1.0);
      }
    `,
  });
}
