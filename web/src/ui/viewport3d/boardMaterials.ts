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
}

export function sharedUniforms(): SharedUniforms {
  return {
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

// --- Land ---------------------------------------------------------------------------------------

/** The top of the land: the baked sheet, under the sun. */
export function landTopMaterial(shared: SharedUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...lightUniforms(shared), uBake: shared.uBake, uBounds: shared.uBounds, uBias: { value: 0 } },
    vertexShader: /* glsl */ `
      ${SHEET}
      varying vec2 vUv;
      varying vec2 vScene;
      void main() {
        vUv = sheetUv(vec2(position.x, -position.y));
        vec4 world = modelMatrix * vec4(position, 1.0);
        vScene = world.xy;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE}
      ${LIGHT}
      uniform sampler2D uBake;
      uniform float uBias;
      varying vec2 vUv;
      varying vec2 vScene;
      void main() {
        vec3 c = texture2D(uBake, vUv, uBias).rgb;
        c *= lit(uSunDir.z);
        c *= 1.0 - cloudShade(vScene);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
}

/** The cliff between land and water: strata, darker and wet toward the foot, lit by its facing. */
export function cliffMaterial(shared: SharedUniforms, drop: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...lightUniforms(shared),
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
 */
export function waterMaterial(shared: SharedUniforms, drop: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...lightUniforms(shared),
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
    },
    vertexShader: /* glsl */ `
      varying vec2 vScene;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vScene = world.xy;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE}
      ${LIGHT}
      ${SHEET}
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
      void main() {
        // The map point this piece of water shows, and the same point measured from the cliff's foot.
        vec2 m = vec2(vScene.x, uShift - vScene.y);
        vec2 foot = m - vec2(0.0, uShift);
        vec3 c = texture2D(uBake, sheetUv(m), uBias).rgb;
        vec3 mask = texture2D(uMask, sheetUv(foot)).rgb;
        float shore = clamp(mask.b * 2.0, 0.0, 1.0);
        float edge = mask.g;

        // A slow swell, then drifting dashes on the open sea.
        float swell = fbm(m * 0.05 + vec2(uTime * 0.03, uTime * 0.011));
        c += (swell - 0.5) * 0.05 * uWater;
        float row = floor(m.y / 1.4);
        float rowSeed = hash21(vec2(row, 7.0));
        float along = m.x * 0.55 + uTime * (0.12 + 0.2 * rowSeed) + rowSeed * 40.0;
        float dash = step(0.74, vnoise(vec2(along, row * 1.7))) * step(0.45, rowSeed) * step(fract(m.y / 1.4), 0.22);
        c = mix(c, uWaveTint, dash * 0.24 * uWater * (1.0 - shore));

        // Surf: bands that roll in toward the cliff and break, and a line of foam that laps at its foot.
        float phase = shore * 3.2 - uTime * 0.16 + (vnoise(m * 0.35) - 0.5) * 0.9;
        float crest = smoothstep(0.78, 0.86, fract(phase)) * smoothstep(0.1, 0.5, shore);
        float broken = step(0.35, vnoise(vec2(m.x * 1.3 + uTime * 0.2, m.y * 1.3)));
        float foam = crest * broken * 0.6;
        float lap = 0.05 * sin(uTime * 0.8 + vnoise(m * 0.5) * 6.2832);
        foam = max(foam, smoothstep(0.3 + lap, 0.42 + lap, edge) * (0.55 + 0.45 * vnoise(m * 2.2 + uTime * 0.3)));
        foam = floor(foam * 3.0 + 0.5) / 3.0;
        c = mix(c, uFoam, foam * uWater);

        // The cliff's shadow on the water, and glints where the sun still reaches.
        vec2 toSun = vec2(-uShadowVec.x, uShadowVec.y) * uDrop;
        float shade = max(texture2D(uMask, sheetUv(foot + toSun * 0.5)).g, texture2D(uMask, sheetUv(foot + toSun)).g);
        shade = smoothstep(0.4, 0.6, shade);
        c *= 1.0 - uShadowAlpha * shade;
        float glint = hash21(floor(m * 3.0) + floor(uTime * 2.0) * 13.0);
        c += uSunColor * step(0.9965, glint) * 0.2 * uWater * uDirect * (1.0 - shade);

        c *= lit(uSunDir.z);
        c *= 1.0 - cloudShade(vScene);

        // Past the top and bottom of the sheet the board ends and the table shows.
        float past = max(uBounds.y - m.y, m.y - (uBounds.y + uBounds.w));
        c = mix(c, uNeat, 0.3 * step(-1.1, past) * step(past, -0.7));
        vec3 table = uTable * (0.92 + 0.12 * vnoise(vec2(m.x * 0.12, m.y * 2.4))) * (0.62 + 0.38 * smoothstep(0.0, 6.0, past));
        c = mix(c, table, step(0.0, past));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
}

// --- Props --------------------------------------------------------------------------------------

const PROP_VERTEX = /* glsl */ `
attribute float aPart;
attribute vec3 aFlag;
uniform float uGrow;
// The model point in the board's space: an optional part folds away, and everything rises with uGrow.
vec3 propPoint() {
  vec3 p = position;
  if (aPart > 2.5 && aFlag.x < 0.5) {
    p = vec3(0.0);
  }
  p.xy *= mix(0.35, 1.0, uGrow);
  p.z *= uGrow;
  return (instanceMatrix * vec4(p, 1.0)).xyz;
}
`;

/** Trees, peaks, and buildings. */
export function propMaterial(shared: SharedUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexColors: true,
    uniforms: {
      ...lightUniforms(shared),
      uBake: shared.uBake,
      uBounds: shared.uBounds,
      uGrow: { value: 0 },
      uSnow: { value: new THREE.Vector3(0.88, 0.86, 0.8) },
    },
    vertexShader: /* glsl */ `
      ${NOISE}
      ${LIGHT}
      ${SHEET}
      ${PROP_VERTEX}
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
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        gl_FragColor = vec4(vColor, 1.0);
      }
    `,
  });
}

/** Every shadow shares one stencil bit, so two that overlap darken the ground once. */
function shadowStencil(material: THREE.ShaderMaterial): THREE.ShaderMaterial {
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
export function propShadowMaterial(shared: SharedUniforms): THREE.ShaderMaterial {
  return shadowStencil(
    new THREE.ShaderMaterial({
      uniforms: {
        uGrow: { value: 0 },
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
        uniform sampler2D uMask;
        uniform float uShadowAlpha;
        uniform vec3 uColor;
        varying vec2 vMap;
        void main() {
          if (texture2D(uMask, sheetUv(vMap)).r < 0.5) {
            discard;
          }
          gl_FragColor = vec4(uColor, uShadowAlpha);
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
  return new THREE.ShaderMaterial({
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
        gl_FragColor = vec4(c * lit(uSunDir.z), 0.9);
      }
    `,
  });
}

/**
 * Smoke: square puffs that face the camera, rise, drift, swell, and thin out. Each instance is one
 * puff of a column and loops on its own phase. `aOrigin` is the foot of the column in the board's
 * space, and `aPuff` is phase, kind (0 chimney, 1 battle), ember (0 or 1), and a seed.
 */
export function smokeMaterial(shared: SharedUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
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
        c = mix(c, uEmber, vPuff.z * (1.0 - smoothstep(0.0, 0.2, vAge)));
        // Two tones: the side toward the light is a step paler.
        c *= 0.9 + 0.18 * step(0.0, dot(vAt, vec2(-0.5, 0.85)));
        float alpha = floor(vFade * 4.0 + 0.5) / 4.0;
        gl_FragColor = vec4(c, alpha * mix(0.62, 0.82, vPuff.y));
      }
    `,
  });
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

/**
 * Grades the board and lays the 2D canvases over it. The board loses a little saturation so the
 * pieces stand off it; the canvases go on untouched. The menu's dim covers both.
 */
export function gradeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
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
      vec4 layer(sampler2D map) {
        if (uExact > 0.5) {
          ivec2 at = ivec2(gl_FragCoord.xy + uLayerShift);
          at = clamp(at, ivec2(0), ivec2(uLayerSize) - 1);
          return texelFetch(map, at, 0);
        }
        return texture2D(map, vUv);
      }
      void main() {
        vec3 c = texture2D(uScene, vUv).rgb;
        float grey = dot(c, vec3(0.299, 0.587, 0.114));
        c = mix(vec3(grey), c, uSaturation);
        // Close in, a touch of warmth, the colour of a lamp over a table.
        c *= mix(vec3(1.0), vec3(1.035, 1.0, 0.955), uWarm);
        // The dusk look: thinner colour, harder contrast, a cold cast.
        vec3 dusk = (mix(vec3(grey), c, 0.75) - 0.5) * 1.12 + 0.5;
        c = mix(c, dusk * vec3(0.9, 0.96, 1.07), uDusk);
        // The canvases hold premultiplied colour.
        vec4 o = layer(uLayer0) * uOn.x;
        c = c * (1.0 - o.a) + o.rgb;
        o = layer(uLayer1) * uOn.y;
        c = c * (1.0 - o.a) + o.rgb;
        o = layer(uLayer2) * uOn.z;
        c = c * (1.0 - o.a) + o.rgb;
        c = mix(c, ((c - 0.5) * 0.72 + 0.5) * 0.55, uDim);
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
    },
    vertexShader: SCREEN_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D uSource;
      uniform vec2 uStep;
      uniform float uRadius;
      uniform float uVignette;
      varying vec2 vUv;
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
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
}
