import * as THREE from 'three';

/**
 * GPU 粒子系統
 *
 * 設計原則:
 * - CPU 只負責 emit()(寫入誕生瞬間的初始狀態),絕不逐幀修改粒子位置。
 * - 粒子的位置、重力下墜、阻力衰減、生命淡出、尺寸縮放全部由 vertex/fragment shader
 *   以「解析公式」計算,GPU 每幀重新求值,不需要 CPU for-loop。
 * - 使用固定大小的 Float32Array 當作 ring buffer(物件池),寫入指標循環覆寫,
 *   沒有陣列 push/pop,沒有 GC 壓力。
 * - 用 THREE.Points 一次性 draw call 畫出全部粒子(而不是 InstancedMesh),
 *   因為煙火火星是 2D sprite,不需要每顆獨立幾何體。
 */

const VERTEX_SHADER = /* glsl */ `
attribute vec3 aSpawnPos;
attribute vec3 aVelocity;
attribute vec3 aColorA;
attribute vec3 aColorB;
attribute vec3 aColorC;
attribute float aSpawnTime;
attribute float aMaxLife;
attribute float aSize;
attribute float aGravity;
attribute float aDrag;
attribute float aTrailFade; // 0=火星本體(最亮), 1=拖尾末端(最暗)

uniform float uTime;
uniform float uPixelRatio;
uniform float uTrailStep; // 每一節拖尾代表往回推多少秒

varying vec3 vColor;
varying float vAlpha;

void main() {
  float tHead = uTime - aSpawnTime;

  // 尚未誕生,或已超過生命週期 -> 丟到裁剪空間外,不繪製
  if (tHead < 0.0 || tHead > aMaxLife) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vAlpha = 0.0;
    vColor = vec3(0.0);
    return;
  }

  // 這一節拖尾實際對應的時間點(往回推,但不早於誕生瞬間)
  float t = max(0.0, tHead - aTrailFade * uTrailStep);

  float lifeRatio = 1.0 - clamp(tHead / aMaxLife, 0.0, 1.0);

  // 阻力:指數衰減的閉式解 (避免逐幀迴圈更新速度)
  vec3 dragTerm;
  if (aDrag < 0.0008) {
    dragTerm = aVelocity * t;
  } else {
    dragTerm = (aVelocity / aDrag) * (1.0 - exp(-aDrag * t));
  }

  // 重力:二次項下墜
  vec3 gravityTerm = vec3(0.0, -aGravity * t * t * 0.5, 0.0);

  vec3 pos = aSpawnPos + dragTerm + gravityTerm;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  float sizeFade = mix(0.35, 1.0, lifeRatio);
  float trailShrink = 1.0 - aTrailFade * 0.65; // 拖尾越尾端越細
  gl_PointSize = aSize * sizeFade * trailShrink * uPixelRatio * (320.0 / max(0.001, -mvPosition.z));

  // 三段式生命顏色漸變(供變色菊等特效使用;單色特效三個顏色相同即可)
  vec3 col;
  if (lifeRatio > 0.6) {
    col = aColorA;
  } else if (lifeRatio > 0.25) {
    col = mix(aColorB, aColorA, (lifeRatio - 0.25) / 0.35);
  } else {
    col = mix(aColorC, aColorB, lifeRatio / 0.25);
  }
  vColor = col;
  vAlpha = pow(lifeRatio, 1.15) * (1.0 - aTrailFade * 0.82); // 拖尾越尾端越暗
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D pointTexture;
uniform float uAlphaMul;
uniform float uBrightness;

varying vec3 vColor;
varying float vAlpha;

void main() {
  vec4 tex = texture2D(pointTexture, gl_PointCoord);
  float a = vAlpha * uAlphaMul * tex.a;
  gl_FragColor = vec4(vColor * uBrightness * a, a);
}
`;

const ATTR_SPEC = [
  ['aSpawnPos', 3], ['aVelocity', 3],
  ['aColorA', 3], ['aColorB', 3], ['aColorC', 3],
  ['aSpawnTime', 1], ['aMaxLife', 1], ['aSize', 1], ['aGravity', 1], ['aDrag', 1],
  ['aTrailFade', 1],
];

export class ParticleSystem {
  constructor(scene, maxParticles = 18000) {
    this.max = maxParticles;
    this.writeIndex = 0;
    this._dirty = new Set();

    const geometry = new THREE.BufferGeometry();
    for (const [name, size] of ATTR_SPEC) {
      const arr = new Float32Array(maxParticles * size);
      if (name === 'aSpawnTime') arr.fill(-9999);
      if (name === 'aMaxLife') arr.fill(1);
      const attr = new THREE.BufferAttribute(arr, size);
      attr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, attr);
    }
    this.geometry = geometry;

    const pointTexture = ParticleSystem.makeSpriteTexture();

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.5) },
        uAlphaMul: { value: 1.0 },
        uBrightness: { value: 2.1 },
        uTrailStep: { value: 0.045 },
        pointTexture: { value: pointTexture },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);

    // 水面倒影:共用同一份 geometry(GPU Buffer Reuse),鏡射 + 降低透明度
    this.reflectionMaterial = this.material.clone();
    this.reflectionMaterial.uniforms = THREE.UniformsUtils.clone(this.material.uniforms);
    this.reflectionMaterial.uniforms.pointTexture.value = pointTexture;
    this.reflectionMaterial.uniforms.uAlphaMul.value = 0.32;

    this.reflectionPoints = new THREE.Points(geometry, this.reflectionMaterial);
    this.reflectionPoints.frustumCulled = false;
    this.reflectionPoints.scale.y = -1;
    scene.add(this.reflectionPoints);
  }

  static makeSpriteTexture() {
    const size = 64;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  /** 每幀由外部呼叫,更新 shader 內部時間 uniform */
  setTime(t) {
    this.material.uniforms.uTime.value = t;
    this.reflectionMaterial.uniforms.uTime.value = t;
  }

  /**
   * 誕生一顆粒子(CPU 唯一負責的事:Emit)
   * p = { pos, vel, colorA, colorB, colorC, spawnTime, life, size, gravity, drag, trail? }
   * trail: 拖尾節數(預設1=無拖尾)。>1 時會在 ring buffer 裡連續寫入 trail 個槽位,
   *        每個槽位只是 aTrailFade 不同,GPU 會用同一條解析軌跡回推畫出彗星狀拖痕。
   */
  emit(p) {
    const steps = p.trail && p.trail > 1 ? p.trail : 1;
    for (let k = 0; k < steps; k++) {
      const i = this.writeIndex;
      this._write('aSpawnPos', i, p.pos, 3);
      this._write('aVelocity', i, p.vel, 3);
      this._write('aColorA', i, p.colorA, 3);
      this._write('aColorB', i, p.colorB || p.colorA, 3);
      this._write('aColorC', i, p.colorC || p.colorA, 3);
      this._write('aSpawnTime', i, p.spawnTime, 1);
      this._write('aMaxLife', i, p.life, 1);
      this._write('aSize', i, p.size, 1);
      this._write('aGravity', i, p.gravity, 1);
      this._write('aDrag', i, p.drag, 1);
      this._write('aTrailFade', i, steps > 1 ? k / (steps - 1) : 0, 1);
      this.writeIndex = (this.writeIndex + 1) % this.max;
    }
  }

  emitBatch(list) {
    for (const p of list) this.emit(p);
  }

  _write(name, i, value, size) {
    const attr = this.geometry.attributes[name];
    if (size === 1) {
      attr.array[i] = value;
    } else {
      attr.array[i * size] = value[0];
      attr.array[i * size + 1] = value[1];
      attr.array[i * size + 2] = value[2];
    }
    this._dirty.add(name);
  }

  /** 每幀結束時呼叫一次:只把「本幀真的被寫入過」的屬性上傳到 GPU */
  flush() {
    if (this._dirty.size === 0) return;
    for (const name of this._dirty) {
      this.geometry.attributes[name].needsUpdate = true;
    }
    this._dirty.clear();
  }
}
