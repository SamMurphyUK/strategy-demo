// Shaders of the battle stage. No React. Every material is a ShaderMaterial that writes its colour as it is (see CLAUDE.md): nothing is
// tone mapped or converted, every texture is NoColorSpace, and the ground, the smoke and the sprites are each held under their ceiling
// (0.92, 0.88, and 0.95) so nothing reaches the bloom. None of these clips geometry in a way a shadow must follow: the stage casts no shadow
// map (its shadows are the flat discs and the aircraft's ground shadows below), so no depth material is needed.
import * as THREE from "three";
import type { BattleSkin, BattleTerrain } from "../skins/battleSkin";
import { hexToRgb } from "../skins/battleSkin";
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
}

export function flashUniforms(skin: BattleSkin): FlashUniforms {
  return {
    uFlash: { value: Array.from({ length: FLASH_LIGHTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uFlashColor: { value: v3(skin.grade.muzzleLight) },
  };
}

const FLASH_GLSL = /* glsl */ `
uniform vec4 uFlash[${FLASH_LIGHTS}];
uniform vec3 uFlashColor;
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
      ...flash,
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
      ${FLASH_GLSL}
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
        float n = clamp(0.5 + (photo - 0.5) * 1.15 + (macro - 0.5) * 0.9, 0.0, 1.0);
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
        // Valley mist pooling toward the horizon.
        col = mix(col, uMistColor, uMistAmt * smoothstep(0.3, 1.0, st.y));
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
      uFocus: { value: new THREE.Vector2(0.28, 0.66) },
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
