// Shaders of the battle stage. No React. Every material is a ShaderMaterial that writes its colour as it is (see CLAUDE.md): nothing is
// tone mapped or converted, every texture is NoColorSpace, and the ground, the smoke and the sprites are each held under their ceiling
// (0.92, 0.88, and 0.95) so nothing reaches the bloom. None of these clips geometry in a way a shadow must follow: the stage casts no shadow
// map (its shadows are the flat discs and the aircraft's ground shadows below), so no depth material is needed.
import * as THREE from "three";
import type { BattleSkin, BattleTerrain } from "../skins/battleSkin";
import { hexToRgb } from "../skins/battleSkin";
import { WATER_Y_GLSL } from "../skins/waterSwell";
import { STAGE_DEPTH, STAGE_WIDTH } from "./battleLanes";

const v3 = (hex: string) => {
  const c = hexToRgb(hex);
  return new THREE.Vector3(c[0], c[1], c[2]);
};

/** The brief warm point lights of the muzzle bursts: four at most, shared by every material. */
export const FLASH_LIGHTS = 4;

export interface FlashUniforms {
  uFlash: { value: THREE.Vector4[] };
  uFlashColor: { value: THREE.Vector3 };
  /** The sky's light on every lit surface (battleSky.ts): the ambient fill plus the direct light. */
  uLight: { value: THREE.Vector3 };
}

export function flashUniforms(skin: BattleSkin): FlashUniforms {
  return {
    uFlash: { value: Array.from({ length: FLASH_LIGHTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uFlashColor: { value: v3(skin.grade.muzzleLight) },
    uLight: { value: new THREE.Vector3(1, 1, 1) },
  };
}

const FLASH_GLSL = /* glsl */ `
uniform vec4 uFlash[${FLASH_LIGHTS}];
uniform vec3 uFlashColor;
uniform vec3 uLight;
// Warm light from the muzzle bursts: each is a point with a radius of about five units and a quick falloff.
vec3 flashAdd(vec3 p) {
  vec3 a = vec3(0.0);
  for (int i = 0; i < ${FLASH_LIGHTS}; i++) {
    float d = distance(p, uFlash[i].xyz);
    float f = 1.0 - smoothstep(0.0, 5.0, d);
    a += uFlashColor * uFlash[i].w * f * f * 0.5;
  }
  return a;
}
`;

/** The ground's relief, as a shader chunk: lips proud of the field, no man's land sunk between them. Mirrors `reliefHeight` in battleZones.ts. */
const RELIEF_GLSL = /* glsl */ `
uniform vec4 uTrench;
uniform vec2 uRelief;
float reliefAt(vec2 p) {
  float rec = clamp((p.y - uTrench.z) / (uTrench.w - uTrench.z), 0.0, 1.0);
  float halfGap = mix(uTrench.x, uTrench.y, rec);
  float d = abs(p.x) - halfGap;
  float start = smoothstep(uTrench.z, uTrench.z + 3.0, p.y);
  float trough = -uRelief.y * (1.0 - smoothstep(-0.35, -0.05, d));
  float lip = uRelief.x * exp(-(d * d) / 0.12);
  return (trough + lip) * start;
}
`;

const NOISE_GLSL = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  return vnoise(p) * 0.6 + vnoise(p * 2.1 + 7.3) * 0.3 + vnoise(p * 4.3 + 1.7) * 0.1;
}
float lumaOf(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}
// Holds a colour's luminance at or under a ceiling, hue kept.
vec3 clampLuma(vec3 c, float ceiling) {
  float l = lumaOf(c);
  return l > ceiling ? c * (ceiling / l) : c;
}
`;

// --- Ground --------------------------------------------------------------------------------------------------------

export type GroundMaterial = THREE.ShaderMaterial;

/** The campaign board's smooth diorama ground, without the strategic pixel grid: the photographed meadow's luminance moves between two palette tints. */
export function groundMaterial(skin: BattleSkin, terrain: BattleTerrain, flash: FlashUniforms): GroundMaterial {
  const palette = skin.palettes[terrain];
  return new THREE.ShaderMaterial({
    uniforms: {
      uLow: { value: v3(palette.low) },
      uHigh: { value: v3(palette.high) },
      uWorn: { value: v3(palette.worn) },
      uGrass: { value: null },
      uHaveGrass: { value: 0 },
      uMarks: { value: null },
      uCeil: { value: skin.grade.groundLumaCeiling },
      uMistColor: { value: v3(skin.grade.valleyMist) },
      uMistAmt: { value: 0.3 },
      uStage: { value: new THREE.Vector2(STAGE_WIDTH, STAGE_DEPTH) },
      uTrench: { value: new THREE.Vector4(3.2, 1.6, -12, 160) },
      uNml: { value: new THREE.Vector4(0.4, 0.33, 0.33, 0.28) },
      uHaze: { value: new THREE.Vector2(0.45, 0.35) },
      uRelief: { value: new THREE.Vector2(0.16, 0.22) },
      uLightDir: { value: new THREE.Vector3(0, 0.3, 0.9) },
      uShadowAmt: { value: 0.3 },
      ...flash,
    },
    vertexShader: /* glsl */ `
      ${RELIEF_GLSL}
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        w.z += reliefAt(w.xy);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      ${FLASH_GLSL}
      ${RELIEF_GLSL}
      uniform vec3 uLightDir;
      uniform float uShadowAmt;
      uniform vec3 uLow;
      uniform vec3 uHigh;
      uniform vec3 uWorn;
      uniform sampler2D uGrass;
      uniform float uHaveGrass;
      uniform sampler2D uMarks;
      uniform float uCeil;
      uniform vec3 uMistColor;
      uniform float uMistAmt;
      uniform vec2 uStage;
      uniform vec4 uNml;
      uniform vec2 uHaze;
      varying vec3 vWorld;
      void main() {
        vec2 uv = vWorld.xy * 0.16;
        mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
        float macro = fbm(vWorld.xy * 0.21 + 3.0);
        float meso = vnoise(vWorld.xy * 1.3) * 0.5 + vnoise(vWorld.xy * 3.1) * 0.5;
        float photo = meso;
        if (uHaveGrass > 0.5) {
          // The photographed set's luminance against its own average, read at two scales and two turns so no repeat shows.
          float a = texture2D(uGrass, uv).a;
          float b = texture2D(uGrass, turn * uv * 0.37 + vec2(0.37, 0.71)).a;
          photo = mix(a, b, 0.35 + 0.3 * vnoise(uv * 0.55));
        }
        float n = clamp(0.5 + (photo - 0.5) * 1.7 + (macro - 0.5) * 0.9, 0.0, 1.0);
        vec3 col = mix(uLow, uHigh, n);
        vec2 st = vWorld.xy / uStage + 0.5;
        // Worn earth between the lines, and along the very edge of the slice.
        float lane = smoothstep(0.26, 0.0, abs(vWorld.x) * 0.1) * smoothstep(0.55, 0.15, abs(st.y - 0.3) * 1.6);
        col = mix(col, uWorn, lane * (0.25 + 0.5 * vnoise(vWorld.xy * 0.9)));
        // The persistent marks: red is scorch, green is crater.
        vec3 marks = texture2D(uMarks, st).rgb;
        col = mix(col, col * vec3(0.34, 0.31, 0.3), clamp(marks.r, 0.0, 1.0) * 0.85);
        float rim = clamp(marks.g * 2.0 - 1.0, 0.0, 1.0);
        col = mix(col, uWorn * 0.5, clamp(marks.g, 0.0, 1.0) * 0.8);
        col = mix(col, min(col * 1.35 + 0.03, vec3(0.9)), rim * 0.4);
        // No man's land between the trench lines: darker, drawn toward its own tint.
        float rec = clamp((vWorld.y - uTrench.z) / (uTrench.w - uTrench.z), 0.0, 1.0);
        float halfGap = mix(uTrench.x, uTrench.y, rec);
        float inNml = 1.0 - smoothstep(halfGap - 0.35, halfGap + 0.35, abs(vWorld.x));
        col = mix(col, uNml.rgb, inNml * 0.45);
        col *= 1.0 - uNml.a * inNml;
        // Haze toward the horizon: the colour drawn out, then the mist laid over.
        float haze = clamp(pow(rec, 0.7) * (0.15 + uHaze.x * 1.2), 0.0, 0.92);
        col = mix(col, vec3(lumaOf(col)), haze * uHaze.y);
        col = mix(col, uMistColor, haze);
        // The relief: the lips catch the directional light, and each throws a crisp shadow into the trough on the side away from the sun.
        vec2 rp = vWorld.xy;
        float e = 0.05;
        vec3 rn = normalize(vec3(-(reliefAt(rp + vec2(e, 0.0)) - reliefAt(rp - vec2(e, 0.0))) / (2.0 * e), -(reliefAt(rp + vec2(0.0, e)) - reliefAt(rp - vec2(0.0, e))) / (2.0 * e), 1.0));
        vec3 L = normalize(uLightDir);
        float slope = clamp(dot(rn, L), 0.0, 1.0) - clamp(L.z, 0.0, 1.0);
        col *= 1.0 + slope * 0.9;
        float h0 = reliefAt(rp);
        vec2 dxy = L.xy / max(length(L.xy), 0.001);
        float rise = L.z / max(length(L.xy), 0.05);
        float lit = 1.0;
        for (int i = 1; i <= 10; i++) {
          float s = float(i) * 0.07;
          if (reliefAt(rp + dxy * s) > h0 + s * rise + 0.004) {
            lit = 0.0;
          }
        }
        col *= mix(1.0 - uShadowAmt * 1.6, 1.0, lit);
        col *= uLight;
        col += flashAdd(vec3(vWorld.xy, 0.5));
        gl_FragColor = vec4(clampLuma(col, uCeil), 1.0);
      }
    `,
  });
}

// --- Rim -----------------------------------------------------------------------------------------------------------

/** The 20mm slice's rim: smoked walnut and slate on the sides, loam strata along the front lip, edge-lit on the bevel. */
export function rimMaterial(skin: BattleSkin): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uWalnut: { value: v3(skin.rim.color) },
      uSlate: { value: v3(skin.rim.slate) },
      uStrata: { value: skin.rim.strata.map(v3) },
      uThickness: { value: skin.rim.thickness },
      uSunDir: { value: new THREE.Vector3(...skin.grade.sunDir).normalize() },
      uSunColor: { value: v3(skin.grade.sunColor) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vN;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform vec3 uWalnut;
      uniform vec3 uSlate;
      uniform vec3 uStrata[5];
      uniform float uThickness;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      varying vec3 vWorld;
      varying vec3 vN;
      void main() {
        vec3 n = normalize(vN);
        float depthIn = clamp(-vWorld.z / uThickness, 0.0, 1.0);
        // Walnut grain along the sides: dark streaks over a slate undertone.
        float grain = vnoise(vec2(vWorld.x * 2.0 + vWorld.y * 2.0, vWorld.z * 38.0));
        vec3 col = mix(uWalnut, uSlate, 0.25 * grain + 0.1 * smoothstep(0.0, 1.0, depthIn));
        // The front lip: strata of loam, wavy, with flecks of stone.
        float front = step(0.55, -n.y);
        float wave = vnoise(vec2(vWorld.x * 0.9, 1.7)) * 0.18 + vnoise(vec2(vWorld.x * 3.3, 5.1)) * 0.05;
        float band = clamp(depthIn + wave - 0.09, 0.0, 0.999) * 5.0;
        int idx = int(floor(band));
        vec3 strata = uStrata[0];
        if (idx == 1) strata = uStrata[1];
        if (idx == 2) strata = uStrata[2];
        if (idx == 3) strata = uStrata[3];
        if (idx >= 4) strata = uStrata[4];
        float fleck = step(0.93, hash21(floor(vec2(vWorld.x * 14.0, vWorld.z * 22.0))));
        strata = mix(strata, uSlate * 1.5, fleck * 0.6);
        col = mix(col, strata, front * smoothstep(0.0, 0.08, depthIn + 0.02));
        // The top bevel (the face tilted toward the sky) is edge-lit.
        float lit = clamp(dot(n, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
        col *= 0.62 + 0.5 * lit;
        float bevel = smoothstep(0.2, 0.9, n.z) * (1.0 - step(0.98, n.z));
        col += uSunColor * bevel * 0.16;
        gl_FragColor = vec4(min(col, vec3(0.95)), 1.0);
      }
    `,
  });
}

// --- Standees ------------------------------------------------------------------------------------------------------

export interface SpriteUniforms extends FlashUniforms {
  uMap: { value: THREE.Texture | null };
  uDesat: { value: number };
  uMist: { value: THREE.Vector4 };
  uFade: { value: number };
  uHot: { value: number };
}

export interface SpriteMaterial extends THREE.ShaderMaterial {
  uniforms: SpriteUniforms & Record<string, THREE.IUniform>;
}

/**
 * A standee: the sprite's own pixels, desaturated and tinted with valley mist by its lane, dithered out as it fades, with the warm light
 * of nearby muzzle bursts. Held at 0.95 so it never reaches the bloom. `uHot` whitens a unit for the frame it is hit.
 */
export function spriteMaterial(flash: FlashUniforms, texture: THREE.Texture | null, mist: THREE.Vector3): SpriteMaterial {
  return new THREE.ShaderMaterial({
    transparent: false,
    side: THREE.DoubleSide,
    uniforms: {
      uMap: { value: texture },
      uDesat: { value: 0 },
      uMist: { value: new THREE.Vector4(mist.x, mist.y, mist.z, 0) },
      uFade: { value: 1 },
      uHot: { value: 0 },
      ...flash,
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${FLASH_GLSL}
      uniform sampler2D uMap;
      uniform float uDesat;
      uniform vec4 uMist;
      uniform float uFade;
      uniform float uHot;
      varying vec2 vUv;
      varying vec3 vWorld;
      float bayer(vec2 p) {
        p = mod(floor(p), 4.0);
        return (mod(p.x * 5.0 + p.y * 3.0, 16.0) + 0.5) / 16.0;
      }
      void main() {
        vec4 t = texture2D(uMap, vUv);
        if (t.a < 0.5 || uFade < bayer(gl_FragCoord.xy)) {
          discard;
        }
        vec3 c = t.rgb;
        float l = dot(c, vec3(0.299, 0.587, 0.114));
        c = mix(c, vec3(l), uDesat);
        c = mix(c, uMist.rgb, uMist.a);
        c *= uLight;
        c += flashAdd(vWorld + vec3(0.0, 0.0, 0.4));
        c = mix(c, vec3(0.95, 0.9, 0.78), uHot * 0.55);
        gl_FragColor = vec4(min(c, vec3(0.95)), 1.0);
      }
    `,
  }) as SpriteMaterial;
}

// --- Shadows, smoke and bursts -------------------------------------------------------------------------------------

/** A soft contact-shadow disc, flat on the ground: dark at the middle and clear at the edge. */
export function discShadowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uOpacity: { value: 0.5 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.25, 1.0, d)) * uOpacity;
        if (a < 0.01) {
          discard;
        }
        gl_FragColor = vec4(0.1, 0.08, 0.07, a);
      }
    `,
  });
}

/** Smoke: pooled soft billboards, each with its own colour and opacity. The colour is held under the smoke ceiling by the stage. */
export function smokeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      varying vec2 vUv;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        vUv = uv;
        vAlpha = aAlpha;
        #ifdef USE_INSTANCING_COLOR
        vColor = instanceColor;
        #else
        vColor = vec3(0.4);
        #endif
        // A billboard: the quad's corners are pushed along the camera's right and up.
        vec3 centre = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float size = length(instanceMatrix[0].xyz);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 world = centre + (right * position.x + up * position.y) * size;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform float uTime;
      varying vec2 vUv;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        vec2 p = vUv - 0.5;
        float d = length(p) * 2.0;
        float n = vnoise(vUv * 5.0 + vAlpha * 7.0 + uTime * 0.05);
        float a = smoothstep(1.0, 0.15, d + (n - 0.5) * 0.55) * vAlpha;
        if (a < 0.01) {
          discard;
        }
        // The shade across a puff: lighter on top.
        vec3 c = vColor * (0.82 + 0.3 * (p.y + 0.5));
        gl_FragColor = vec4(c, a);
      }
    `,
  });
}

/** A pixel muzzle burst: a blocky four-frame star, 0 the flash and 3 the last wisp. Crisp, the cells never blend. */
export function burstMaterial(skin: BattleSkin): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uFrame: { value: 0 },
      uCore: { value: v3("#DDCF99") },
      uEdge: { value: v3(skin.grade.muzzleLight) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFrame;
      uniform vec3 uCore;
      uniform vec3 uEdge;
      varying vec2 vUv;
      void main() {
        // An 11 by 11 grid of whole cells.
        vec2 cell = (floor(vUv * 11.0) + 0.5) / 11.0 - 0.5;
        vec2 q = abs(cell) * 2.0;
        float r = 1.0 - uFrame * 0.2;
        float star = step(q.x + q.y, r * 0.85) + step(min(q.x, q.y), 0.1) * step(max(q.x, q.y), r);
        float core = step(q.x + q.y, r * 0.38);
        if (star < 0.5 || uFrame > 3.5) {
          discard;
        }
        gl_FragColor = vec4(mix(uEdge, uCore, core), 1.0);
      }
    `,
  });
}

// --- The lens ------------------------------------------------------------------------------------------------------

/**
 * The tilt-shift: the picture blurred toward the top (the horizon) and the bottom (the foreground lip), sharp across the middle where the lines
 * stand. `uBlur` is battleTiltShift; at 0 it is a plain copy. Everything is read and written raw, in NoColorSpace.
 */
export function tiltShiftMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tDiffuse: { value: null },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uBlur: { value: 0.8 },
      uFocus: { value: new THREE.Vector2(0.1, 0.78) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec2 uTexel;
      uniform float uBlur;
      uniform vec2 uFocus;
      varying vec2 vUv;
      void main() {
        // How far outside the sharp band this row is, 0 to 1: the lip below it and the horizon above.
        float below = smoothstep(uFocus.x, 0.0, vUv.y);
        float above = smoothstep(uFocus.y, 1.0, vUv.y);
        float amount = max(below * 1.0, above * 0.85) * uBlur;
        vec3 sum = texture2D(tDiffuse, vUv).rgb;
        float wsum = 1.0;
        float radius = amount * 9.0;
        if (radius > 0.3) {
          // A golden-angle disc of twelve taps.
          for (int i = 1; i <= 12; i++) {
            float fi = float(i);
            float a = fi * 2.39996;
            float r = sqrt(fi / 12.0) * radius;
            vec2 o = vec2(cos(a), sin(a)) * r * uTexel;
            sum += texture2D(tDiffuse, vUv + o).rgb;
            wsum += 1.0;
          }
        }
        gl_FragColor = vec4(sum / wsum, 1.0);
      }
    `,
  });
}

// --- Sea strip -----------------------------------------------------------------------------------------------------

/** The sea along the front lip of a coastal battle: two palette blues in slow bands, a foam line where it meets the shore. Held under 0.92. */
export function seaMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uDeep: { value: v3("#4E5463") }, uShallow: { value: v3("#5B7D73") }, uFoam: { value: v3("#DDCF99") } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uFoam;
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        float band = vnoise(vec2(vWorld.x * 0.8 + uTime * 0.25, vWorld.y * 3.0));
        float steps = floor(band * 3.0) / 3.0;
        vec3 c = mix(uDeep, uShallow, clamp(vUv.y * 1.2 + steps * 0.5, 0.0, 1.0));
        float edge = smoothstep(0.82, 0.96, vUv.y + (vnoise(vec2(vWorld.x * 2.0 - uTime * 0.4, 1.0)) - 0.5) * 0.1);
        c = mix(c, uFoam, edge * 0.85);
        gl_FragColor = vec4(clampLuma(c, 0.92), 1.0);
      }
    `,
  });
}

// --- Backdrop, bands and links -------------------------------------------------------------------------------------

/**
 * The painted backdrop behind the slice: a sky gradient from the campaign's light, a sun (or moon and stars) placed by its direction, slow
 * drifting cloud layers, and a tree-line silhouette on the horizon. It stands upright behind the table, so a camera that looks down at 35 degrees
 * still sees it. Colours are held under 0.95.
 */
export function backdropMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    depthWrite: false,
    uniforms: {
      uZenith: { value: new THREE.Vector3() },
      uHorizon: { value: new THREE.Vector3() },
      uTree: { value: new THREE.Vector3() },
      uCloud: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(0, 0, 1) },
      uSunColor: { value: new THREE.Vector3(1, 1, 1) },
      uNight: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uTree;
      uniform vec3 uCloud;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform float uNight;
      uniform float uTime;
      varying vec3 vWorld;
      void main() {
        float h = clamp((vWorld.z + 1.0) / 26.0, 0.0, 1.0);
        vec3 c = mix(uHorizon, uZenith, smoothstep(0.0, 0.8, h));
        // The light's place on the painted sky: across by its east-west lean, up by its elevation.
        vec2 sunAt = vec2(uSunDir.x * 38.0, 2.0 + uSunDir.z * 22.0);
        float sd = distance(vec2(vWorld.x, vWorld.z), sunAt);
        float disc = 1.0 - smoothstep(uNight > 0.5 ? 1.4 : 1.1, uNight > 0.5 ? 1.7 : 1.5, sd);
        float glow = exp(-sd * 0.12) * 0.28;
        c += uSunColor * (glow + disc * 0.75);
        // Stars at night.
        vec2 sc = floor(vec2(vWorld.x, vWorld.z) * 2.4);
        float star = step(0.992, hash21(sc * 1.7 + 3.0)) * uNight * smoothstep(0.15, 0.5, h);
        c += vec3(0.8, 0.85, 0.95) * star * 0.8;
        // Two drifting layers of cloud.
        vec2 p1 = vec2(vWorld.x * 0.05 + uTime * 0.012, vWorld.z * 0.1);
        vec2 p2 = vec2(vWorld.x * 0.11 - uTime * 0.02 + 5.0, vWorld.z * 0.2 + 2.0);
        float n1 = smoothstep(0.52, 0.8, fbm(p1 * 2.0)) * smoothstep(0.1, 0.35, h) * (1.0 - smoothstep(0.7, 1.0, h));
        float n2 = smoothstep(0.55, 0.85, fbm(p2 * 2.0)) * smoothstep(0.05, 0.25, h) * 0.7;
        float shade = 0.82 + 0.18 * fbm(p1 * 5.0 + 9.0);
        c = mix(c, uCloud * shade, clamp(n1 * 0.75 + n2 * 0.5, 0.0, 0.85));
        // The tree line.
        float ridge = 0.012 + 0.03 * vnoise(vec2(vWorld.x * 0.9, 1.0)) + 0.02 * vnoise(vec2(vWorld.x * 3.1, 4.0));
        float tree = 1.0 - smoothstep(ridge - 0.004, ridge, h);
        c = mix(c, uTree, tree);
        gl_FragColor = vec4(min(c, vec3(0.95)), 1.0);
      }
    `,
  });
}

/** A rank's band across the ground: faint at rest, brightening in a pulse while its salvo runs. */
export function bandMaterial(color: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uColor: { value: v3(color) }, uAlpha: { value: 0.07 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uAlpha;
      varying vec2 vUv;
      void main() {
        float edge = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x);
        float line = 1.0 - smoothstep(0.0, 0.03, min(vUv.x, 1.0 - vUv.x));
        float a = uAlpha * edge + line * uAlpha * 1.6 * step(0.5, fract(vUv.y * 22.0));
        gl_FragColor = vec4(uColor, min(a, 0.6));
      }
    `,
  });
}

/** The dashed brass link on the ground between a paired artillery piece and its infantry. */
export function linkMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uColor: { value: v3("#AAA25D") }, uLength: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uLength;
      varying vec2 vUv;
      void main() {
        if (fract(vUv.x * uLength * 5.0) > 0.55) {
          discard;
        }
        gl_FragColor = vec4(uColor, 0.9);
      }
    `,
  });
}

// --- Horizon, sea and trenches (the old 2D battle's framework) ------------------------------------------------------

/**
 * The far backdrop: three sky stops (horizon, middle, top) from the hour, a small vector sun with a banded halo that is darkest at its rim,
 * a crescent moon in a clear circular glow, twinkling stars, flat drifting cloud shapes, and a flat tree-line and town silhouette along the
 * horizon, hazed and drawn out of colour, in palette tones. It stands upright at the horizon; the camera's low pitch puts it in the top sixth.
 */
export function horizonBackdropMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    depthWrite: false,
    uniforms: {
      uLow: { value: new THREE.Vector3() },
      uMid: { value: new THREE.Vector3() },
      uHigh: { value: new THREE.Vector3() },
      uSunPos: { value: new THREE.Vector3(0, 0, 0) },
      uSunLook: { value: new THREE.Vector4(3, 3.6, 0, 0) },
      uHalo0: { value: new THREE.Vector3() },
      uHalo1: { value: new THREE.Vector3() },
      uHalo2: { value: new THREE.Vector3() },
      uHaloRim: { value: new THREE.Vector3() },
      uSunColor: { value: new THREE.Vector3(1, 1, 1) },
      uMoonPos: { value: new THREE.Vector3() },
      uMoonLook: { value: new THREE.Vector4(2.6, 3.2, 0, 0) },
      uMoonColor: { value: new THREE.Vector3() },
      uMoonGlow: { value: new THREE.Vector3() },
      uStars: { value: new THREE.Vector4(0, 0.5, 0.55, 0) },
      uCloud: { value: new THREE.Vector4(0.45, 0.012, 1, 0) },
      uCloudColor: { value: new THREE.Vector3(1, 1, 1) },
      uBand: { value: new THREE.Vector4(12, 0.3, 0.45, 0.35) },
      uTree: { value: new THREE.Vector3() },
      uTown: { value: new THREE.Vector3() },
      uMist: { value: new THREE.Vector3() },
      uLight: { value: new THREE.Vector3(1, 1, 1) },
      uSkyTop: { value: 30 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform vec3 uLow; uniform vec3 uMid; uniform vec3 uHigh;
      uniform vec3 uSunPos; uniform vec4 uSunLook;
      uniform vec3 uHalo0; uniform vec3 uHalo1; uniform vec3 uHalo2; uniform vec3 uHaloRim; uniform vec3 uSunColor;
      uniform vec3 uMoonPos; uniform vec4 uMoonLook; uniform vec3 uMoonColor; uniform vec3 uMoonGlow;
      uniform vec4 uStars; uniform vec4 uCloud; uniform vec3 uCloudColor;
      uniform vec4 uBand; uniform vec3 uTree; uniform vec3 uTown; uniform vec3 uMist;
      uniform vec3 uLight; uniform float uSkyTop; uniform float uTime;
      varying vec3 vWorld;
      float disc(vec2 p, vec2 c, float r) { return 1.0 - smoothstep(r - 0.12, r + 0.12, distance(p, c)); }
      void main() {
        vec2 p = vec2(vWorld.x, vWorld.z);
        float base = uBand.x * 0.55;
        float h = clamp((p.y - base) / (uSkyTop - base), 0.0, 1.0);
        // Three blended hues, darker and bluer toward the top.
        vec3 c = mix(uLow, uMid, smoothstep(0.0, 0.55, h));
        c = mix(c, uHigh, smoothstep(0.4, 1.0, h));
        // Stars: cells with a hashed twinkle, in only while uStars.x (the night's fade) is up.
        vec2 sc = floor(p * 0.9);
        float sh = hash21(sc * 1.37 + 3.1);
        float tw = 0.65 + 0.35 * sin(uTime * (1.2 + sh * 2.0) + sh * 40.0 * 6.28318) * uStars.y;
        float starDot = 1.0 - smoothstep(0.05, 0.13, distance(fract(p * 0.9), vec2(0.5)));
        float star = step(1.0 - uStars.z * 0.05, sh) * tw * uStars.x * smoothstep(0.1, 0.45, h) * starDot;
        c += vec3(0.85, 0.88, 1.0) * star * 0.8;
        // The sun: a small flat disc, and a halo in three bands, dark at its very rim, brightening inward with the light.
        float sd = distance(p, uSunPos.xy);
        float sr = uSunLook.x;
        float hr = sr * uSunLook.y;
        float inHalo = 1.0 - step(hr, sd);
        float t = clamp((sd - sr) / max(hr - sr, 0.001), 0.0, 1.0);
        vec3 halo = t < 0.34 ? uHalo2 : (t < 0.67 ? uHalo1 : uHalo0);
        halo = mix(halo, uHaloRim, smoothstep(0.88, 1.0, t));
        c = mix(c, c + halo * 0.55, inHalo * (1.0 - smoothstep(0.0, 1.0, t) * 0.55) * uSunPos.z);
        c = mix(c, uSunColor, disc(p, uSunPos.xy, sr) * uSunPos.z);
        // The moon: a soft crescent inside a clear circular glow.
        float mr = uMoonLook.x;
        float md = distance(p, uMoonPos.xy);
        float glow = 1.0 - smoothstep(mr * 0.9, mr * uMoonLook.y, md);
        c = mix(c, uMoonGlow, glow * 0.35 * uMoonPos.z);
        float crescent = disc(p, uMoonPos.xy, mr) * (1.0 - disc(p, uMoonPos.xy + vec2(mr * 0.55, mr * 0.1), mr * 0.92));
        c = mix(c, uMoonColor, crescent * uMoonPos.z);
        // Flat vector clouds, drifting: pale blobs with a flat underside, a few to a cell.
        vec2 q = p * 0.045 - vec2(uCloud.z, uCloud.w) * uCloud.y * uTime * 6.0;
        vec2 cell = floor(q);
        vec2 f = fract(q);
        float seed = hash21(cell + 7.7);
        float show = step(1.0 - uCloud.x, seed);
        vec2 cc = vec2(0.5 + (hash21(cell + 1.3) - 0.5) * 0.4, 0.5);
        float body = disc(f * vec2(1.0, 1.9), cc * vec2(1.0, 1.9), 0.32 + 0.1 * hash21(cell + 2.2));
        float body2 = disc(f * vec2(1.0, 1.9), (cc + vec2(0.24, -0.04)) * vec2(1.0, 1.9), 0.24);
        float body3 = disc(f * vec2(1.0, 1.9), (cc - vec2(0.22, 0.02)) * vec2(1.0, 1.9), 0.22);
        float cloud = max(body, max(body2, body3)) * step(0.34, f.y) * show;
        cloud *= smoothstep(0.12, 0.3, h);
        c = mix(c, uCloudColor * uLight, clamp(cloud, 0.0, 1.0) * 0.85);
        // The far band along the horizon: a tree line and a town, flat, hazed, drawn out of colour.
        float x = vWorld.x;
        float pines = abs(fract(x * 0.55) - 0.5) * 2.0;
        float trees = uBand.x * (0.28 + 0.2 * vnoise(vec2(x * 0.17, 2.0))) * (0.62 + 0.38 * (1.0 - pines));
        float bx = floor(x / 6.0);
        float bh = hash21(vec2(bx, 9.0));
        float building = (step(1.0 - uBand.y, bh) * uBand.x * (0.38 + 0.4 * hash21(vec2(bx, 3.0)))) * step(0.12, fract(x / 6.0)) * step(fract(x / 6.0), 0.9);
        float spire = step(0.9, bh) * uBand.x * 0.78 * (1.0 - smoothstep(0.0, 0.07, abs(fract(x / 6.0) - 0.5)));
        float top = max(trees, max(building, spire));
        float inBand = 1.0 - step(top, p.y);
        float isTown = step(trees + 0.01, max(building, spire));
        vec3 band = mix(uTree, uTown, isTown);
        // Haze: more over the foot of the band, and the colour drawn toward grey and then toward the mist.
        float foot = 1.0 - smoothstep(0.0, uBand.x * 0.75, p.y);
        float mistAmt = clamp(uBand.z * (0.5 + foot * 0.9), 0.0, 0.92);
        band = mix(band, vec3(lumaOf(band)), uBand.w);
        band = mix(band, uMist, mistAmt);
        c = mix(c, band * uLight, inBand);
        gl_FragColor = vec4(min(c, vec3(0.95)), 1.0);
      }
    `,
  });
}

/** One trench line: a real sculpted parapet of sandbags, near unbroken, fading into the haze as it recedes. */
export function trenchMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uBagLight: { value: new THREE.Vector3() },
      uBagDark: { value: new THREE.Vector3() },
      uMist: { value: new THREE.Vector3() },
      uFar: { value: new THREE.Vector4(-12, 160, 0.45, 0) },
      uLight: { value: new THREE.Vector3(1, 1, 1) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec2 vUv;
      varying float vTop;
      attribute float aTop;
      void main() {
        vUv = uv;
        vTop = aTop;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform vec3 uBagLight; uniform vec3 uBagDark; uniform vec3 uMist; uniform vec4 uFar; uniform vec3 uLight;
      varying vec3 vWorld; varying vec2 vUv; varying float vTop;
      void main() {
        float rec = clamp((vWorld.y - uFar.x) / (uFar.y - uFar.x), 0.0, 1.0);
        // Rows of bags along the line, each staggered, the colour wandering between the light and the dark tan.
        float row = floor(vUv.x * 3.0 + vTop * 1.0);
        float along = vWorld.y / 0.62 + row * 0.5;
        vec2 id = vec2(floor(along), row);
        float j = hash21(id + 4.1);
        vec3 bag = mix(uBagDark, uBagLight, 0.35 + 0.5 * j);
        float seam = smoothstep(0.0, 0.12, fract(along)) * smoothstep(1.0, 0.88, fract(along));
        bag *= 0.78 + 0.22 * seam;
        // The crest catches the light, the foot sits in shade.
        bag *= 0.8 + 0.3 * vTop;
        // Far away the individual bags are not told apart: the line fades to its own mean tone, then into the haze, but stays unbroken.
        vec3 mean = mix(uBagDark, uBagLight, 0.5) * 0.9;
        bag = mix(bag, mean, smoothstep(0.05, 0.5, rec));
        bag = mix(bag, uMist, clamp(rec * rec * (0.25 + uFar.z * 1.1), 0.0, 0.9));
        gl_FragColor = vec4(min(bag * uLight, vec3(0.92)), 1.0);
      }
    `,
  });
}

/** The sea strip: three blended bands (coast, mid, deep), the campaign's swell lifting and dropping it, crests that catch the light, and a swash. */
export function shoreSeaMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSwell: { value: new THREE.Vector4(0.1, 20, 1, 0) },
      uFrontAt: { value: 0 },
      uCoast: { value: new THREE.Vector3() },
      uMid: { value: new THREE.Vector3() },
      uDeep: { value: new THREE.Vector3() },
      uTint: { value: new THREE.Vector3(1, 1, 1) },
      uGlint: { value: new THREE.Vector3(1, 1, 1) },
      uSwash: { value: 0.6 },
    },
    vertexShader: /* glsl */ `
      ${WATER_Y_GLSL}
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vH;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vH = waterY(w.xy, uTime);
        w.z += vH;
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform float uTime; uniform vec3 uCoast; uniform vec3 uMid; uniform vec3 uDeep; uniform vec3 uTint; uniform vec3 uGlint; uniform float uSwash;
      varying vec2 vUv; varying vec3 vWorld; varying float vH;
      void main() {
        // 0 at the coast, 1 at the bottom edge.
        float t = clamp(1.0 - vUv.y, 0.0, 1.0);
        vec3 c = mix(mix(uCoast, uMid, smoothstep(0.1, 0.5, t)), uDeep, smoothstep(0.5, 0.95, t));
        // Crests sliding left and right, catching the light.
        float crest = sin(vWorld.x * 1.1 - uTime * 1.3 + t * 11.0 + vH * 14.0);
        float row = smoothstep(0.86, 0.97, crest) * (0.35 + 0.65 * (1.0 - t * 0.5));
        c = mix(c, uGlint, row * 0.55);
        // The swash: the water breaks onto the beach in a foam line that comes and goes.
        float sw = uSwash * (0.55 * (0.5 + 0.5 * sin(uTime * 0.9 - vWorld.x * 0.35)) + 0.45 * (0.5 + 0.5 * sin(uTime * 0.37 + vWorld.x * 0.11)));
        float edge = 0.05 + 0.05 * sw;
        float foam = smoothstep(edge + 0.05, edge, t) * (0.6 + 0.4 * vnoise(vec2(vWorld.x * 2.5, uTime * 0.7)));
        c = mix(c, vec3(0.93, 0.92, 0.84), foam * 0.85);
        gl_FragColor = vec4(min(c * uTint, vec3(0.92)), 1.0);
      }
    `,
  });
}

/** The beach: a gentle sandy slope from the waterline up into the land, wet where the swash has just been. Never a cliff. */
export function beachMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSand: { value: new THREE.Vector3() },
      uLand: { value: new THREE.Vector3() },
      uLight: { value: new THREE.Vector3(1, 1, 1) },
      uSwash: { value: 0.6 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform float uTime; uniform vec3 uSand; uniform vec3 uLand; uniform vec3 uLight; uniform float uSwash;
      varying vec2 vUv; varying vec3 vWorld;
      void main() {
        float s = vUv.y;
        float sw = uSwash * (0.55 * (0.5 + 0.5 * sin(uTime * 0.9 - vWorld.x * 0.35)) + 0.45 * (0.5 + 0.5 * sin(uTime * 0.37 + vWorld.x * 0.11)));
        vec3 sand = uSand * (0.9 + 0.12 * vnoise(vWorld.xy * 3.0) + 0.1 * s);
        float wet = 1.0 - smoothstep(sw * 0.7, sw * 0.7 + 0.18, s);
        sand = mix(sand, sand * vec3(0.62, 0.58, 0.55), wet);
        float foamLine = (1.0 - smoothstep(0.0, 0.05, abs(s - sw * 0.7))) * 0.6;
        sand = mix(sand, vec3(0.93, 0.92, 0.84), foamLine);
        // The top of the beach blends into the land.
        sand = mix(sand, uLand, smoothstep(0.78, 1.0, s) * (0.6 + 0.4 * vnoise(vWorld.xy * 2.0)));
        gl_FragColor = vec4(min(sand * uLight, vec3(0.92)), 1.0);
      }
    `,
  });
}
