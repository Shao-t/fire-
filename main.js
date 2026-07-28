import * as THREE from 'three';
import { ParticleSystem } from './particles/ParticleSystem.js';
import { RocketManager } from './managers/RocketManager.js';
import { FireworkManager } from './managers/FireworkManager.js';
import { SoundManager } from './audio/SoundManager.js';
import { UIManager, MODE_LABELS } from './ui/UIManager.js';
import { PostProcessing } from './core/PostProcessing.js';

// ---------------------------------------------------------------------------
// Renderer / Scene / Camera
// ---------------------------------------------------------------------------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
console.info('[fireworks] WebGL2 context:', renderer.capabilities.isWebGL2);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 1, 6000);
camera.position.set(0, 180, 640);
camera.lookAt(0, 300, 0);

// ---------------------------------------------------------------------------
// 環境:地面(水面)+ 星空,純氛圍,不參與煙火邏輯
// ---------------------------------------------------------------------------
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(4000, 4000),
  new THREE.MeshBasicMaterial({ color: 0x040810, transparent: true, opacity: 0.55, depthWrite: false })
);
ground.rotation.x = -Math.PI / 2;
ground.renderOrder = 10; // 蓋在倒影粒子之上,模擬水面
scene.add(ground);

function buildStarfield() {
  const count = 1500;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 2000 + Math.random() * 1000;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.5; // 只放在上半球
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = 200 + r * Math.cos(phi) * 0.5;
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xaaccff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.6 });
  return new THREE.Points(geo, mat);
}
scene.add(buildStarfield());

// ---------------------------------------------------------------------------
// 核心系統
// ---------------------------------------------------------------------------
const particleSystem = new ParticleSystem(scene, 18000);
const rocketManager = new RocketManager(particleSystem);
const soundManager = new SoundManager();
const fireworkManager = new FireworkManager(particleSystem, rocketManager, soundManager);
const uiManager = new UIManager();
const postProcessing = new PostProcessing(renderer, scene, camera);

// ---------------------------------------------------------------------------
// 互動:點擊/觸控 -> 射線投射到面向攝影機的發射平面 -> 決定發射座標
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const launchPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // z = 0 的平面,永遠面向攝影機
const ndc = new THREE.Vector2();
const hitPoint = new THREE.Vector3();

function handleInteract(clientX, clientY) {
  soundManager.unlock(); // 第一次互動時才建立 AudioContext,符合瀏覽器政策

  ndc.x = (clientX / window.innerWidth) * 2 - 1;
  ndc.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);

  if (raycaster.ray.intersectPlane(launchPlane, hitPoint)) {
    const x = THREE.MathUtils.clamp(hitPoint.x, -420, 420);
    const z = THREE.MathUtils.clamp(hitPoint.y * 0.4, -200, 200); // 用畫面上下決定一點景深
    const mode = uiManager.getMode();
    fireworkManager.launch(x, z, mode);
    uiManager.showLabel(MODE_LABELS[mode]);
  }
}

canvas.addEventListener('click', (e) => handleInteract(e.clientX, e.clientY));
canvas.addEventListener('touchend', (e) => {
  const t = e.changedTouches[0];
  handleInteract(t.clientX, t.clientY);
});

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------
window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  postProcessing.resize(renderer, w, h);
});

// ---------------------------------------------------------------------------
// Animation Loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
const fpsEl = document.getElementById('fps');
let fpsAccum = 0, fpsFrames = 0, fpsTimer = 0;

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05); // 避免tab切換回來時dt過大暴衝
  const elapsed = clock.elapsedTime;

  fireworkManager.update(dt, elapsed);
  particleSystem.setTime(elapsed);

  postProcessing.render();

  fpsAccum += dt; fpsFrames++;
  if (fpsAccum >= 0.5) {
    fpsEl.textContent = `FPS: ${Math.round(fpsFrames / fpsAccum)}`;
    fpsAccum = 0; fpsFrames = 0;
  }
}

animate();
