import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

/**
 * PostProcessing
 *
 * 只負責「畫面後製」,不知道場景裡有什麼東西。
 * Renderer 本身只負責畫面輸出,色調映射(ACESFilmic)與曝光設在 renderer 上,
 * 這裡專注在多重 Pass 的組合與 resize。
 */
export class PostProcessing {
  constructor(renderer, scene, camera) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), // 半解析度算bloom,省很多
      1.6,   // strength
      0.8,   // radius
      0.14   // threshold
    );
    this.composer.addPass(this.bloomPass);

    this.afterimagePass = new AfterimagePass(0.85);
    this.composer.addPass(this.afterimagePass);

    this.fxaaPass = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaaPass);
    this._updateFXAAResolution(renderer);
  }

  _updateFXAAResolution(renderer) {
    const pr = renderer.getPixelRatio();
    this.fxaaPass.material.uniforms['resolution'].value.set(
      1 / (window.innerWidth * pr),
      1 / (window.innerHeight * pr)
    );
  }

  resize(renderer, w, h) {
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w / 2, h / 2);
    this._updateFXAAResolution(renderer);
  }

  render() {
    this.composer.render();
  }
}
