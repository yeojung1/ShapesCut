// ShapeCutter.js
// - 마우스로 화면을 그어서 도형을 절단

(function () {
  console.log('ShapeCutter.js loaded', window.scene, window.renderer);

  // ShapesMove.js에서 올려둔 전역 참조를 "로컬 상수"로 복사
  const scene = window.scene;
  const camera = window.camera;
  const W = window.W;
  const H = window.H;
  const HALF_W = window.HALF_W;
  const HALF_H = window.HALF_H;
  const renderer = window.renderer;
  const shapes = window.shapes;
  const freezeFor = window.freezeFor;
  const createExplosion = window.createExplosion;

  // 방어: 필수 전역이 없으면 바로 에러 로그 찍고 종료
  if (!scene || !camera || !renderer || !shapes) {
    console.error('ShapeCutter 초기화 실패: scene/camera/renderer/shapes 중 일부가 없습니다.', {
      scene, camera, renderer, shapes
    });
    return;
  }

  // =========================
  // 상태
  // =========================
  let isDrawing = false;
  let startPoint = null;
  let score = 0;

  const scoreElement = document.querySelector('.ui-score');
  const mouse = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const container = document.getElementById('game-container');
  const comboText = document.getElementById('combo-text');

  let guideLine = null;

  let combo = 0;
  let comboRestTimer = 400;
  let frozenTimer = 100;

  // =========================
  // 점수 UI
  // =========================
  function updateScoreUI() {
    if (scoreElement) scoreElement.textContent = `SCORE: ${score}`;
    localStorage.setItem('lastScore', String(score));
  }

  function resetCombo() {
    combo = 0;
    const gameContainer = document.getElementById('game-container');
    if (!gameContainer) return;

    gameContainer.classList.add('combo-reset');
    setTimeout(() => {
      gameContainer.classList.remove('combo-reset');
    }, comboRestTimer);
  }

  function showComboText() {
    if (!comboText) return;

    comboText.textContent = `x${combo} COMBO!`;
    comboText.style.opacity = 1;
    comboText.style.transform = 'scale(1.2)';
    setTimeout(() => {
      comboText.style.opacity = 0;
      comboText.style.transform = 'scale(1)';
    }, 300);
  }

  // =========================
  // 좌표 유틸
  // =========================
  function isInsideContainer(event) {
    if (!container) return false;
    const rect = container.getBoundingClientRect();
    const x = event.clientX;
    const y = event.clientY;
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function getWorldCoordinates(event) {
    const rect = container.getBoundingClientRect();

    const clientX = THREE.MathUtils.clamp(
      event.clientX - rect.left,
      0,
      rect.width
    );
    const clientY = THREE.MathUtils.clamp(
      event.clientY - rect.top,
      0,
      rect.height
    );

    mouse.x = (clientX / W) * 2 - 1;
    mouse.y = -(clientY / H) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const worldPos = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, worldPos);

    return worldPos;
  }

  // =========================
  // 마우스 이벤트
  // =========================
  function onMouseDown(event) {
    if (event.button !== 0) return;
    if (window.isFrozen) return;
    if (!isInsideContainer(event)) return;
    if (event.target !== renderer.domElement) return;

    isDrawing = true;
    startPoint = getWorldCoordinates(event);

    const geometry = new THREE.BufferGeometry().setFromPoints([
      startPoint.clone(),
      startPoint.clone()
    ]);
    const material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.6,
      linewidth: 3
    });
    guideLine = new THREE.Line(geometry, material);
    scene.add(guideLine);
  }

  function onMouseMove(event) {
    if (!isDrawing || !guideLine) return;

    const currentPoint = getWorldCoordinates(event);
    const positions = guideLine.geometry.attributes.position.array;

    positions[0] = startPoint.x; positions[1] = startPoint.y; positions[2] = startPoint.z;
    positions[3] = currentPoint.x; positions[4] = currentPoint.y; positions[5] = currentPoint.z;

    guideLine.geometry.attributes.position.needsUpdate = true;
  }

  function cleanupGuide() {
    if (guideLine) {
      scene.remove(guideLine);
      guideLine.geometry.dispose();
      guideLine.material.dispose();
      guideLine = null;
    }
  }

  function onMouseUp(event) {
    if (!isDrawing) return;
    if (event.button !== 0) return;

    const endPoint = getWorldCoordinates(event);

    cleanupGuide();

    if (startPoint && startPoint.distanceTo(endPoint) > 5) {
      drawLine(startPoint, endPoint);
    }

    isDrawing = false;
    startPoint = null;
  }

  // =========================
  // 화면 범위 체크
  // =========================
  function isInsideView(obj) {
    return (
      obj.position.x >= -HALF_W && obj.position.x <= HALF_W &&
      obj.position.y >= -HALF_H && obj.position.y <= HALF_H
    );
  }

  function watchOutOfBounds() {
    for (const s of shapes) {

      if (!s._enteredView && isInsideView(s)) {
        s._enteredView = true;
      }

      if (s.isBomb) continue;

      if (s._enteredView && !isInsideView(s) && !s.isCutDestroyed && !s.isDestroyed && !s._comboOut) {
        resetCombo();
        s._comboOut = true;
      }
    }

    requestAnimationFrame(watchOutOfBounds);
  }

  requestAnimationFrame(watchOutOfBounds);
  window.addEventListener('mouseup', onMouseUp, true);

  // =========================
  // 절단선 + 충돌 처리
  // =========================
  function drawLine(p1, p2) {
    const TAPER_SEGMENTS = 100;
    const MAX_LINE_WIDTH = 10;
    const NOISE_INTENSITY = 3;
    const WHITE_COLOR = 0xffffff;

    const lineGroup = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({
      color: WHITE_COLOR,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1.0
    });

    const direction = new THREE.Vector3().subVectors(p2, p1).normalize();
    const perpendicular = new THREE.Vector3(-direction.y, direction.x, 0).normalize();

    for (let i = 0; i < TAPER_SEGMENTS; i++) {
      const t0 = i / TAPER_SEGMENTS;
      const t1 = (i + 1) / TAPER_SEGMENTS;

      const t_mod0 = 4 * t0 * (1 - t0);
      const t_mod1 = 4 * t1 * (1 - t1);

      const width = MAX_LINE_WIDTH * Math.max(0, t_mod0);
      const nextWidth = MAX_LINE_WIDTH * Math.max(0, t_mod1);

      const center = new THREE.Vector3().lerpVectors(p1, p2, t0);
      const nextCenter = new THREE.Vector3().lerpVectors(p1, p2, t1);

      const noise = new THREE.Vector3(
        (Math.random() - 0.5) * NOISE_INTENSITY,
        (Math.random() - 0.5) * NOISE_INTENSITY,
        0
      );
      center.add(noise);

      const geometry = new THREE.BufferGeometry();
      const positions = [];

      const v1 = new THREE.Vector3().copy(center).addScaledVector(perpendicular,  width / 2);
      const v2 = new THREE.Vector3().copy(center).addScaledVector(perpendicular, -width / 2);
      const v3 = new THREE.Vector3().copy(nextCenter).addScaledVector(perpendicular,  nextWidth / 2);
      const v4 = new THREE.Vector3().copy(nextCenter).addScaledVector(perpendicular, -nextWidth / 2);

      positions.push(
        v1.x, v1.y, v1.z,  v2.x, v2.y, v2.z,  v3.x, v3.y, v3.z,
        v2.x, v2.y, v2.z,  v4.x, v4.y, v4.z,  v3.x, v3.y, v3.z
      );

      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(positions, 3)
      );
      geometry.computeVertexNormals();

      const segmentMesh = new THREE.Mesh(geometry, material);
      lineGroup.add(segmentMesh);
    }

    scene.add(lineGroup);

    const collidedShapes = new Set();

    const SAMPLES_ALONG = 40;
    const SAMPLES_ACROSS = 3;
    const halfWidth = MAX_LINE_WIDTH * 0.5;

    const originZ = camera.position.z;
    const rayDir = new THREE.Vector3(0, 0, -1);

    const candidates = shapes.filter(s => !s.isCutDestroyed);

    for (let i = 0; i <= SAMPLES_ALONG; i++) {
      const t = i / SAMPLES_ALONG;
      const centerOnLine = new THREE.Vector3().lerpVectors(p1, p2, t);

      for (let a = 0; a < SAMPLES_ACROSS; a++) {
        const acrossRatio =
          (a - Math.floor(SAMPLES_ACROSS / 2)) /
          Math.max(1, Math.floor(SAMPLES_ACROSS / 2));
        const offset = isFinite(acrossRatio) ? acrossRatio * halfWidth : 0;

        const sample = new THREE.Vector3()
          .copy(centerOnLine)
          .addScaledVector(perpendicular, offset);

        raycaster.ray.origin.set(sample.x, sample.y, originZ);
        raycaster.ray.direction.copy(rayDir);

        for (const shape of candidates) {
          if (collidedShapes.has(shape)) continue;

          const intersects = raycaster.intersectObject(shape, true);
          if (intersects.length > 0) {
            collidedShapes.add(shape);
          }
        }
      }
    }

    if (collidedShapes.size > 0) {
      let nonBombHit = false;

      for (const shape of collidedShapes) {
        createExplosion(shape.position.clone());

        shape.isCutDestroyed = true;
        scene.remove(shape);
        shape.isDestroyed = true;
        shape.visible = false;

        if (shape.isBomb) {
          score -= 10;
          if (score < 0) score = 0;
          updateScoreUI();
          const gameContainer = document.getElementById('game-container');
          if (!gameContainer) return;

          gameContainer.classList.add('combo-reset');
          resetCombo();

          setTimeout(() => {
            gameContainer.classList.remove('combo-reset');
          }, comboRestTimer);
        } else {
          nonBombHit = true;
        }
      }

      if (nonBombHit) {
        combo += 1;
        showComboText();

        const gained = [...collidedShapes].filter(s => !s.isBomb).length * combo;
        score += gained;
        updateScoreUI();

        freezeFor(frozenTimer);
      }
    }

    setTimeout(() => {
      scene.remove(lineGroup);
      lineGroup.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
      });
      material.dispose();
    }, 200);
  }

  // =========================
  // 이벤트 등록
  // =========================
  if (renderer && renderer.domElement) {
    renderer.domElement.addEventListener('mousedown', onMouseDown, false);
    renderer.domElement.addEventListener('mousemove', onMouseMove, false);
    renderer.domElement.addEventListener('mouseup',   onMouseUp,   false);

    renderer.domElement.addEventListener(
      'mouseleave',
      () => {
        if (isDrawing && guideLine) cleanupGuide();
      },
      false
    );
  }
})();   // ← IIFE 끝
