import * as THREE from "three";
import { brightFrag, blurFrag, compositeFrag, fullscreenVert } from "./shaders";

/**
 * Linear-space post pipeline:
 *   scene -> HDR RT (MSAA) -> threshold -> separable blur -> composite (tonemap + grade + glitch)
 */
export class PostFX {
  readonly uniforms = {
    uTime: { value: 0 },
    uExposure: { value: 1.0 },
    uBloom: { value: 0.55 },
    uGlitch: { value: 0 },
    uChroma: { value: 0.02 },
    uWarp: { value: 0 },
    uScan: { value: 0.07 },
    uGrain: { value: 0.028 },
    uVignette: { value: 0.55 },
    uRadial: { value: 0 },
    uFlash: { value: 0 },
    uPixel: { value: 0 },
    uDesat: { value: 0 },
    uInvert: { value: 0 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uInside: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  };

  private rtScene!: THREE.WebGLRenderTarget;
  private rtBright!: THREE.WebGLRenderTarget;
  private rtA!: THREE.WebGLRenderTarget;
  private rtB!: THREE.WebGLRenderTarget;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.Camera();
  private quad: THREE.Mesh;
  private brightMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private compositeMat: THREE.ShaderMaterial;
  private width = 1;
  private height = 1;

  constructor(private renderer: THREE.WebGLRenderer) {
    const geo = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(geo);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.brightMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: brightFrag,
      uniforms: { tDiffuse: { value: null }, uThreshold: { value: 0.62 } },
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: blurFrag,
      uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
    });
    this.compositeMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: compositeFrag,
      uniforms: {
        tScene: { value: null },
        tBloom: { value: null },
        ...this.uniforms,
      } as Record<string, THREE.IUniform>,
      depthTest: false,
      depthWrite: false,
    });
  }

  setSize(width: number, height: number, pixelRatio: number) {
    const w = Math.max(2, Math.floor(width * pixelRatio));
    const h = Math.max(2, Math.floor(height * pixelRatio));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.disposeTargets();

    const hdr = { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false };
    const samples = this.renderer.capabilities.isWebGL2 ? 4 : 0;
    this.rtScene = new THREE.WebGLRenderTarget(w, h, { ...hdr, samples });
    this.rtScene.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.rtScene.texture.minFilter = THREE.LinearFilter;
    this.rtScene.texture.magFilter = THREE.LinearFilter;

    const bw = Math.max(2, Math.floor(w / 3));
    const bh = Math.max(2, Math.floor(h / 3));
    const bloom = { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false };
    this.rtBright = new THREE.WebGLRenderTarget(bw, bh, bloom);
    this.rtA = new THREE.WebGLRenderTarget(bw, bh, bloom);
    this.rtB = new THREE.WebGLRenderTarget(bw, bh, bloom);
    for (const rt of [this.rtBright, this.rtA, this.rtB]) {
      rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
      rt.texture.minFilter = THREE.LinearFilter;
      rt.texture.magFilter = THREE.LinearFilter;
    }
    this.uniforms.uRes.value.set(w, h);
  }

  private disposeTargets() {
    this.rtScene?.dispose();
    this.rtBright?.dispose();
    this.rtA?.dispose();
    this.rtB?.dispose();
  }

  private draw(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.clear(true, true, true);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    const r = this.renderer;
    r.setRenderTarget(this.rtScene);
    r.clear(true, true, true);
    r.render(scene, camera);

    // bright pass
    this.brightMat.uniforms.tDiffuse.value = this.rtScene.texture;
    this.draw(this.brightMat, this.rtBright);

    // blur
    const spread = 1 / this.rtBright.width;
    this.blurMat.uniforms.tDiffuse.value = this.rtBright.texture;
    this.blurMat.uniforms.uDir.value.set(spread * 1.4, 0);
    this.draw(this.blurMat, this.rtA);
    this.blurMat.uniforms.tDiffuse.value = this.rtA.texture;
    this.blurMat.uniforms.uDir.value.set(0, spread * 1.4);
    this.draw(this.blurMat, this.rtB);
    this.blurMat.uniforms.tDiffuse.value = this.rtB.texture;
    this.blurMat.uniforms.uDir.value.set(spread * 2.6, 0);
    this.draw(this.blurMat, this.rtA);

    // composite to screen
    this.compositeMat.uniforms.tScene.value = this.rtScene.texture;
    this.compositeMat.uniforms.tBloom.value = this.rtA.texture;
    this.draw(this.compositeMat, null);
  }

  dispose() {
    this.disposeTargets();
    this.quad.geometry.dispose();
    this.brightMat.dispose();
    this.blurMat.dispose();
    this.compositeMat.dispose();
  }
}
