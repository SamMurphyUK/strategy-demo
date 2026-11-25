// The board's frame buffers and the full-screen passes that finish a frame. No React.
//
//   board  ->  grade (colour, then the 2D canvases laid over)  ->  lens across  ->  lens down  ->  screen
//
// Above the table the lens is off and the grade writes straight to the screen.
//
// Two more buffers can feed the grade, and each exists only while its effect is on:
//
//   board depth  ->  shade  ->  shade, averaged   (multiplied into the board)
//   board        ->  glow, halved a few times and added back up   (added to the board)
//
// Both read the board before the canvases go on, so neither touches a piece. The shade needs the
// board's depth as a texture, and the glow needs the board to hold values above white; the board
// buffer is rebuilt with either one only when it is asked for (see `configure`). With neither, and
// no grain, `finish` runs the passes it always ran.
import * as THREE from "three";
import {
  aoBlurMaterial,
  aoMaterial,
  bloomDownMaterial,
  bloomUpMaterial,
  gradeMaterial,
  lensMaterial,
  setDefine,
} from "./boardMaterials";

/** What one frame asks of the finishing passes. `null` and 0 are off. */
export interface FrameEffects {
  /** Shade in the crevices. `strength` already carries the zoom's share. */
  ao: { strength: number; samples: number; scale: number; reach: number; halfWidth: number; halfHeight: number; near: number; far: number } | null;
  /** Glow. `threshold` is the brightness above which light spreads. */
  bloom: { strength: number; levels: number; threshold: number } | null;
  /** Depth of the paper tooth, and the size of one grain in frame pixels. */
  grain: number;
  grainPixel: number;
}

export const NO_EFFECTS: FrameEffects = { ao: null, bloom: null, grain: 0, grainPixel: 1 };

/** Most halvings of the glow buffer. */
const MAX_BLOOM_LEVELS = 5;

function plainTarget(type: THREE.TextureDataType = THREE.UnsignedByteType): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false, colorSpace: THREE.NoColorSpace, type });
}

export class PostStack {
  readonly grade = gradeMaterial();
  readonly lens = lensMaterial();
  /** The board is drawn here: multisampled, with depth, and a stencil bit for the shadows. */
  board: THREE.WebGLRenderTarget;
  private readonly first: THREE.WebGLRenderTarget;
  private readonly second: THREE.WebGLRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  width = 1;
  height = 1;

  /** The board keeps its depth as a texture, and holds colour above white. */
  private depth = false;
  private hdr = false;
  private ao: { material: THREE.ShaderMaterial; blur: THREE.ShaderMaterial; raw: THREE.WebGLRenderTarget; soft: THREE.WebGLRenderTarget } | null = null;
  private bloom: { down: THREE.ShaderMaterial; up: THREE.ShaderMaterial; downs: THREE.WebGLRenderTarget[]; ups: THREE.WebGLRenderTarget[] } | null = null;

  constructor() {
    this.board = this.makeBoard();
    this.first = plainTarget();
    this.second = plainTarget();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.grade);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  private makeBoard(): THREE.WebGLRenderTarget {
    const board = new THREE.WebGLRenderTarget(this.width, this.height, {
      samples: 4,
      depthBuffer: true,
      stencilBuffer: true,
      colorSpace: THREE.NoColorSpace,
      type: this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
    });
    if (this.depth) {
      const depth = new THREE.DepthTexture(this.width, this.height, THREE.UnsignedInt248Type);
      depth.format = THREE.DepthStencilFormat;
      depth.minFilter = THREE.NearestFilter;
      depth.magFilter = THREE.NearestFilter;
      board.depthTexture = depth;
    }
    return board;
  }

  /**
   * Says what the board buffer has to carry this frame. It is rebuilt only when the answer
   * changes: when the shade or the glow is switched on or off.
   */
  configure(depth: boolean, hdr: boolean): void {
    if (depth === this.depth && hdr === this.hdr) {
      return;
    }
    this.depth = depth;
    this.hdr = hdr;
    this.board.depthTexture?.dispose();
    this.board.dispose();
    this.board = this.makeBoard();
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

  private dropShade(): void {
    if (this.ao) {
      this.ao.material.dispose();
      this.ao.blur.dispose();
      this.ao.raw.dispose();
      this.ao.soft.dispose();
      this.ao = null;
    }
  }

  private dropGlow(): void {
    if (this.bloom) {
      this.bloom.down.dispose();
      this.bloom.up.dispose();
      for (const target of [...this.bloom.downs, ...this.bloom.ups]) {
        target.dispose();
      }
      this.bloom = null;
    }
  }

  /** The shade buffer for this frame, or null with the shade off. The buffers are dropped while it is off. */
  private shade(gl: THREE.WebGLRenderer, look: FrameEffects["ao"]): THREE.Texture | null {
    const depth = this.board.depthTexture;
    if (!look || !depth) {
      this.dropShade();
      return null;
    }
    const ao = (this.ao ??= { material: aoMaterial(), blur: aoBlurMaterial(), raw: plainTarget(), soft: plainTarget() });
    const w = Math.max(1, Math.round(this.width * look.scale));
    const h = Math.max(1, Math.round(this.height * look.scale));
    if (ao.raw.width !== w || ao.raw.height !== h) {
      ao.raw.setSize(w, h);
      ao.soft.setSize(w, h);
    }
    setDefine(ao.material, "AO_SAMPLES", look.samples);
    const uniforms = ao.material.uniforms;
    uniforms.uDepth.value = depth;
    uniforms.uFrustum.value.set(look.halfWidth, look.halfHeight, look.near, look.far);
    uniforms.uDepthTexel.value.set(1 / this.width, 1 / this.height);
    uniforms.uReach.value = look.reach;
    uniforms.uStrength.value = look.strength;
    this.pass(gl, ao.material, ao.raw);
    ao.blur.uniforms.uSource.value = ao.raw.texture;
    ao.blur.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.pass(gl, ao.blur, ao.soft);
    return ao.soft.texture;
  }

  /** The glow buffer for this frame, or null with the glow off. */
  private glow(gl: THREE.WebGLRenderer, look: FrameEffects["bloom"]): THREE.Texture | null {
    if (!look || !this.hdr) {
      this.dropGlow();
      return null;
    }
    const bloom = (this.bloom ??= { down: bloomDownMaterial(), up: bloomUpMaterial(), downs: [], ups: [] });
    const levels = Math.min(MAX_BLOOM_LEVELS, Math.max(1, Math.floor(look.levels)));
    while (bloom.downs.length < levels) {
      bloom.downs.push(plainTarget(THREE.HalfFloatType));
      bloom.ups.push(plainTarget(THREE.HalfFloatType));
    }
    let w = this.width;
    let h = this.height;
    let source: THREE.Texture = this.board.texture;
    // Down: the bright part of the board at half size, then halved again for each level.
    for (let i = 0; i < levels; i++) {
      const sourceW = w;
      const sourceH = h;
      w = Math.max(1, w >> 1);
      h = Math.max(1, h >> 1);
      const target = bloom.downs[i];
      if (target.width !== w || target.height !== h) {
        target.setSize(w, h);
        bloom.ups[i].setSize(w, h);
      }
      bloom.down.uniforms.uSource.value = source;
      bloom.down.uniforms.uTexel.value.set(1 / sourceW, 1 / sourceH);
      bloom.down.uniforms.uThreshold.value = i === 0 ? look.threshold : -1;
      this.pass(gl, bloom.down, target);
      source = target.texture;
    }
    // Up: each level takes the spread of the one below it.
    let below: THREE.WebGLRenderTarget = bloom.downs[levels - 1];
    for (let i = levels - 2; i >= 0; i--) {
      bloom.up.uniforms.uSource.value = below.texture;
      bloom.up.uniforms.uOwn.value = bloom.downs[i].texture;
      bloom.up.uniforms.uTexel.value.set(1 / below.width, 1 / below.height);
      this.pass(gl, bloom.up, bloom.ups[i]);
      below = bloom.ups[i];
    }
    return below.texture;
  }

  /**
   * Finishes the frame from the board target to the screen. `radius` is the lens blur at the top
   * and bottom edge in pixels, and `vignette` is the strength of the darkened corners.
   */
  finish(gl: THREE.WebGLRenderer, radius: number, vignette: number, effects: FrameEffects = NO_EFFECTS): void {
    const grade = this.grade.uniforms;
    const shade = this.shade(gl, effects.ao);
    setDefine(this.grade, "AO", shade ? 1 : null);
    grade.uAo.value = shade;
    const glow = this.glow(gl, effects.bloom);
    setDefine(this.grade, "BLOOM", glow ? 1 : null);
    grade.uBloom.value = glow;
    if (glow && effects.bloom) {
      // A warm glow, the colour of firelight, shared out over the levels that were added up.
      const share = effects.bloom.strength / Math.sqrt(Math.max(1, Math.floor(effects.bloom.levels)));
      grade.uBloomTint.value.set(share, share * 0.9, share * 0.74);
    }
    const grain = effects.grain > 0.0005;
    setDefine(this.grade, "GRAIN", grain ? 1 : null);
    setDefine(this.lens, "GRAIN", grain ? 1 : null);

    grade.uScene.value = this.board.texture;
    if (radius < 0.05 && vignette < 0.01) {
      grade.uGrain.value.set(effects.grain, effects.grainPixel, 0);
      this.pass(gl, this.grade, null);
      return;
    }
    // The tooth goes on last, over the lens.
    grade.uGrain.value.set(0, effects.grainPixel, 0);
    this.pass(gl, this.grade, this.first);
    this.lens.uniforms.uSource.value = this.first.texture;
    this.lens.uniforms.uStep.value.set(1 / this.width, 0);
    this.lens.uniforms.uRadius.value = radius;
    this.lens.uniforms.uVignette.value = 0;
    this.lens.uniforms.uGrain.value.set(0, effects.grainPixel, 0);
    this.pass(gl, this.lens, this.second);
    this.lens.uniforms.uSource.value = this.second.texture;
    this.lens.uniforms.uStep.value.set(0, 1 / this.height);
    this.lens.uniforms.uVignette.value = vignette;
    this.lens.uniforms.uGrain.value.set(effects.grain, effects.grainPixel, 0);
    this.pass(gl, this.lens, null);
  }

  dispose(): void {
    this.dropShade();
    this.dropGlow();
    this.board.depthTexture?.dispose();
    this.board.dispose();
    this.first.dispose();
    this.second.dispose();
    this.quad.geometry.dispose();
    this.grade.dispose();
    this.lens.dispose();
  }
}
