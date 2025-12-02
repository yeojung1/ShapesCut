// ShapesMove.js
// three.js는 index.html에서 CDN으로 로드됨
console.log('ShapesMove.js loaded, THREE =', typeof THREE);

const NEON_BLUE = 0x0088FF;
const Shape_Color = 0x55AAFF;
const BLACK_BG = 0x000000;
const BOMB_COLOR = 0xFF3333;

const W = 1280;
const H = 640;
const HALF_W = W / 2;
const HALF_H = H / 2;
const START_Y = -640;

window.W = W;
window.H = H;
window.HALF_W = HALF_W;
window.HALF_H = HALF_H;

// 난이도 / 스폰 관련
let elapsedTime = 0;
const MAX_SPEED_MULTIPLIER = 1.2;
const TOTAL_DURATION = 60;

let spawnTimer = 0;
let pinTimer = 0;
let bombTimer = 0;

const SPAWN_INTERVAL_START = 2.0;
const SPAWN_INTERVAL_END = 0.7;

// =========================
// Three.js 기본 세팅
// =========================
const scene = new THREE.Scene();
window.scene = scene;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
window.renderer = renderer;

const container = document.getElementById('game-container');
if (container) {
  container.appendChild(renderer.domElement);
} else {
  document.body.appendChild(renderer.domElement);
}

const camera = new THREE.OrthographicCamera(
  -HALF_W,
  HALF_W,
  HALF_H,
  -HALF_H,
  1,
  1000
);
camera.position.z = 500;
window.camera = camera;

const shapes = [];
window.shapes = shapes;

window.isFrozen = false;
let running = true;

// 물리
const G_GAME = 1500.0;
const V0_MIN = 1400.0;
const V0_MAX = 1600.0;

function getRandomInitialVelocity() {
  return V0_MIN + Math.random() * (V0_MAX - V0_MIN);
}

// 타이머
let remainingTime = 60;
const timerElement = document.querySelector('.ui-timer');
let timerInterval = null;

let animId = null;

// =========================
// 일시정지 / 재개
// =========================
function pauseGame() {
  if (!running) return;

  running = false;
  window.isFrozen = true;

  if (animId) cancelAnimationFrame(animId);

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function resumeGame() {
  if (running) return;

  running = true;
  window.isFrozen = false;

  lastTime = performance.now();
  startTimer();
  animate(performance.now());
}

window.resumeGame = resumeGame;

// =========================
// 타이머
// =========================
function startTimer() {
  if (timerInterval) return;
  if (!timerElement) return;

  timerInterval = setInterval(() => {
    remainingTime--;

    if (remainingTime < 0) {
      pauseGame();
      window.openOverlay?.('result');
      return;
    }

    const minutes = Math.floor(remainingTime / 60);
    const seconds = remainingTime % 60;
    timerElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, 1000);
}

// =========================
// UI: 일시정지 버튼
// =========================
const pauseBtn = document.querySelector('.ui-button');
if (pauseBtn) {
  pauseBtn.addEventListener('click', () => {
    pauseGame();
    window.openOverlay?.('stop_menu');
  });
}

// =========================
// 도형 클래스
// =========================
class BouncingShape extends THREE.Mesh {
  constructor(type) {
    const size = 90;
    let geometry;

    switch (type) {
      case 'tetrahedron':
        geometry = new THREE.TetrahedronGeometry(size - 10);
        break;
      case 'sphere':
        geometry = new THREE.SphereGeometry((size + 15) / 2, 32, 16);
        break;
      case 'cube':
      default:
        geometry = new THREE.BoxGeometry(size, size, size);
    }

    const material = new THREE.MeshStandardMaterial({
      color: NEON_BLUE,
      emissive: NEON_BLUE,
      emissiveIntensity: 1.0,
      roughness: 0.4
    });

    super(geometry, material);

    const glowMaterial = new THREE.MeshBasicMaterial({
      color: NEON_BLUE,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.4,
      depthWrite: false
    });

    this.glowMesh = new THREE.Mesh(geometry.clone(), glowMaterial);
    this.glowMesh.scale.multiplyScalar(1.15);
    this.add(this.glowMesh);

    this.velocity_y = getRandomInitialVelocity();
    this.position.x = 200 + Math.random() * (1080 - 200) - HALF_W;
    this.position.y = START_Y;
    this.position.z = 0;

    this.angularVelocity = new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2
    );

    this.castShadow = true;
    this.receiveShadow = true;

    this.isDestroyed = false;
    this.isCutDestroyed = false;
  }

  update(deltaTime) {
    this.velocity_y -= G_GAME * deltaTime;
    this.position.y += this.velocity_y * deltaTime;

    this.rotation.x += this.angularVelocity.x * deltaTime;
    this.rotation.y += this.angularVelocity.y * deltaTime;
    this.rotation.z += this.angularVelocity.z * deltaTime;

    this.angularVelocity.multiplyScalar(0.995);

    if (Math.random() < 0.01) {
      this.angularVelocity.x += (Math.random() - 0.5) * 0.2;
      this.angularVelocity.y += (Math.random() - 0.5) * 0.2;
      this.angularVelocity.z += (Math.random() - 0.5) * 0.2;
    }

    if (this.position.y < START_Y && this.velocity_y < 0) {
      this.isDestroyed = true;
    }
  }
}

class BombShape extends BouncingShape {
  constructor() {
    super('sphere');

    if (this.material) {
      this.material.color.setHex(BOMB_COLOR);
      this.material.emissive.setHex(BOMB_COLOR);
    }

    if (this.glowMesh && this.glowMesh.material) {
      this.glowMesh.material.color.setHex(BOMB_COLOR);
    }

    this.isBomb = true;
  }
}

// =========================
// 폭발 파티클
// =========================
const explosionParticles = [];
const PARTICLE_GEOMETRY = new THREE.SphereGeometry(10, 8, 8);

class ExplosionParticle extends THREE.Mesh {
  constructor(position) {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      transparent: true,
      opacity: 1.0,
      emissiveIntensity: 1.0,
      roughness: 0.4
    });
    super(PARTICLE_GEOMETRY, material);

    this.position.copy(position);

    const speed = 200 + Math.random() * 400;
    const dir = new THREE.Vector3(
      (Math.random() - 0.5),
      (Math.random() - 0.5),
      (Math.random() - 0.5) * 0.3
    ).normalize();

    this.velocity = dir.multiplyScalar(speed);

    this.lifetime = 0.3 + Math.random() * 0.2;
    this.age = 0;

    const s = 1.0 + Math.random() * 0.5;
    this.scale.set(s, s, s);
    this.initialScale = s;
  }

  update(dt) {
    this.age += dt;
    this.position.addScaledVector(this.velocity, dt);

    const t = this.age / this.lifetime;
    const scale = this.initialScale * (1 - t);

    this.scale.set(
      Math.max(scale, 0),
      Math.max(scale, 0),
      Math.max(scale, 0)
    );
  }

  get isDead() {
    return this.age >= this.lifetime;
  }
}

function createExplosion(position, count = 16) {
  for (let i = 0; i < count; i++) {
    const p = new ExplosionParticle(position);
    explosionParticles.push(p);
    scene.add(p);
  }
}
window.createExplosion = createExplosion;

function freezeFor(ms = 200) {
  window.isFrozen = true;
  window.setTimeout(() => {
    window.isFrozen = false;
  }, ms);
}
window.freezeFor = freezeFor;

// 조명
const mainLight = new THREE.DirectionalLight(0xffffff, 1.0);
mainLight.position.set(-300, 500, 400);
mainLight.castShadow = true;
scene.add(mainLight);

const backLight = new THREE.DirectionalLight(0xffffff, 0.4);
backLight.position.set(300, -400, -500);
scene.add(backLight);

const ambient = new THREE.AmbientLight(0xffffff, 0.15);
scene.add(ambient);

// 스폰
function spawnShape() {
  const types = ['tetrahedron', 'sphere', 'cube'];
  const randomType = types[Math.floor(Math.random() * types.length)];
  const newShape = new BouncingShape(randomType);
  shapes.push(newShape);
  scene.add(newShape);
}

function spawnBomb() {
  const bomb = new BombShape();
  shapes.push(bomb);
  scene.add(bomb);
}
window.spawnBomb = spawnBomb;

// 메인 루프
let lastTime = 0;

function animate(time) {
  if (!running) return;

  animId = requestAnimationFrame(animate);

  const deltaTime = (time - lastTime) / 1000;
  lastTime = time;

  const timelineDelta = window.isFrozen ? 0 : deltaTime;

  elapsedTime += timelineDelta;

  const progress = Math.min(elapsedTime / TOTAL_DURATION, 1);

  const speedMultiplier =
    1.0 + (MAX_SPEED_MULTIPLIER - 1.0) * progress;

  const currentSpawnInterval =
    SPAWN_INTERVAL_START -
    (SPAWN_INTERVAL_START - SPAWN_INTERVAL_END) * progress;

  spawnTimer += timelineDelta;
  pinTimer += timelineDelta;
  bombTimer += timelineDelta;

  if (spawnTimer >= currentSpawnInterval) {
    spawnShape();
    spawnTimer = 0;
  }

  if (pinTimer >= currentSpawnInterval * 0.6) {
    spawnShape();
    pinTimer = 0;
  }

  if (bombTimer >= currentSpawnInterval * 1.2) {
    spawnBomb();
    bombTimer = 0;
  }

  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i];

    if (!window.isFrozen) {
      shape.update(deltaTime * speedMultiplier);
    }

    if (shape.isDestroyed) {
      scene.remove(shape);
      shapes.splice(i, 1);
    }
  }

  for (let i = explosionParticles.length - 1; i >= 0; i--) {
    const p = explosionParticles[i];

    if (!window.isFrozen) {
      p.update(deltaTime);
    }

    if (p.isDead) {
      scene.remove(p);
      p.material.dispose();
      explosionParticles.splice(i, 1);
    }
  }

  renderer.render(scene, camera);
}

// 시작
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', startTimer, { once: true });
} else {
  startTimer();
}

animate(0);
