// The Shogun board's frame: the scene is drawn to a target, then the lens copies it to the screen.
import * as THREE from "three";
import { lensMaterial } from "./shogunMaterials";

export class ShogunPost {
  readonly lens = lensMaterial();
  /** The board is drawn here: multisampled, with depth, and a stencil bit for the shadows. */
  readonly board: THREE.WebGLRenderTarget;
  private readonly across: THREE.WebGLRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  width = 1;
  height = 1;

  constructor() {
    this.board = new THREE.WebGLRenderTarget(1, 1, { samples: 4, depthBuffer: true, stencilBuffer: true, colorSpace: THREE.NoColorSpace });
    this.across = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false, colorSpace: THREE.NoColorSpace });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.lens);
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
    this.across.setSize(w, h);
  }

  private pass(gl: THREE.WebGLRenderer, source: THREE.Texture, stepX: number, stepY: number, radius: number, target: THREE.WebGLRenderTarget | null): void {
    this.lens.uniforms.uSource.value = source;
    this.lens.uniforms.uStep.value.set(stepX, stepY);
    this.lens.uniforms.uRadius.value = radius;
    gl.setRenderTarget(target);
    gl.render(this.scene, this.camera);
  }

  /** Copies the board to the screen. `radius` is the lens blur at the top edge, in pixels; 0 is a plain copy. */
  finish(gl: THREE.WebGLRenderer, radius: number): void {
    if (radius < 0.05) {
      this.pass(gl, this.board.texture, 0, 0, 0, null);
      return;
    }
    this.pass(gl, this.board.texture, 1 / this.width, 0, radius, this.across);
    this.pass(gl, this.across.texture, 0, 1 / this.height, radius, null);
  }

  dispose(): void {
    this.board.dispose();
    this.across.dispose();
    this.quad.geometry.dispose();
    this.lens.dispose();
  }
}
