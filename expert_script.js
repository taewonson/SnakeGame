// expert_script.js
(function (global) {
  const SnakeExpert = {
    init,
    destroy,
    onDifficultyChanged
  };

  global.SnakeGames = global.SnakeGames || {};
  global.SnakeGames.expert = SnakeExpert;

  let opt = {};
  let canvas, ctx;
  let startBtn, stopBtn, scoreEl, modeEl, diffEl, diffRadios;
  let toastFn;

  const tileCount = 25;
  let tileSize;

  let snake = [];
  let apple = null;

  let vx = 1, vy = 0;
  let nextVx = 1, nextVy = 0;
  let headDx = 1, headDy = 0;

  let isRunning = false;
  let isPaused = false;
  let isGameOver = false;

  let baseTickMs = 120;
  let currentTickMs = 120;
  let gameLoopId = null;

  let difficulty = "normal"; // easy / normal / hard
  let speedMul = 1.0;        // 난이도 기본 속도 계수

  let applesSinceEvent = 0;
  let score = 0;

  // 속도 계수 (1.0=100%), 커질수록 "더 빠름"
  // 실제 틱 간격 = baseTickMs * speedMul / speedFactor
  let speedFactor = 1.0; // 0.8 ~ 1.2 (최소 80%, 최대 120%)

  let obstacles = new Set();      // Set("x,y")
  let previewObstacles = [];      // [{x,y}]
  let mine = null;                // {x,y}
  let mineTick = 0;

  let items = [];                 // [{type,x,y}]
  let portalEdge = null;          // {axis: "horizontal"|"vertical", used}
  let isPhasing = false;
  let phaseExit = null;

  let bombHighlights = [];        // [{x,y,ttl}]
  let warningActive = false;

  let upcomingHazard = null;      // "obstacle" | "mine" | "speed"
  let upcomingItem = null;        // "bomb" | "superbomb" | "shrink" | "teleport" | "phase"
  let upcomingSpeedDelta = null;  // 예고된 속도 변화량 (±0.1, ±0.2)

  let keyHandler = null;

  // HUD 메시지
  let hudMessage = "";
  let hudTimer = 0; // tick마다 감소

  // 게임 오버 직후 재시작 방지용
  let lastGameOverTime = 0;

  function showHUD(msg) {
    hudMessage = msg;
    hudTimer = 30; // 짧게 표시
  }

  // 현재 난이도에 따른 이벤트 간격
  function getSpawnInterval() {
    if (difficulty === "easy") return 7;
    if (difficulty === "hard") return 3;
    return 5; // normal
  }

  // ================= 초기화 / 파괴 =================

  function init(options) {
    opt = options;
    canvas = opt.canvas;
    ctx = canvas.getContext('2d');
    startBtn = opt.startBtn;
    stopBtn = opt.stopBtn;
    scoreEl = opt.scoreEl;
    modeEl = opt.modeEl;
    diffEl = opt.diffEl;
    diffRadios = opt.diffRadios;
    toastFn = opt.toast || function () { };

    modeEl.textContent = "Expert";
    tileSize = canvas.width / tileCount;

    startBtn.addEventListener('click', onClickStart);
    stopBtn.addEventListener('click', onClickStop);

    keyHandler = onKeyDown;
    document.addEventListener('keydown', keyHandler);

    updateDifficultyConfig();
    resetGame();
  }

  function destroy() {
    if (gameLoopId !== null) {
      clearInterval(gameLoopId);
      gameLoopId = null;
    }
    document.removeEventListener('keydown', keyHandler);
    startBtn.removeEventListener('click', onClickStart);
    stopBtn.removeEventListener('click', onClickStop);
  }

  function onDifficultyChanged() {
    updateDifficultyConfig();
    if (!isRunning) {
      computeTickInterval();
      draw();
    }
  }

  // ================= 난이도 / 속도 =================

  function updateDifficultyConfig() {
    const checked = [...diffRadios].find(r => r.checked);
    difficulty = checked ? checked.value : "normal";

    // easy: 느림, hard: 빠름
    if (difficulty === 'easy') {
      speedMul = 1.1;
    } else if (difficulty === 'hard') {
      speedMul = 0.9;
    } else {
      speedMul = 1.0;
    }

    diffEl.textContent = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
    computeTickInterval();
  }

  function computeTickInterval() {
    // ★ 속도 계수는 "빠르기" 기준.
    // speedFactor가 커질수록 더 빠르게 하기 위해 나눗셈 사용
    currentTickMs = baseTickMs * speedMul / speedFactor;

    if (gameLoopId !== null) {
      clearInterval(gameLoopId);
      gameLoopId = setInterval(tick, currentTickMs);
    }
  }

  // 실제 속도 이벤트 적용: 누적 구조 (10% 단위, ±0.1 / ±0.2)
  function applyScheduledSpeedChange() {
    // WARNING 단계에서 이미 upcomingSpeedDelta를 정해뒀으면 그대로 사용
    if (upcomingSpeedDelta == null) {
      // 혹시라도 경고 없이 바로 속도 이벤트가 걸릴 때 대비 (동일 규칙)
      const steps = [-2, -1, 1, 2];      // -20%, -10%, +10%, +20%
      upcomingSpeedDelta = choice(steps) * 0.1;
    }

    // 이번에 "적용하려는" 변화량을 그대로 보관 (부호 고정)
    const plannedDelta = upcomingSpeedDelta;   // -0.2, -0.1, +0.1, +0.2
    const oldFactor = speedFactor;

    // 실제 적용 (누적 + 0.8~1.2 클램핑)
    let newFactor = speedFactor + plannedDelta;
    if (newFactor > 1.2) newFactor = 1.2;
    if (newFactor < 0.8) newFactor = 0.8;
    speedFactor = newFactor;

    // 실제 틱 간격 재설정
    computeTickInterval();

    const actualDeltaPercent = Math.round((speedFactor - oldFactor) * 100);
    const currentPercent = Math.round(speedFactor * 100);

    // 표시용 퍼센트: "예정 변화량" 기준으로 표기 (부호가 WARNING과 반드시 일치)
    let diffPercent = Math.round(plannedDelta * 100);   // -20, -10, 10, 20

    if (actualDeltaPercent === 0) {
      // 하한/상한에 걸려서 실제로는 안 바뀐 경우
      showHUD(`속도 변경 적용: 변화 없음 (현재 ${currentPercent}%)`);
    } else {
      const sign = diffPercent > 0 ? "+" : "";   // 음수는 숫자 자체에 - 포함
      showHUD(`속도 변경 적용: ${sign}${diffPercent}% (현재 ${currentPercent}%)`);
    }

    // 한 번 쓴 예정값은 소모
    upcomingSpeedDelta = null;
  }

  // ================= 게임 상태 =================

  function resetGame() {
    const cx = Math.floor(tileCount / 2);
    const cy = Math.floor(tileCount / 2);
    // 시작 길이 2칸 (오른쪽 진행)
    snake = [
      { x: cx + 1, y: cy },  // 머리
      { x: cx,     y: cy }   // 꼬리
    ];
    vx = 1; vy = 0;
    nextVx = 1; nextVy = 0;
    headDx = 1; headDy = 0;

    isRunning = false;
    isPaused = false;
    isGameOver = false;

    applesSinceEvent = 0;
    score = 0;
    speedFactor = 1.0; // 100%로 리셋
    warningActive = false;
    upcomingHazard = null;
    upcomingItem = null;
    upcomingSpeedDelta = null;
    hudMessage = "";
    hudTimer = 0;

    updateScoreUI();

    obstacles.clear();
    previewObstacles = [];
    mine = null;
    mineTick = 0;
    items = [];
    portalEdge = null;
    isPhasing = false;
    phaseExit = null;
    bombHighlights = [];

    placeApple();
    computeTickInterval();
    draw();
  }

  function startNewGame() {
    resetGame();
    isRunning = true;
    if (gameLoopId !== null) clearInterval(gameLoopId);
    gameLoopId = setInterval(tick, currentTickMs);
  }

  function stopGameAsOver() {
    if (!isGameOver) {
      gameOver();
    }
  }

  function pauseGame() {
    if (!isRunning || isPaused) return;
    isPaused = true;
    if (gameLoopId !== null) {
      clearInterval(gameLoopId);
      gameLoopId = null;
    }
    draw();
  }

  function resumeGame() {
    if (!isRunning || !isPaused || isGameOver) return;
    isPaused = false;
    computeTickInterval();
    gameLoopId = setInterval(tick, currentTickMs);
  }

  function onClickStart() {
    // Start: 처음 시작 or 재시작만, 일시정지 해제 X
    if (!isRunning || isGameOver) {
      startNewGame();
    }
  }

  function onClickStop() {
    // Stop: 강제 GAME OVER
    stopGameAsOver();
  }

  // ================= 입력 =================

  function onKeyDown(e) {
    const key = e.key;

    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," ","Escape"].includes(key)) {
      e.preventDefault();
    }

    if (key === 'Escape') {
      if (isRunning && !isPaused) {
        pauseGame();
      } else if (isRunning && isPaused) {
        resumeGame();
      }
      return;
    }

    const dirMap = {
      ArrowUp:    { dx: 0, dy: -1 },
      ArrowDown:  { dx: 0, dy: 1 },
      ArrowLeft:  { dx: -1, dy: 0 },
      ArrowRight: { dx: 1, dy: 0 }
    };
    if (!(key in dirMap)) return;
    const { dx, dy } = dirMap[key];

    if (!isRunning && !isGameOver) {
      startNewGame();
    } else if (isGameOver) {
      if (Date.now() - lastGameOverTime < 200) return;
      startNewGame();
    } else if (isPaused) {
      resumeGame();
    }

    if (dx === -vx && dy === -vy) return;
    if (dx === -nextVx && dy === -nextVy) return;

    nextVx = dx;
    nextVy = dy;
    headDx = dx;
    headDy = dy;
  }

  // ================= 유틸 =================

  function posKey(x, y) {
    return `${x},${y}`;
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function choice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function updateScoreUI() {
    scoreEl.textContent = String(score);
  }

  function randomEmptyCell() {
    let x, y, key;
    let safety = 0;
    do {
      x = randomInt(0, tileCount - 1);
      y = randomInt(0, tileCount - 1);
      key = posKey(x, y);
      safety++;
      if (safety > 1000) break;
    } while (
      snake.some(seg => seg.x === x && seg.y === y) ||
      obstacles.has(key) ||
      (mine && mine.x === x && mine.y === y) ||
      items.some(it => it.x === x && it.y === y)
    );
    return { x, y };
  }

  // ================= 사과 / 점수 =================

  function placeApple() {
    apple = randomEmptyCell();
  }

  function handleAppleEaten() {
    score++;
    updateScoreUI();
    applesSinceEvent++;

    // "다음 사과를 먹을 때까지 유지" → 여기서 지뢰 제거
    if (mine) {
      mine = null;
    }

    const interval = getSpawnInterval();

    // 이벤트 1개 전: WARNING + 예고
    if (applesSinceEvent === interval - 1 && !upcomingHazard && !upcomingItem) {
      warningActive = true;
      upcomingHazard = choice(["obstacle", "mine", "speed"]);
      upcomingItem   = choice(["bomb", "superbomb", "shrink", "teleport", "phase"]);
      upcomingSpeedDelta = null;

      if (upcomingHazard === "obstacle") {
        spawnObstaclePreview();
        showHUD("WARNING! 다음 사과 후 장애물이 생성됩니다.");
      } else if (upcomingHazard === "mine") {
        showHUD("WARNING! 다음 사과 후 지뢰가 생성됩니다.");
      } else {
        // ★ 속도 이벤트: 10% 단위 변화량만 미리 계산
        const steps = [-2, -1, 1, 2];      // -20, -10, +10, +20
        const delta = choice(steps) * 0.1; // -0.2, -0.1, +0.1, +0.2

        upcomingSpeedDelta = delta;        // "예정" 값 저장

        const previewFactor = Math.max(0.8, Math.min(1.2, speedFactor + delta));
        const diffPercent = Math.round(delta * 100);          // -20, -10, 10, 20
        const previewPercent = Math.round(previewFactor * 100);
        const sign = diffPercent > 0 ? "+" : "";
        showHUD(`WARNING! 다음 사과 후 속도 ${sign}${diffPercent}% (적용 후: ${previewPercent}%)`);
      }
      placeApple();
      return;
    }

    // 이벤트 실제 발생
    if (applesSinceEvent >= interval) {
      applesSinceEvent = 0;
      warningActive = false;
      applyUpcomingHazardAndItem();
      placeApple();
      return;
    }

    placeApple();
  }

  function applyUpcomingHazardAndItem() {
    if (!upcomingHazard) {
      upcomingHazard = choice(["obstacle", "mine", "speed"]);
    }
    if (!upcomingItem) {
      upcomingItem = choice(["bomb", "superbomb", "shrink", "teleport", "phase"]);
    }

    // 위험요소 적용
    if (upcomingHazard === "obstacle") {
      for (const p of previewObstacles) {
        const key = posKey(p.x, p.y);
        obstacles.add(key);
        // 아이템 겹치면 아이템 제거
        items = items.filter(it => !(it.x === p.x && it.y === p.y));
      }
      previewObstacles = [];
    } else if (upcomingHazard === "mine") {
      spawnMine();
    } else {
      applyScheduledSpeedChange(); // 여기서만 실제 speedFactor 변경
    }

    // 아이템 생성
    spawnItem(upcomingItem);

    upcomingHazard = null;
    upcomingItem = null;
    upcomingSpeedDelta = null;
  }

  // ================= 위험요소 / 아이템 =================

  function isCellFreeForObstacle(x, y) {
    if (x < 0 || x >= tileCount || y < 0 || y >= tileCount) return false;
    const k = posKey(x, y);
    if (obstacles.has(k)) return false;
    if (apple && apple.x === x && apple.y === y) return false;
    if (snake.some(seg => seg.x === x && seg.y === y)) return false;
    if (mine && mine.x === x && mine.y === y) return false;
    if (items.some(it => it.x === x && it.y === y)) return false;
    return true;
  }

  function spawnObstaclePreview() {
    previewObstacles = [];

    const patterns = [
      "corners",   // 모서리 계단형 4개
      "crosses",   // 십자 패턴 4개
      "xshapes",   // X 패턴 4개
      "lines",     // 5칸 일자 4개
      "squares",   // 3x3 네모 3개
      "split"      // 맵을 가르는 패턴 (가로/세로/대각, 중심 3칸 비움)
    ];

    const type = choice(patterns);

    if (type === "corners") {
      const tlCells = [
        {x:0,y:0},{x:1,y:0},{x:2,y:0},
        {x:0,y:1},{x:1,y:1},
        {x:0,y:2}
      ];
      const trBaseX = tileCount - 3;
      const trCells = [
        {x:trBaseX+2,y:0},{x:trBaseX+1,y:0},{x:trBaseX,y:0},
        {x:trBaseX+2,y:1},{x:trBaseX+1,y:1},
        {x:trBaseX+2,y:2}
      ];
      const blBaseY = tileCount - 3;
      const blCells = [
        {x:0,y:blBaseY+2},{x:1,y:blBaseY+2},{x:2,y:blBaseY+2},
        {x:0,y:blBaseY+1},{x:1,y:blBaseY+1},
        {x:0,y:blBaseY}
      ];
      const brBaseX = tileCount - 3;
      const brBaseY = tileCount - 3;
      const brCells = [
        {x:brBaseX+2,y:brBaseY+2},{x:brBaseX+1,y:brBaseY+2},{x:brBaseX,y:brBaseY+2},
        {x:brBaseX+2,y:brBaseY+1},{x:brBaseX+1,y:brBaseY+1},
        {x:brBaseX+2,y:brBaseY}
      ];

      const all = [...tlCells, ...trCells, ...blCells, ...brCells];
      for(const c of all){
        if(isCellFreeForObstacle(c.x,c.y)){
          previewObstacles.push({x:c.x,y:c.y});
        }
      }

    } else if (type === "crosses") {
      const count = 4;
      let created = 0;
      while (created < count) {
        const cx = randomInt(2, tileCount - 3);
        const cy = randomInt(2, tileCount - 3);
        const cells = [
          { x: cx, y: cy },
          { x: cx - 1, y: cy },
          { x: cx + 1, y: cy },
          { x: cx, y: cy - 1 },
          { x: cx, y: cy + 1 }
        ];
        if (cells.some(c => !isCellFreeForObstacle(c.x, c.y))) continue;
        previewObstacles.push(...cells);
        created++;
      }

    } else if (type === "xshapes") {
      const count = 4;
      let created = 0;
      while (created < count) {
        const cx = randomInt(2, tileCount - 3);
        const cy = randomInt(2, tileCount - 3);
        const cells = [
          { x: cx, y: cy },
          { x: cx - 1, y: cy - 1 },
          { x: cx + 1, y: cy - 1 },
          { x: cx - 1, y: cy + 1 },
          { x: cx + 1, y: cy + 1 }
        ];
        if (cells.some(c => !isCellFreeForObstacle(c.x, c.y))) continue;
        previewObstacles.push(...cells);
        created++;
      }

    } else if (type === "lines") {
      const count = 4;
      let created = 0;
      while (created < count) {
        const horizontal = Math.random() < 0.5;
        let cells = [];
        if (horizontal) {
          const y = randomInt(1, tileCount - 2);
          const x0 = randomInt(0, tileCount - 5);
          for (let i = 0; i < 5; i++) cells.push({ x: x0 + i, y });
        } else {
          const x = randomInt(1, tileCount - 2);
          const y0 = randomInt(0, tileCount - 5);
          for (let i = 0; i < 5; i++) cells.push({ x, y: y0 + i });
        }
        if (cells.some(c => !isCellFreeForObstacle(c.x, c.y))) continue;
        previewObstacles.push(...cells);
        created++;
      }

    } else if (type === "squares") {
      const count = 3;
      let created = 0;
      while (created < count) {
        const x0 = randomInt(1, tileCount - 4);
        const y0 = randomInt(1, tileCount - 4);
        const cells = [];
        for (let dx = 0; dx < 3; dx++) {
          for (let dy = 0; dy < 3; dy++) {
            cells.push({ x: x0 + dx, y: y0 + dy });
          }
        }
        if (cells.some(c => !isCellFreeForObstacle(c.x, c.y))) continue;
        previewObstacles.push(...cells);
        created++;
      }

    } else if (type === "split") {
      // 맵을 반 가르는 패턴 (가로/세로/대각), 중앙 3칸 비움
      const kind = choice(["vertical", "horizontal", "diagMain", "diagAnti"]);
      const mid = Math.floor(tileCount / 2);

      function pushSplitCell(x, y) {
        if (x < 0 || x >= tileCount || y < 0 || y >= tileCount) return;

        const head = snake[0];
        if (head && head.x === x && head.y === y) return;

        if (apple && apple.x === x && apple.y === y) {
          apple = randomEmptyCell();
        }

        items = items.filter(it => !(it.x === x && it.y === y));
        if (mine && mine.x === x && mine.y === y) {
          mine = null;
        }

        const k = posKey(x, y);
        if (!obstacles.has(k)) {
          previewObstacles.push({ x, y });
        }
      }

      if (kind === "vertical") {
        const x = mid;
        for (let y = 0; y < tileCount; y++) {
          if (Math.abs(y - mid) <= 1) continue; // 중앙 3칸 비움
          pushSplitCell(x, y);
        }
      } else if (kind === "horizontal") {
        const y = mid;
        for (let x = 0; x < tileCount; x++) {
          if (Math.abs(x - mid) <= 1) continue;
          pushSplitCell(x, y);
        }
      } else if (kind === "diagMain") {
        for (let i = 0; i < tileCount; i++) {
          if (Math.abs(i - mid) <= 1) continue;
          pushSplitCell(i, i);
        }
      } else { // diagAnti
        for (let i = 0; i < tileCount; i++) {
          const x = i, y = tileCount - 1 - i;
          if (Math.abs(i - mid) <= 1) continue;
          pushSplitCell(x, y);
        }
      }
    }
  }

  function spawnMine() {
    const head = snake[0];
    let x, y;
    let safety = 0;
    do {
      const cell = randomEmptyCell();
      x = cell.x; y = cell.y;
      safety++;
      if (safety > 1000) break;
    } while (Math.abs(x - head.x) <= 2 && Math.abs(y - head.y) <= 2);

    mine = { x, y };
    mineTick = 0;
  }

  function spawnItem(type) {
    const count =
      type === "bomb"      ? 4 :
      type === "superbomb" ? 1 :
      type === "shrink"    ? 3 : 1; // teleport/phase

    let created = 0;
    while (created < count) {
      const cell = randomEmptyCell();
      items.push({ type, x: cell.x, y: cell.y });
      created++;
    }

    const name =
      type === "bomb"      ? "폭탄" :
      type === "superbomb" ? "특수 폭탄" :
      type === "shrink"    ? "길이 축소" :
      type === "teleport"  ? "텔레포트" : "차원이동";

    showHUD(`아이템 등장: ${name}`);
  }

  // 특정 장애물 칸에서 4방향으로 연결된 전체 덩어리 구하기 (특수폭탄용)
  function floodFillObstacleGroup(startKey) {
    const stack = [startKey];
    const visited = new Set([startKey]);
    const group = [];

    while (stack.length > 0) {
      const key = stack.pop();
      const [x, y] = key.split(',').map(Number);
      group.push({ x, y });

      const neighbors = [
        [x+1, y],
        [x-1, y],
        [x, y+1],
        [x, y-1]
      ];
      for (const [nx, ny] of neighbors) {
        const nk = posKey(nx, ny);
        if (!visited.has(nk) && obstacles.has(nk)) {
          visited.add(nk);
          stack.push(nk);
        }
      }
    }
    return group;
  }

  function applyItemEffect(item) {
    // ===== 폭탄 / 특수폭탄 =====
    if (item.type === "bomb" || item.type === "superbomb") {
      const cx = item.x;
      const cy = item.y;
      const isSuper = (item.type === "superbomb");

      // 일반 폭탄: 패턴 기반 + 패턴 전체 하이라이트
      if (!isSuper) {
        const patternType = choice(["square", "cross", "x"]);
        const affectedCells = [];

        if (patternType === "square") {
          for (let x = cx - 2; x <= cx + 2; x++) {
            for (let y = cy - 2; y <= cy + 2; y++) {
              if (x < 0 || x >= tileCount || y < 0 || y >= tileCount) continue;
              affectedCells.push({ x, y });
            }
          }
        } else if (patternType === "cross") {
          for (let x = 0; x < tileCount; x++) {
            affectedCells.push({ x, y: cy });
          }
          for (let y = 0; y < tileCount; y++) {
            affectedCells.push({ x: cx, y });
          }
        } else { // "x"
          for (let i = -tileCount; i <= tileCount; i++) {
            let x1 = cx + i;
            let y1 = cy + i;
            if (x1 >= 0 && x1 < tileCount && y1 >= 0 && y1 < tileCount) {
              affectedCells.push({ x: x1, y: y1 });
            }
            let x2 = cx + i;
            let y2 = cy - i;
            if (x2 >= 0 && x2 < tileCount && y2 >= 0 && y2 < tileCount) {
              affectedCells.push({ x: x2, y: y2 });
            }
          }
        }

        let removedCount = 0;
        for (const c of affectedCells) {
          const k = posKey(c.x, c.y);
          if (obstacles.has(k)) {
            obstacles.delete(k);
            removedCount++;
          }
        }

        // 패턴 전체 하이라이트
        bombHighlights = affectedCells.map(c => ({ x: c.x, y: c.y, ttl: 8 }));

        showHUD("폭탄 사용: 장애물이 제거되었습니다.");
        return;
      }

      // 특수폭탄: 붙어있는 덩어리 통째 제거 + 그 덩어리만 하이라이트
      if (obstacles.size > 0) {
        // 폭탄과 가장 가까운 장애물 하나 찾기
        let bestKey = null;
        let bestDist = Infinity;
        for (const k of obstacles) {
          const [ox, oy] = k.split(',').map(Number);
          const dist = Math.abs(ox - cx) + Math.abs(oy - cy);
          if (dist < bestDist) {
            bestDist = dist;
            bestKey = k;
          }
        }

        const group = floodFillObstacleGroup(bestKey);
        for (const c of group) {
          const k = posKey(c.x, c.y);
          obstacles.delete(k);
        }
        bombHighlights = group.map(c => ({ x: c.x, y: c.y, ttl: 8 }));

        showHUD("특수 폭탄: 장애물이 통째로 제거되었습니다.");
      } else {
        showHUD("특수 폭탄: 제거할 장애물이 없습니다.");
      }

    } else if (item.type === "shrink") {
      if (snake.length > 1) snake.pop();
      showHUD("길이 축소: 뱀 길이가 1칸 줄었습니다.");

    } else if (item.type === "teleport") {
      const axis = choice(["horizontal", "vertical"]); // horizontal: 위/아래, vertical: 좌/우
      portalEdge = { axis, used: false };
      const axisText = axis === "horizontal" ? "위/아래" : "좌/우";
      showHUD(`텔레포트: ${axisText} 벽 한 번 통과 가능 (양방향, 1회)`);

    } else if (item.type === "phase") {
      isPhasing = true;
      phaseExit = randomEmptyCell();
      showHUD("차원이동: 장애물/사과/아이템 무시, 출구 도달 시 복귀");
    }
  }

  // ================= 게임 루프 =================

  function gameOver() {
    isGameOver = true;
    isRunning = false;
    lastGameOverTime = Date.now();
    if (gameLoopId !== null) {
      clearInterval(gameLoopId);
      gameLoopId = null;
    }
    draw();
  }

  function tick() {
    if (!isRunning || isPaused || isGameOver) return;

    if (hudTimer > 0) hudTimer--;

    vx = nextVx;
    vy = nextVy;

    const head = snake[0];
    let newX = head.x + vx;
    let newY = head.y + vy;

    // 텔레포트 엣지 (차원이동 중에는 텔레포트 없음)
    if (portalEdge && !portalEdge.used && !isPhasing) {
      let teleported = false;

      if (portalEdge.axis === "horizontal") {
        if (newY < 0) {
          newY = tileCount - 1;
          teleported = true;
        } else if (newY >= tileCount) {
          newY = 0;
          teleported = true;
        }
      } else if (portalEdge.axis === "vertical") {
        if (newX < 0) {
          newX = tileCount - 1;
          teleported = true;
        } else if (newX >= tileCount) {
          newX = 0;
          teleported = true;
        }
      }

      if (teleported) {
        portalEdge.used = true;
        showHUD("포탈 통과");
      }
    }

    // 벽 처리
    if (!isPhasing) {
      if (newX < 0 || newX >= tileCount || newY < 0 || newY >= tileCount) {
        gameOver();
        return;
      }
    } else {
      // 차원이동 상태: 벽을 반대편으로 통과
      if (newX < 0) newX = tileCount - 1;
      else if (newX >= tileCount) newX = 0;
      if (newY < 0) newY = tileCount - 1;
      else if (newY >= tileCount) newY = 0;
    }

    // 자기 몸
    if (!isPhasing && snake.some(seg => seg.x === newX && seg.y === newY)) {
      gameOver(); return;
    }

    // 장애물
    if (!isPhasing && obstacles.has(posKey(newX, newY))) {
      gameOver(); return;
    }

    // 지뢰
    if (!isPhasing && mine && mine.x === newX && mine.y === newY) {
      gameOver(); return;
    }

    snake.unshift({ x: newX, y: newY });

    // 차원이동 출구
    if (isPhasing && phaseExit &&
        newX === phaseExit.x && newY === phaseExit.y) {
      isPhasing = false;
      phaseExit = null;
      showHUD("차원이동 종료");
    }

    // 아이템
    if (!isPhasing) {
      const idx = items.findIndex(it => it.x === newX && it.y === newY);
      if (idx !== -1) {
        const item = items[idx];
        items.splice(idx, 1);
        applyItemEffect(item);
      }
    }

    // 사과
    if (!isPhasing && apple && newX === apple.x && newY === apple.y) {
      handleAppleEaten();
    } else {
      snake.pop();
    }

    // 지뢰 이동 (2틱마다)
    if (mine) {
      mineTick++;
      if (mineTick % 2 === 0) {
        moveMineTowardsHead();
      }
    }

    // 폭탄 하이라이트 TTL 감소
    bombHighlights.forEach(h => h.ttl--);
    bombHighlights = bombHighlights.filter(h => h.ttl > 0);

    draw();
  }

  function moveMineTowardsHead() {
    if (!mine) return;
    const head = snake[0];
    const dx = head.x - mine.x;
    const dy = head.y - mine.y;

    let stepX = 0;
    let stepY = 0;
    if (Math.abs(dx) > Math.abs(dy)) {
      stepX = dx > 0 ? 1 : -1;
    } else if (dy !== 0) {
      stepY = dy > 0 ? 1 : -1;
    }

    const newX = mine.x + stepX;
    const newY = mine.y + stepY;

    if (newX < 0 || newX >= tileCount || newY < 0 || newY >= tileCount) return;

    mine.x = newX;
    mine.y = newY;

    const headNow = snake[0];
    if (headNow.x === mine.x && headNow.y === mine.y && !isPhasing) {
      gameOver();
    }
  }

  // ================= 그리기 =================

  function drawBlock(x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
  }

  function drawApple(x, y) {
    const cx = x * tileSize + tileSize / 2;
    const cy = y * tileSize + tileSize / 2;
    const r = tileSize * 0.4;
    ctx.fillStyle = "#e53935";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#b71c1c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#2e7d32";
    ctx.beginPath();
    ctx.ellipse(cx + r * 0.2, cy - r * 0.7, r * 0.4, r * 0.2, -0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawTeleportEdge(edge) {
    if (!edge || edge.used) return;

    ctx.lineWidth = 4;
    ctx.setLineDash([8, 4]);

    const cBlue = "#1976d2";
    const cOrange = "#ff9800";

    if (edge.axis === "vertical") {
      ctx.beginPath();
      ctx.strokeStyle = cBlue;
      ctx.moveTo(2, 0); ctx.lineTo(2, canvas.height); ctx.stroke();

      const x2 = canvas.width - 2;
      ctx.beginPath();
      ctx.strokeStyle = cOrange;
      ctx.moveTo(x2, 0); ctx.lineTo(x2, canvas.height); ctx.stroke();

    } else if (edge.axis === "horizontal") {
      ctx.beginPath();
      ctx.strokeStyle = cBlue;
      ctx.moveTo(0, 2); ctx.lineTo(canvas.width, 2); ctx.stroke();

      const y2 = canvas.height - 2;
      ctx.beginPath();
      ctx.strokeStyle = cOrange;
      ctx.moveTo(0, y2); ctx.lineTo(canvas.width, y2); ctx.stroke();
    }

    ctx.setLineDash([]);
    ctx.lineWidth = 1;
  }

  function drawMine(x, y) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);

    ctx.fillStyle = "#ff3333";
    ctx.font = `${Math.floor(tileSize*0.8)}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("!", x * tileSize + tileSize / 2, y * tileSize + tileSize / 2);
  }

  function drawBombItem(x, y, isSuper) {
    const cx = x * tileSize + tileSize / 2;
    const cy = y * tileSize + tileSize / 2;
    const r = tileSize * 0.35;

    ctx.fillStyle = "#9e9e9e";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#616161";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "#5d4037";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.3, cy - r * 0.7);
    ctx.lineTo(cx + r * 0.6, cy - r * 1.2);
    ctx.stroke();

    if (isSuper) {
      ctx.strokeStyle = "#ffeb3b";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  }

  function drawTeleportItem(x, y) {
    const cx = x * tileSize + tileSize / 2;
    const cy = y * tileSize + tileSize / 2;
    const rx = tileSize * 0.45;
    const ry = tileSize * 0.3;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4); // 사선으로 기울이기

    ctx.lineWidth = tileSize * 0.35;

    ctx.strokeStyle = "#1976d2";
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, Math.PI/2, 3*Math.PI/2, false);
    ctx.stroke();

    ctx.strokeStyle = "#ff9800";
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, -Math.PI/2, Math.PI/2, false);
    ctx.stroke();

    ctx.restore();
    ctx.lineWidth = 1;
  }

  function drawPhaseItem(x, y, inverted=false) {
    const cx = x * tileSize + tileSize / 2;
    const cy = y * tileSize + tileSize / 2;
    const rOuter = tileSize * 0.45;

    const baseColor = inverted ? "#ffffff" : "#9c27b0";
    const swirlColor = inverted ? "#9c27b0" : "#ffffff";

    ctx.fillStyle = baseColor;
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, 0, Math.PI*2);
    ctx.fill();

    ctx.strokeStyle = swirlColor;
    ctx.lineWidth = 3;

    const turns = 3;
    for (let i = 0; i < turns; i++) {
      const t0 = i * 0.9;
      const t1 = t0 + Math.PI * 0.9;
      const rMid = rOuter * (0.25 + 0.15 * i);
      ctx.beginPath();
      for (let t = t0; t <= t1; t += 0.1) {
        const rr = rMid + (t - t0) * 0.2;
        const xPos = cx + Math.cos(t) * rr;
        const yPos = cy + Math.sin(t) * rr;
        if (t === t0) ctx.moveTo(xPos, yPos);
        else ctx.lineTo(xPos, yPos);
      }
      ctx.stroke();
    }

    ctx.lineWidth = 1;
  }

  function draw() {
    // 기본 배경
    ctx.fillStyle = "#f5f5f5";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (apple) drawApple(apple.x, apple.y);

    // 장애물
    for (const key of obstacles) {
      const [x, y] = key.split(',').map(Number);
      drawBlock(x, y, "#8b1a1a");
    }

    // 예고 장애물(반투명)
    ctx.globalAlpha = 0.4;
    previewObstacles.forEach(p => drawBlock(p.x, p.y, "#c05050"));
    ctx.globalAlpha = 1.0;

    // 폭탄 하이라이트(주황색)
    if (bombHighlights.length > 0) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#ff9800";
      bombHighlights.forEach(h => {
        ctx.fillRect(h.x * tileSize, h.y * tileSize, tileSize, tileSize);
      });
      ctx.globalAlpha = 1.0;
    }

    if (portalEdge && !portalEdge.used) {
      drawTeleportEdge(portalEdge);
    }

    // 차원이동 출구 (반전 전, 내부용 표시)
    if (isPhasing && phaseExit) {
      drawPhaseItem(phaseExit.x, phaseExit.y, true);
    }

    // 아이템
    for (const item of items) {
      if (item.type === "bomb") {
        drawBombItem(item.x, item.y, false);
      } else if (item.type === "superbomb") {
        drawBombItem(item.x, item.y, true);
      } else if (item.type === "teleport") {
        drawTeleportItem(item.x, item.y);
      } else if (item.type === "phase") {
        drawPhaseItem(item.x, item.y, false);
      } else { // shrink
        drawBlock(item.x, item.y, "#44aa44");
      }
    }

    // 뱀
    if (!snake.length) return;
    drawSnakeHead(snake[0].x, snake[0].y);
    for (let i = 1; i < snake.length - 1; i++) {
      const seg = snake[i];
      drawBlock(seg.x, seg.y, "#2e7d32");
    }
    if (snake.length > 1) {
      const tail = snake[snake.length - 1];
      const prev = snake[snake.length - 2];
      drawSnakeTail(tail.x, tail.y, prev);
    }

    // 지뢰 (항상 맨 위)
    if (mine) {
      drawMine(mine.x, mine.y);
    }

    // WARNING 오버레이 (연하게)
    if (warningActive && !isGameOver) {
      ctx.fillStyle = "rgba(255,0,0,0.07)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#ff3333";
      ctx.font = "32px Arial";
      ctx.textAlign = "center";
      ctx.fillText("WARNING!", canvas.width / 2, 40);
    }

    // HUD 메시지
    if (hudTimer > 0 && hudMessage) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(10, 10, canvas.width - 20, 30);
      ctx.fillStyle = "#ffffff";
      ctx.font = "16px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(hudMessage, canvas.width/2, 25);
    }

    drawOverlay();

    // 차원이동 중이면 전체 색 반전
    if (isPhasing) {
      ctx.save();
      ctx.globalCompositeOperation = "difference";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      // 출구는 반전 금지 → 반전 후 다시 정상 색으로
      if (phaseExit) {
        drawPhaseItem(phaseExit.x, phaseExit.y, false);
      }
    }
  }

  function drawOverlay() {
    if (isGameOver) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#fff";
      ctx.font = "32px Arial";
      ctx.textAlign = "center";
      ctx.fillText("GAME OVER", canvas.width / 2, canvas.height / 2 - 10);
      ctx.font = "16px Arial";
      ctx.fillText("Start 버튼으로 새 게임 시작", canvas.width / 2, canvas.height / 2 + 20);
    } else if (isRunning && isPaused) {
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#fff";
      ctx.font = "28px Arial";
      ctx.textAlign = "center";
      ctx.fillText("PAUSED", canvas.width / 2, canvas.height / 2);
      ctx.font = "14px Arial";
      ctx.fillText("ESC 키로 다시 시작", canvas.width / 2, canvas.height / 2 + 24);
    }
  }

  // ================= 뱀 머리 / 꼬리 =================

  function drawSnakeHead(x, y) {
    const px = x * tileSize;
    const py = y * tileSize;
    const r = 8;

    ctx.fillStyle = "#2e7d32";
    ctx.beginPath();

    const corners = { tl: 0, tr: 0, br: 0, bl: 0 };
    if (headDx === 1) {
      corners.tr = r; corners.br = r;
    } else if (headDx === -1) {
      corners.tl = r; corners.bl = r;
    } else if (headDy === -1) {
      corners.tl = r; corners.tr = r;
    } else {
      corners.bl = r; corners.br = r;
    }

    roundRectPath(px, py, tileSize, tileSize, corners);
    ctx.fill();

    drawEyes(px, py);
  }

  function drawSnakeTail(x, y, prevSeg) {
    const px = x * tileSize;
    const py = y * tileSize;
    const r = 8;
    const dx = x - prevSeg.x;
    const dy = y - prevSeg.y;

    ctx.fillStyle = "#2e7d32";
    ctx.beginPath();

    const corners = { tl: 0, tr: 0, br: 0, bl: 0 };
    if (dx === 1) {
      corners.tr = r; corners.br = r;
    } else if (dx === -1) {
      corners.tl = r; corners.bl = r;
    } else if (dy === 1) {
      corners.bl = r; corners.br = r;
    } else {
      corners.tl = r; corners.tr = r;
    }

    roundRectPath(px, py, tileSize, tileSize, corners);
    ctx.fill();
  }

  function drawEyes(px, py) {
    ctx.fillStyle = "#ffffff";
    const e = tileSize * 0.2;
    const r = 4;
    let ex1, ey1, ex2, ey2;

    if (headDx === 1) {
      ex1 = px + tileSize * 0.7; ey1 = py + e;
      ex2 = px + tileSize * 0.7; ey2 = py + tileSize - e;
    } else if (headDx === -1) {
      ex1 = px + tileSize * 0.3; ey1 = py + e;
      ex2 = px + tileSize * 0.3; ey2 = py + tileSize - e;
    } else if (headDy === -1) {
      ex1 = px + e; ey1 = py + tileSize * 0.3;
      ex2 = px + tileSize - e; ey2 = py + tileSize * 0.3;
    } else {
      ex1 = px + e; ey1 = py + tileSize * 0.7;
      ex2 = px + tileSize - e; ey2 = py + tileSize * 0.7;
    }

    ctx.beginPath();
    ctx.arc(ex1, ey1, r, 0, Math.PI * 2);
    ctx.arc(ex2, ey2, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.arc(ex1, ey1, 2, 0, Math.PI * 2);
    ctx.arc(ex2, ey2, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  function roundRectPath(x, y, w, h, r) {
    const tl = r.tl || 0;
    const tr = r.tr || 0;
    const br = r.br || 0;
    const bl = r.bl || 0;

    ctx.moveTo(x + tl, y);
    ctx.lineTo(x + w - tr, y);
    if (tr) ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
    else ctx.lineTo(x + w, y);

    ctx.lineTo(x + w, y + h - br);
    if (br) ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
    else ctx.lineTo(x + w, y + h);

    ctx.lineTo(x + bl, y + h);
    if (bl) ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
    else ctx.lineTo(x, y + h);

    ctx.lineTo(x, y + tl);
    if (tl) ctx.quadraticCurveTo(x, y, x + tl, y);
    else ctx.lineTo(x, y);
  }

})(window);
