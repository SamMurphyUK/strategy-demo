// Shaders for the Shogun board. No React.
//
// Colours are sRGB numbers used as they are: sheets are read raw and nothing is converted on the
// way out, so a hex in this file is the colour on screen. Every material here is unlit by Three.js
// and skips tone mapping; the light is the multiplier in `lit`, and it is strongest close in.
//
// Everything a slider can change is a uniform on one of these materials. The frame loop writes
// them (see MapViewportShogun.tsx), so no setting rebuilds a material, a sheet, or a mesh.
import * as THREE from "three";
import { SUN_FRAGMENT, SUN_VERTEX } from "../boardMaterials";

export function rgbOf(hex: string): THREE.Vector3 {
  return new THREE.Vector3(
    Number.parseInt(hex.slice(1, 3), 16) / 255,
    Number.parseInt(hex.slice(3, 5), 16) / 255,
    Number.parseInt(hex.slice(5, 7), 16) / 255,
  );
}

/** The board's own inks and waters. */
export const SHOGUN = {
  ink: "#3B3236",
  sand: "#CDBE9C",
  seaDeep: "#5E7682",
  seaShelf: "#93AAA6",
  foam: "#E6E3D3",
  beyond: "#3A3638",
  seam: "#DCE6E4",
  frontBand: "#9C524E",
  frontDash: "#B97A60",
  rockHigh: "#A08F78",
  rockLow: "#6E6259",
  rockWet: "#52484A",
  rockLip: "#B9A886",
  shadow: "#2A2428",
  craterRim: "#645355",
  craterPit: "#4B3D44",
  soot: "#6B6266",
  ash: "#9A928F",
  steam: "#D2CCBE",
  ember: "#B97A60",
  markerRim: "#2E272B",
} as const;

/** Watercolour pigments, by what the mark means. */
export const PIGMENT = {
  select: "#F2E8CC",
  move: "#E4BC5E",
  attack: "#A43C3C",
  hover: "#EDE4CC",
} as const;

/** Uniforms every board material reads. One object each, shared by reference. */
export interface ShogunUniforms {
  uTime: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Vector3 };
  uAmbient: { value: THREE.Vector3 };
  uDirect: { value: number };
  uRelief: { value: number };
  /** Ground offset of a shadow for each unit of height, in scene x and y. */
  uShadowVec: { value: THREE.Vector2 };
  uShadowAlpha: { value: number };
  /** The sheet: x, y, width, height in world units. */
  uBounds: { value: THREE.Vector4 };
  uTerrain: { value: THREE.Texture | null };
  uFaction: { value: THREE.Texture | null };
  uLines: { value: THREE.Texture | null };
  uFront: { value: THREE.Texture | null };
  uEdge: { value: THREE.Texture | null };
  uMask: { value: THREE.Texture | null };
  /** Share of the faction colour over the ground. */
  uFactionAlpha: { value: number };
  /** The sun's shadow map and what reads it (see SUN_FRAGMENT in ../boardMaterials.ts). */
  uSunMap: { value: THREE.Texture | null };
  uSunMatrix: { value: THREE.Matrix4 };
  uSunTexel: { value: THREE.Vector4 };
  uSunTint: { value: THREE.Vector3 };
}

export function shogunUniforms(): ShogunUniforms {
  return {
    uSunMap: { value: null },
    uSunMatrix: { value: new THREE.Matrix4() },
    uSunTexel: { value: new THREE.Vector4(1 / 2048, 1 / 2048, 0.0005, 0.3) },
    uSunTint: { value: new THREE.Vector3(1, 1, 1) },
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.3, 0.4, 0.86) },
    uSunColor: { value: new THREE.Vector3(1, 1, 1) },
    uAmbient: { value: new THREE.Vector3(0.8, 0.84, 0.9) },
    uDirect: { value: 1 },
    uRelief: { value: 0 },
    uShadowVec: { value: new THREE.Vector2(0, 0) },
    uShadowAlpha: { value: 0 },
    uBounds: { value: new THREE.Vector4(0, 0, 800, 504) },
    uTerrain: { value: null },
    uFaction: { value: null },
    uLines: { value: null },
    uFront: { value: null },
    uEdge: { value: null },
    uMask: { value: null },
    uFactionAlpha: { value: 0.5 },
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
// The colour multiplier for a face turned ndl toward the sun. The same sum as litFactor in ../sun.ts.
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
  return smoothstep(0.52, 0.7, c) * 0.11 * uRelief * uDirect;
}
`;

const SHEET = /* glsl */ `
uniform vec4 uBounds;
// Texture coordinates on a sheet for a map point.
vec2 sheetUv(vec2 m) {
  return vec2((m.x - uBounds.x) / uBounds.z, 1.0 - (m.y - uBounds.y) / uBounds.w);
}
`;

function lightUniforms(shared: ShogunUniforms) {
  return {
    uTime: shared.uTime,
    uSunDir: shared.uSunDir,
    uSunColor: shared.uSunColor,
    uAmbient: shared.uAmbient,
    uDirect: shared.uDirect,
    uRelief: shared.uRelief,
  };
}

/** Every material here leaves tone mapping alone and sits a hair behind the marks laid on it. */
function boardMaterial(parameters: THREE.ShaderMaterialParameters): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ toneMapped: false, ...parameters });
}

// --- Land ---------------------------------------------------------------------------------------

/**
 * The top of the land: the natural ground, the faction wash over it, paper grain and contour
 * lines, then the borders and the frontline in ink.
 */
export function landMaterial(shared: ShogunUniforms): THREE.ShaderMaterial {
  return boardMaterial({
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
    uniforms: {
      ...lightUniforms(shared),
      uBounds: shared.uBounds,
      uTerrain: shared.uTerrain,
      uFaction: shared.uFaction,
      uLines: shared.uLines,
      uFront: shared.uFront,
      uMask: shared.uMask,
      uFactionAlpha: shared.uFactionAlpha,
      uGrain: { value: 0.6 },
      /** 0 reads the line sheets as they are. 1 hardens them, for a view closer than the sheet's own pixels. */
      uSharp: { value: 0 },
      /** How heavy the plain border and coast ink is. It eases off up close, where the lines are wide on screen. */
      uInkWeight: { value: 1 },
      uInk: { value: rgbOf(SHOGUN.ink) },
      uSand: { value: rgbOf(SHOGUN.sand) },
      uBand: { value: rgbOf(SHOGUN.frontBand) },
      uDash: { value: rgbOf(SHOGUN.frontDash) },
      /** Ink opacity of the friendly border: x dashed, y solid. */
      uFriendly: { value: new THREE.Vector2(0.25, 0) },
      /** Which frontline is drawn: x the two-tone ink line, y the band. */
      uFrontStyle: { value: new THREE.Vector2(1, 0) },
      uSunMap: shared.uSunMap,
      uSunMatrix: shared.uSunMatrix,
      uSunTexel: shared.uSunTexel,
      uSunTint: shared.uSunTint,
    },
    vertexShader: /* glsl */ `
      ${SUN_VERTEX}
      varying vec2 vMap;
      varying vec2 vScene;
      void main() {
        vMap = vec2(position.x, -position.y);
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
      uniform sampler2D uTerrain;
      uniform sampler2D uFaction;
      uniform sampler2D uLines;
      uniform sampler2D uFront;
      uniform sampler2D uMask;
      uniform float uFactionAlpha;
      uniform float uGrain;
      uniform float uSharp;
      uniform float uInkWeight;
      uniform vec3 uInk;
      uniform vec3 uSand;
      uniform vec3 uBand;
      uniform vec3 uDash;
      uniform vec2 uFriendly;
      uniform vec2 uFrontStyle;
      varying vec2 vMap;
      varying vec2 vScene;
      float crisp(float v) {
        return mix(v, smoothstep(0.3, 0.7, v), uSharp);
      }
      void main() {
        vec2 uv = sheetUv(vMap);
        // World units one screen pixel covers here. Grain finer than that is left out.
        float px = max(fwidth(vMap.x), fwidth(vMap.y));

        // The natural ground, mottled like a wash, with a pale fringe along the shore.
        vec3 c = texture2D(uTerrain, uv).rgb;
        c *= 0.95 + 0.1 * fbm(vMap * 0.07 + 3.1);
        float inland = texture2D(uMask, uv).g;
        c = mix(c, uSand, (1.0 - smoothstep(0.52, 0.9, inland)) * 0.38);

        // Contour lines, printed on the ground and under the wash.
        float h = fbm(vMap * 0.035) * 13.0 + vnoise(vMap * 0.012 + 5.0) * 6.0;
        float w = fwidth(h);
        float contour = 1.0 - smoothstep(w * 0.6, w * 1.6, abs(fract(h) - 0.5));
        contour *= 1.0 - smoothstep(0.12, 0.4, w);
        c *= 1.0 - contour * 0.13 * uGrain;

        // The faction's colour, as a translucent wash.
        vec3 faction = texture2D(uFaction, uv).rgb;
        c = mix(c, faction, uFactionAlpha);

        // Cold-press tooth over ground and wash alike.
        float tooth = (vnoise(vMap * 2.3) - 0.5) * (1.0 - smoothstep(0.2, 0.55, px * 2.3));
        tooth += (vnoise(vMap * 5.9 + 17.0) - 0.5) * 0.7 * (1.0 - smoothstep(0.2, 0.55, px * 5.9));
        c *= 1.0 + tooth * 0.14 * uGrain;

        // Borders. Inside one faction's land they are faint; between owners they are ink.
        vec3 lines = texture2D(uLines, uv).rgb;
        vec3 front = texture2D(uFront, uv).rgb;
        float flank = crisp(front.g) * uFrontStyle.x;
        float solid = crisp(lines.g);
        float other = max(crisp(lines.r) - solid, 0.0);
        c = mix(c, uInk, solid * uFriendly.y);
        c = mix(c, uInk, crisp(lines.b) * uFriendly.x);
        c = mix(c, uInk, other * 0.88 * uInkWeight * (1.0 - flank));

        // The frontline in two tones: each side's own colour as a stroke, and ink down the middle.
        float grey = dot(faction, vec3(0.299, 0.587, 0.114));
        vec3 stroke = clamp(mix(vec3(grey), faction, 1.3) * 0.97, 0.0, 1.0);
        c = mix(c, stroke, flank * 0.92);
        c = mix(c, uInk, crisp(front.r) * uFrontStyle.x);
        // The banded frontline.
        c = mix(c, uBand, smoothstep(0.2, 0.3, front.b) * 0.45 * uFrontStyle.y);
        c = mix(c, uDash, smoothstep(0.7, 0.8, front.b) * uFrontStyle.y);

        c *= lit(uSunDir.z);
        c *= 1.0 - cloudShade(vScene);
        // Alpha carries the light that reaches the ground, for the pieces painted over it.
        float reach = 1.0;
        #ifdef SUN_SHADOW
        float shade = sunShade(vSun);
        c *= mix(vec3(1.0), uSunTint, shade);
        reach = 1.0 - shade;
        #endif
        gl_FragColor = vec4(c, reach);
      }
    `,
  });
}

/** The cliff between land and water: strata, darker and wet toward the foot, lit by its facing. */
export function cliffMaterial(shared: ShogunUniforms, height: number): THREE.ShaderMaterial {
  return boardMaterial({
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
    uniforms: {
      ...lightUniforms(shared),
      uHeight: { value: height },
      uRockHigh: { value: rgbOf(SHOGUN.rockHigh) },
      uRockLow: { value: rgbOf(SHOGUN.rockLow) },
      uRockWet: { value: rgbOf(SHOGUN.rockWet) },
      uRockLip: { value: rgbOf(SHOGUN.rockLip) },
    },
    vertexShader: /* glsl */ `
      uniform float uHeight;
      varying vec3 vNormal;
      varying float vRise;
      varying float vAlong;
      void main() {
        vNormal = normal;
        vRise = position.z / uHeight;
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
      varying float vRise;
      varying float vAlong;
      void main() {
        float wobble = vnoise(vec2(vAlong * 0.8, 3.0)) * 1.3;
        float band = floor(vRise * 4.0 + wobble);
        vec3 rock = mix(uRockLow, uRockHigh, clamp(band / 4.0, 0.0, 1.0));
        rock *= 0.92 + 0.16 * hash21(vec2(band, floor(vAlong * 0.5)));
        rock = mix(rock, uRockWet, smoothstep(0.3, 0.05, vRise));
        rock = mix(rock, uRockLip, step(0.88, vRise) * 0.7);
        vec3 n = normalize(vNormal);
        // The cliffs in view face the viewer and away from the sun. A fill from the near side keeps them readable.
        vec3 light = lit(stepped(dot(n, uSunDir) * 1.15)) + vec3(0.14, 0.14, 0.16) * max(-n.y, 0.0) * uRelief;
        gl_FragColor = vec4(rock * light, 1.0);
      }
    `,
  });
}

// --- Water --------------------------------------------------------------------------------------

/** The sea: deep water, a pale shelf along the coast, and surf that rolls in while `uWater` is up. */
export function waterMaterial(shared: ShogunUniforms): THREE.ShaderMaterial {
  return boardMaterial({
    uniforms: {
      ...lightUniforms(shared),
      uBounds: shared.uBounds,
      uMask: shared.uMask,
      uWater: { value: 0 },
      uDeep: { value: rgbOf(SHOGUN.seaDeep) },
      uShelf: { value: rgbOf(SHOGUN.seaShelf) },
      uFoam: { value: rgbOf(SHOGUN.foam) },
      uBeyond: { value: rgbOf(SHOGUN.beyond) },
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
      uniform sampler2D uMask;
      uniform float uWater;
      uniform vec3 uDeep;
      uniform vec3 uShelf;
      uniform vec3 uFoam;
      uniform vec3 uBeyond;
      varying vec2 vScene;
      void main() {
        vec2 m = vec2(vScene.x, -vScene.y);
        // How far past the edge of the sheet this water is. Past it there is no coast to read.
        float past = max(max(uBounds.x - m.x, m.x - (uBounds.x + uBounds.z)), max(uBounds.y - m.y, m.y - (uBounds.y + uBounds.w)));
        vec3 mask = texture2D(uMask, sheetUv(m)).rgb * step(past, 0.0);
        float shore = clamp(mask.b * 2.0, 0.0, 1.0);
        float edge = mask.g;

        vec3 c = mix(uDeep, uShelf, shore * shore * 0.8);
        c *= 0.96 + 0.08 * fbm(m * 0.045);

        // A slow swell, bands of surf that roll in and break, and a line of foam that laps at the cliff.
        float swell = fbm(m * 0.05 + vec2(uTime * 0.03, uTime * 0.011));
        c += (swell - 0.5) * 0.05 * uWater;
        float phase = shore * 3.2 - uTime * 0.16 + (vnoise(m * 0.35) - 0.5) * 0.9;
        float crest = smoothstep(0.8, 0.88, fract(phase)) * smoothstep(0.4, 0.8, shore);
        float broken = step(0.42, vnoise(vec2(m.x * 1.3 + uTime * 0.2, m.y * 1.3)));
        float foam = crest * broken * 0.3;
        float lap = 0.05 * sin(uTime * 0.8 + vnoise(m * 0.5) * 6.2832);
        foam = max(foam, smoothstep(0.3 + lap, 0.42 + lap, edge) * (0.55 + 0.45 * vnoise(m * 2.2 + uTime * 0.3)));
        c = mix(c, uFoam, foam * uWater);
        // With the surf off, a still pale line keeps the shore readable.
        c = mix(c, uFoam, smoothstep(0.36, 0.46, edge) * 0.22 * (1.0 - uWater));

        c *= lit(uSunDir.z);
        c *= 1.0 - cloudShade(vScene);
        // Past the sheet the sea runs out into the dark of the table.
        c = mix(c, uBeyond, smoothstep(0.0, 90.0, past) * 0.85);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
}

/** A flat colour: sea-zone seams and other plain lines. */
export function flatMaterial(hex: string, opacity: number): THREE.ShaderMaterial {
  return boardMaterial({
    transparent: opacity < 1,
    depthWrite: opacity >= 1,
    uniforms: { uColor: { value: rgbOf(hex) }, uOpacity: { value: opacity } },
    vertexShader: /* glsl */ `
      void main() {
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() {
        gl_FragColor = vec4(uColor, uOpacity);
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

/** Trees, peaks, and buildings (the models in ../propMeshes.ts). */
export function propMaterial(shared: ShogunUniforms): THREE.ShaderMaterial {
  return boardMaterial({
    vertexColors: true,
    uniforms: {
      ...lightUniforms(shared),
      uBounds: shared.uBounds,
      uTerrain: shared.uTerrain,
      uFaction: shared.uFaction,
      uFactionAlpha: shared.uFactionAlpha,
      uGrow: { value: 0 },
      uSnow: { value: new THREE.Vector3(0.88, 0.86, 0.8) },
    },
    vertexShader: /* glsl */ `
      ${NOISE}
      ${LIGHT}
      ${SHEET}
      ${PROP_VERTEX}
      uniform sampler2D uTerrain;
      uniform sampler2D uFaction;
      uniform float uFactionAlpha;
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
            // Raised ground wears the land's colour at the foot and its own toward the top.
            vec2 origin = instanceMatrix[3].xy;
            vec2 uv = sheetUv(vec2(origin.x, -origin.y));
            vec3 ground = mix(texture2D(uTerrain, uv).rgb, texture2D(uFaction, uv).rgb, uFactionAlpha);
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
        // Wrapped light in three flat steps, with a fill from the near side.
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

/** A prop's shadow: the model laid flat on the land along the sun's ray. It stops at the coast. */
export function propShadowMaterial(shared: ShogunUniforms): THREE.ShaderMaterial {
  return shadowStencil(
    boardMaterial({
      uniforms: {
        uGrow: { value: 0 },
        uShadowVec: shared.uShadowVec,
        uShadowAlpha: shared.uShadowAlpha,
        uMask: shared.uMask,
        uBounds: shared.uBounds,
        uColor: { value: rgbOf(SHOGUN.shadow) },
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

// --- Pieces -------------------------------------------------------------------------------------

/**
 * A force marker: a disc in the faction's colour with a dark rim and a soft dark edge past it, so
 * grey armour and red infantry both stand off the ground. Unlit. One quad, `position.xy` in -1..1.
 */
export function markerMaterial(hex: string, rim: { value: number }): THREE.ShaderMaterial {
  return boardMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uColor: { value: rgbOf(hex) }, uRimColor: { value: rgbOf(SHOGUN.markerRim) }, uRim: rim },
    vertexShader: /* glsl */ `
      varying vec2 vAt;
      void main() {
        vAt = position.xy;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uRimColor;
      uniform float uRim;
      varying vec2 vAt;
      void main() {
        float d = length(vAt);
        float soft = fwidth(d);
        float rimOuter = 0.8 + 0.12 * uRim;
        float disc = 1.0 - smoothstep(0.667 - soft, 0.667 + soft, d);
        float ring = 1.0 - smoothstep(rimOuter - soft, rimOuter + soft, d);
        // Past the rim, a dark edge that fades out.
        float halo = (1.0 - smoothstep(rimOuter, 1.0, d)) * 0.3 * uRim;
        float alpha = max(ring, halo);
        if (alpha < 0.004) {
          discard;
        }
        gl_FragColor = vec4(mix(uRimColor, uColor, disc), alpha);
      }
    `,
  });
}

/** The contact shadow under a marker: a soft dark ellipse, slid along the sun's ray. */
export function markerShadowMaterial(): THREE.ShaderMaterial {
  return boardMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: rgbOf(SHOGUN.shadow) },
      uAlpha: { value: 0.32 },
      /** How far the shadow sits from under the piece, in scene x and y. */
      uSlide: { value: new THREE.Vector2(0.2, -0.35) },
    },
    vertexShader: /* glsl */ `
      uniform vec2 uSlide;
      varying vec2 vAt;
      void main() {
        vAt = position.xy;
        vec4 world = modelMatrix * vec4(position, 1.0);
        world.xy += uSlide;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uAlpha;
      varying vec2 vAt;
      void main() {
        float d = length(vAt);
        // Dark right at the piece and gone a little way out: a contact shadow, not a cast one.
        float alpha = uAlpha * (1.0 - smoothstep(0.78, 1.0, d));
        if (alpha < 0.004) {
          discard;
        }
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });
}

// --- Marks on a territory -----------------------------------------------------------------------

/**
 * The watercolour edge. A wash of pigment runs along the inside of the territory's border. Noise in
 * world space varies how far in it reaches, the pigment gathers into a darker ridge on the border
 * itself, and the wash feathers out toward the middle. `uChannel` picks the land or the sea reading
 * of the edge sheet, and `uReach` is the distance that sheet measures (see shogunSheets.ts).
 */
export function watercolorMaterial(shared: ShogunUniforms, hex: string, sea: boolean, reach: number): THREE.ShaderMaterial {
  return boardMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uBounds: shared.uBounds,
      uEdge: shared.uEdge,
      uTint: { value: rgbOf(hex) },
      uChannel: { value: sea ? 1 : 0 },
      uReach: { value: reach },
      /** Opacity of the whole mark. The frame loop writes it. */
      uStrength: { value: 1 },
      /** 1 close in. Above 1 at altitude, where the wash is widened so it still reads. */
      uWiden: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vMap;
      void main() {
        vMap = vec2(position.x, -position.y);
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE}
      ${SHEET}
      uniform sampler2D uEdge;
      uniform vec3 uTint;
      uniform float uChannel;
      uniform float uReach;
      uniform float uStrength;
      uniform float uWiden;
      varying vec2 vMap;
      void main() {
        vec3 edge = texture2D(uEdge, sheetUv(vMap)).rgb;
        // World units in from the border. It stops counting at uReach.
        float d = (1.0 - mix(edge.r, edge.g, uChannel)) * uReach;
        float slow = fbm(vMap * 0.42);
        float fine = vnoise(vMap * 1.7 + 9.0);
        // How far in the wash reaches here.
        float width = min(mix(2.0, 5.0, slow) * uWiden, uReach * 0.92);
        float wash = 1.0 - smoothstep(0.0, width, d);
        wash = pow(wash, 1.5) * (0.75 + 0.25 * fine);
        // Pigment gathers on the border, and a faint line dries where the wash stopped.
        float ridge = 1.0 - smoothstep(0.2 + 0.2 * fine, (0.7 + 0.4 * fine) * uWiden, d);
        float dried = smoothstep(width * 0.72, width * 0.92, d) * (1.0 - smoothstep(width * 0.92, width * 1.04, d));
        float granule = 0.82 + 0.36 * vnoise(vMap * 5.3);
        float alpha = (wash * 0.64 + dried * 0.14) * granule + ridge * 0.42 + 0.04;
        alpha = clamp(alpha * uStrength, 0.0, 0.96);
        if (alpha < 0.004) {
          discard;
        }
        vec3 pigment = mix(uTint, uTint * 0.55, ridge * 0.85);
        gl_FragColor = vec4(pigment, alpha);
      }
    `,
  });
}

// --- Battle marks -------------------------------------------------------------------------------

/** A shell crater: a rim and a pit, on the board. One unit quad per instance. */
export function craterMaterial(shared: ShogunUniforms): THREE.ShaderMaterial {
  return boardMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      ...lightUniforms(shared),
      uRim: { value: rgbOf(SHOGUN.craterRim) },
      uPit: { value: rgbOf(SHOGUN.craterPit) },
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
        gl_FragColor = vec4(c * lit(uSunDir.z), d < 0.46 ? 0.85 : 0.5 * (1.0 - smoothstep(0.7, 1.0, d)));
      }
    `,
  });
}

/**
 * Smoke: small soft puffs that face the camera, rise a little, and lean away on the wind. Each
 * instance is one puff of a column and loops on its own phase. `aOrigin` is the foot of the column
 * in the board's space, and `aPuff` is phase, kind (0 chimney, 1 battle), ember (0 or 1), and a
 * seed. No puff is ever more opaque than `uOpacity`.
 */
export function smokeMaterial(shared: ShogunUniforms): THREE.ShaderMaterial {
  return boardMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: shared.uTime,
      /** The zoom's share of the smoke: 0 at altitude. */
      uSmoke: { value: 0 },
      uOpacity: { value: 0.22 },
      /** The wind, in scene x and y. It blows up and to the right of the board. */
      uWind: { value: new THREE.Vector2(0.86, 0.5) },
      uCamRight: { value: new THREE.Vector3(1, 0, 0) },
      uCamUp: { value: new THREE.Vector3(0, 1, 0) },
      uSoot: { value: rgbOf(SHOGUN.soot) },
      uAsh: { value: rgbOf(SHOGUN.ash) },
      uSteam: { value: rgbOf(SHOGUN.steam) },
      uEmber: { value: rgbOf(SHOGUN.ember) },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aOrigin;
      attribute vec4 aPuff;
      uniform float uTime;
      uniform float uSmoke;
      uniform vec2 uWind;
      uniform vec3 uCamRight;
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
        float t = uTime * mix(0.11, 0.14, kind) + aPuff.x;
        float age = fract(t);
        float turn = floor(t) + aPuff.w * 17.0;
        float r1 = hash11(turn);
        float r2 = hash11(turn + 3.7);
        // A low rise and a steady lean downwind, so a column trails off on the diagonal.
        float rise = mix(2.6, 4.6, kind) * (0.75 + 0.5 * r1) * age;
        vec2 drift = uWind * age * mix(4.2, 7.5, kind) * (0.85 + 0.3 * r2);
        drift += vec2(sin(age * 7.0 + r2 * 6.2832), cos(age * 5.0 + r1 * 6.2832)) * 0.3 * age;
        float size = mix(0.4, 1.0, pow(age, 0.7)) * mix(0.8, 1.7, kind) * (0.8 + 0.4 * r2);
        vec3 centre = (modelMatrix * vec4(aOrigin, 1.0)).xyz + vec3(drift, rise);
        vec3 corner = centre + (uCamRight * position.x + uCamUp * position.y) * size * 2.0;
        vAt = position.xy;
        vPuff = aPuff;
        vAge = age;
        vFade = smoothstep(0.0, 0.14, age) * (1.0 - smoothstep(0.4, 1.0, age)) * uSmoke;
        gl_Position = projectionMatrix * viewMatrix * vec4(corner, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform float uOpacity;
      uniform vec3 uSoot;
      uniform vec3 uAsh;
      uniform vec3 uSteam;
      uniform vec3 uEmber;
      varying vec2 vAt;
      varying vec4 vPuff;
      varying float vAge;
      varying float vFade;
      void main() {
        float d = length(vAt) * 2.0;
        float ragged = vnoise(vAt * 3.2 + vPuff.w * 31.0);
        // Soft all the way out: thick in the middle, nothing at the edge.
        float body = 1.0 - smoothstep(0.1, 0.92 - 0.22 * ragged, d);
        float alpha = body * body * vFade * uOpacity;
        if (alpha < 0.003) {
          discard;
        }
        vec3 dark = mix(uAsh, uSoot, vPuff.y);
        vec3 pale = mix(uSteam, uAsh, vPuff.y * 0.6);
        vec3 c = mix(dark, pale, smoothstep(0.05, 0.7, vAge));
        c = mix(c, uEmber, vPuff.z * (1.0 - smoothstep(0.0, 0.2, vAge)));
        gl_FragColor = vec4(c, alpha);
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

/**
 * One direction of the miniature lens. The middle of the screen and most of the way out stay
 * sharp; only the far top edge, and a little of the near bottom edge, soften. Run across, then
 * down. With a radius of zero it is a plain copy.
 */
export function lensMaterial(): THREE.ShaderMaterial {
  return boardMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uSource: { value: null },
      /** One texel along the blur direction. */
      uStep: { value: new THREE.Vector2(1, 0) },
      /** Blur radius at the top edge of the screen, in texels. */
      uRadius: { value: 0 },
    },
    vertexShader: SCREEN_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D uSource;
      uniform vec2 uStep;
      uniform float uRadius;
      varying vec2 vUv;
      void main() {
        float above = max(vUv.y - 0.5, 0.0) * 2.0;
        float below = max(0.5 - vUv.y, 0.0) * 2.0;
        float away = max(above, below * 0.7);
        float reach = uRadius * smoothstep(0.62, 1.0, away) / 4.0;
        vec3 c = texture2D(uSource, vUv).rgb * 0.18;
        c += (texture2D(uSource, vUv + uStep * reach).rgb + texture2D(uSource, vUv - uStep * reach).rgb) * 0.15;
        c += (texture2D(uSource, vUv + uStep * reach * 2.0).rgb + texture2D(uSource, vUv - uStep * reach * 2.0).rgb) * 0.12;
        c += (texture2D(uSource, vUv + uStep * reach * 3.0).rgb + texture2D(uSource, vUv - uStep * reach * 3.0).rgb) * 0.09;
        c += (texture2D(uSource, vUv + uStep * reach * 4.0).rgb + texture2D(uSource, vUv - uStep * reach * 4.0).rgb) * 0.05;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
}
