// The sky the sea mirrors. Built once, when the sheen is switched on.
//
// It is a painted sky and not a room: a pale blue-grey overhead, a warm bright haze toward the
// horizon, and a dull band below it for the far shore. The colours are sRGB numbers used as they
// are, like every other colour on the board. The sun is not in it; the water adds the sun's own
// glitter from the light's direction, so the glitter follows the sun through the day.
//
// `PMREMGenerator` turns the dome into a prefiltered cube, so the water can read a soft sky at any
// blur, and `scene.environment` can take the same cube for any standard material added later.
import * as THREE from "three";

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT = /* glsl */ `
varying vec3 vDir;
void main() {
  float up = normalize(vDir).y;
  vec3 zenith = vec3(0.60, 0.70, 0.82);
  vec3 high = vec3(0.74, 0.81, 0.88);
  vec3 haze = vec3(1.0, 0.96, 0.86);
  vec3 shore = vec3(0.44, 0.47, 0.46);
  vec3 c = mix(haze, high, smoothstep(0.0, 0.42, up));
  c = mix(c, zenith, smoothstep(0.35, 1.0, up));
  c = mix(shore, c, smoothstep(-0.12, 0.03, up));
  gl_FragColor = vec4(c, 1.0);
}
`;

/** The sky as a prefiltered cube, with y up. The caller disposes the target. */
export function buildSkyEnvironment(gl: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const scene = new THREE.Scene();
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), material);
  scene.add(dome);
  const generator = new THREE.PMREMGenerator(gl);
  const before = gl.getRenderTarget();
  const target = generator.fromScene(scene, 0, 0.1, 100);
  gl.setRenderTarget(before);
  generator.dispose();
  dome.geometry.dispose();
  material.dispose();
  return target;
}
