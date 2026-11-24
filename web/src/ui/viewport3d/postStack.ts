// The board's frame buffers and the full-screen passes that finish a frame. No React.
//
//   board  ->  grade (colour, then the 2D canvases laid over)  ->  lens across  ->  lens down  ->  screen
//
// Above the table the lens is off and the grade writes straight to the screen.
import * as THREE from "three";
import { gradeMaterial, lensMaterial } from "./boardMaterials";

export class PostStack {
  readonly grade = gradeMaterial();
  readonly lens = lensMaterial();
  /** The board is drawn here: multisampled, with depth, and a stencil bit for the shadows. */
  readonly board: THREE.WebGLRenderTarget;
  private readonly first: THREE.WebGLRenderTarget;
  private readonly second: THREE.WebGLRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  width = 1;
  height = 1;

  constructor() {
    const plain = { depthBuffer: false, stencilBuffer: false, colorSpace: THREE.NoColorSpace } as const;
    this.board = new THREE.WebGLRenderTarget(1, 1, { samples: 4, depthBuffer: true, stencilBuffer: true, colorSpace: THREE.NoColorSpace });
    this.first = new THREE.WebGLRenderTarget(1, 1, plain);
    this.second = new THREE.WebGLRenderTarget(1, 1, plain);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.grade);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w === this.width && h === this.height) {
      return;
    }
    this.width = w;
    this.height = h;
    this.board.setSize(w, h);
    this.first.setSize(w, h);
    this.second.setSize(w, h);
  }

  private pass(gl: THREE.WebGLRenderer, material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    gl.setRenderTarget(target);
    gl.render(this.scene, this.camera);
  }

  /**
   * Finishes the frame from the board target to the screen. `radius` is the lens blur at the top
   * and bottom edge in pixels, and `vignette` is the strength of the darkened corners.
   */
  finish(gl: THREE.WebGLRenderer, radius: number, vignette: number): void {
    this.grade.uniforms.uScene.value = this.board.texture;
    if (radius < 0.05 && vignette < 0.01) {
      this.pass(gl, this.grade, null);
      return;
    }
    this.pass(gl, this.grade, this.first);
    this.lens.uniforms.uSource.value = this.first.texture;
    this.lens.uniforms.uStep.value.set(1 / this.width, 0);
    this.lens.uniforms.uRadius.value = radius;
    this.lens.uniforms.uVignette.value = 0;
    this.pass(gl, this.lens, this.second);
    this.lens.uniforms.uSource.value = this.second.texture;
    this.lens.uniforms.uStep.value.set(0, 1 / this.height);
    this.lens.uniforms.uVignette.value = vignette;
    this.pass(gl, this.lens, null);
  }

  dispose(): void {
    this.board.dispose();
    this.first.dispose();
    this.second.dispose();
    this.quad.geometry.dispose();
    this.grade.dispose();
    this.lens.dispose();
  }
}
