/**
 * ExplosionFactory
 *
 * 每一種煙火只是回傳「粒子誕生描述」的一個函式。
 * 之後要新增煙火(柳、冠菊、芯入...等),只要在這裡加一個 case + 一個函式,
 * 完全不需要改動 Renderer / ParticleSystem / FireworkManager。
 *
 * 回傳格式:
 * {
 *   immediate: [...emit參數],           // 立刻要 emit 的粒子
 *   scheduled: [{ delay, build: fn }],  // 延遲觸發的子爆裂(千輪用),
 *                                       // build(fireOrigin) 回傳該時刻的 emit參數陣列
 * }
 */

function randRange(a, b) { return a + Math.random() * (b - a); }

function sphereDir() {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  return {
    x: Math.sin(phi) * Math.cos(theta),
    y: Math.cos(phi),
    z: Math.sin(phi) * Math.sin(theta),
  };
}

// 與 ParticleSystem 的 vertex shader 完全相同的解析公式,
// 用來預測「未來某個時間點」母彈會飛到哪裡(千輪子爆裂用)。
export function predictPosition(spawnPos, vel, gravity, drag, t) {
  let dragX, dragY, dragZ;
  if (drag < 0.0008) {
    dragX = vel.x * t; dragY = vel.y * t; dragZ = vel.z * t;
  } else {
    const f = (1 - Math.exp(-drag * t)) / drag;
    dragX = vel.x * f; dragY = vel.y * f; dragZ = vel.z * f;
  }
  const gy = -gravity * t * t * 0.5;
  return {
    x: spawnPos.x + dragX,
    y: spawnPos.y + dragY + gy,
    z: spawnPos.z + dragZ,
  };
}

function velAt(vel, gravity, drag, t) {
  // 供子爆裂繼承母彈當下的速度感(非必要但視覺上更連貫)
  const decay = Math.exp(-drag * t);
  return {
    x: vel.x * decay,
    y: vel.y * decay - gravity * t,
    z: vel.z * decay,
  };
}

function phoenix(origin, now) {
  const count = 240;
  const immediate = [];
  const palette = ['#FFFFFF', '#FFD700', '#FF8C00'];
  for (let i = 0; i < count; i++) {
    const dir = sphereDir();
    const speed = randRange(30, 190);
    const life = randRange(2.4, 3.6);
    const color = speed > 150 ? palette[0] : speed > 90 ? palette[1] : palette[2];
    immediate.push({
      pos: [origin.x, origin.y, origin.z],
      vel: [dir.x * speed, Math.abs(dir.y) * speed * 0.6 + speed * 0.2, dir.z * speed],
      colorA: hexToArr(color), colorB: hexToArr(color), colorC: hexToArr(color),
      spawnTime: now, life, size: randRange(5, 9), gravity: 70, drag: 1.05, trail: 3,
    });
  }
  return { immediate, scheduled: [] };
}

function giantShell(origin, now) {
  const count = 380;
  const immediate = [];
  const palette = ['#FFFFFF', '#FFD700', '#E35D00'];
  for (let i = 0; i < count; i++) {
    const dir = sphereDir();
    const speed = randRange(60, 240);
    const life = randRange(1.7, 2.6);
    const color = speed > 190 ? palette[0] : speed > 120 ? palette[1] : palette[2];
    immediate.push({
      pos: [origin.x, origin.y, origin.z],
      vel: [dir.x * speed, dir.y * speed, dir.z * speed],
      colorA: hexToArr(color), colorB: hexToArr(color), colorC: hexToArr(color),
      spawnTime: now, life, size: randRange(6, 10), gravity: 110, drag: 1.7, trail: 3,
    });
  }
  return { immediate, scheduled: [] };
}

function senrinPeacock(origin, now) {
  const immediate = [];
  const scheduled = [];

  // 1. 中心金色支撐火花(向上半球,快速衰減)
  for (let k = 0; k < 90; k++) {
    const theta = Math.random() * Math.PI * 2;
    const speed = randRange(20, 110);
    immediate.push({
      pos: [origin.x, origin.y, origin.z],
      vel: [Math.cos(theta) * speed, Math.abs(Math.sin(theta)) * speed, Math.sin(theta) * speed],
      colorA: hexToArr('#FFD700'), colorB: hexToArr('#FFD700'), colorC: hexToArr('#FF8C00'),
      spawnTime: now, life: randRange(1.0, 1.6), size: 4, gravity: 40, drag: 1.3, trail: 2,
    });
  }

  // 2. 母彈射出,飛行一段時間後在預測位置綻放子花
  const motherCount = 26;
  for (let i = 0; i < motherCount; i++) {
    const angle = (i / motherCount) * Math.PI * 2 + Math.random() * 0.15;
    const elev = randRange(-0.15, 0.5);
    const speed = randRange(90, 170);
    const vel = {
      x: Math.cos(angle) * speed,
      y: Math.sin(elev) * speed,
      z: Math.sin(angle) * speed,
    };
    const motherGravity = 55;
    const motherDrag = 0.9;
    const delay = randRange(0.55, 0.85);

    // 可見的母彈拖尾(短命,飛行期間看得到紅色光點在移動)
    immediate.push({
      pos: [origin.x, origin.y, origin.z],
      vel: [vel.x, vel.y, vel.z],
      colorA: hexToArr('#FF4400'), colorB: hexToArr('#FF4400'), colorC: hexToArr('#FF4400'),
      spawnTime: now, life: delay, size: 4.5, gravity: motherGravity, drag: motherDrag, trail: 3,
    });

    scheduled.push({
      delay,
      build: (fireNow) => {
        const flowerOrigin = predictPosition(origin, vel, motherGravity, motherDrag, delay);
        const palette = ['#FF1493', '#1E90FF', '#32CD32', '#FFD700', '#D87093', '#FFFFFF'];
        const flowerColor = palette[i % palette.length];
        const petals = [];
        const petalCount = 32;
        for (let j = 0; j < petalCount; j++) {
          const dir = sphereDir();
          const pSpeed = randRange(10, 55);
          petals.push({
            pos: [flowerOrigin.x, flowerOrigin.y, flowerOrigin.z],
            vel: [dir.x * pSpeed, dir.y * pSpeed, dir.z * pSpeed],
            colorA: hexToArr(flowerColor), colorB: hexToArr(flowerColor), colorC: hexToArr('#FFFFFF'),
            spawnTime: fireNow, life: randRange(2.2, 3.4), size: 3.2, gravity: 35, drag: 1.15, trail: 3,
          });
        }
        return petals;
      },
    });
  }

  return { immediate, scheduled };
}

function colorChangeChrysanthemum(origin, now) {
  const count = 300;
  const immediate = [];
  for (let i = 0; i < count; i++) {
    const dir = sphereDir();
    const speed = randRange(50, 210);
    immediate.push({
      pos: [origin.x, origin.y, origin.z],
      vel: [dir.x * speed, dir.y * speed, dir.z * speed],
      colorA: hexToArr('#FF3333'), colorB: hexToArr('#3366FF'), colorC: hexToArr('#FFFFFF'),
      spawnTime: now, life: randRange(2.6, 3.6), size: 4.5, gravity: 90, drag: 1.5, trail: 3,
    });
  }
  return { immediate, scheduled: [] };
}

function hexToArr(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// 每一顆爆炸也會 emit 一顆「巨大、極短命」的白色粒子模擬閃光衝擊 —— 共用同一套 GPU 系統
function flash(origin, now) {
  return {
    pos: [origin.x, origin.y, origin.z],
    vel: [0, 0, 0],
    colorA: [1, 1, 1], colorB: [1, 0.9, 0.7], colorC: [1, 0.7, 0.4],
    spawnTime: now, life: 0.18, size: 90, gravity: 0, drag: 0,
  };
}

const RECIPES = {
  phoenix: phoenixWithFlash,
  giant: giantWithFlash,
  senrin: senrinWithFlash,
  colorChange: colorChangeWithFlash,
};

function withFlash(recipeFn) {
  return (origin, now) => {
    const result = recipeFn(origin, now);
    result.immediate.push(flash(origin, now));
    return result;
  };
}

function phoenixWithFlash(o, n) { return withFlash(phoenix)(o, n); }
function giantWithFlash(o, n) { return withFlash(giantShell)(o, n); }
function senrinWithFlash(o, n) { return withFlash(senrinPeacock)(o, n); }
function colorChangeWithFlash(o, n) { return withFlash(colorChangeChrysanthemum)(o, n); }

export class ExplosionFactory {
  /**
   * @param type 'phoenix' | 'giant' | 'senrin' | 'colorChange' | 未來新增的種類
   * @param origin {x,y,z} 爆炸中心
   * @param now 目前時間(秒,對應 ParticleSystem 的時間軸)
   */
  static create(type, origin, now) {
    const recipe = RECIPES[type];
    if (!recipe) {
      console.warn(`[ExplosionFactory] 未知的煙火類型: ${type}`);
      return { immediate: [flash(origin, now)], scheduled: [] };
    }
    return recipe(origin, now);
  }

  /** 新增自訂煙火類型(供未來擴充,例如柳、冠菊、芯入...) */
  static register(type, recipeFn, useFlash = true) {
    RECIPES[type] = useFlash ? withFlash(recipeFn) : recipeFn;
  }
}
