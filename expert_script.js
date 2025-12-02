// expert_script.js
// ========================================
//  ▷ 모드: Expert
//  - 장애물(패턴), 추적지뢰, 폭탄/특수폭탄, 길이 축소, 텔레포트, 차원이동 등
//  - 사과 일정 개수마다 "위험요소 + 아이템" 이벤트 발생
//  - ESC: 일시정지 / 재개
//  - WARNING! 오버레이에 다음 위험요소 표시 (예: WARNING!(장애물))
//  - HUD 텍스트(아이템/속도 변경 안내)는 WARNING 아래로 내려서 겹치지 않게 표시
//  - 지뢰 → "추적지뢰"로 명칭 통일 (표시 텍스트 기준)
//  - 뱀 외곽 윤곽선 추가 (가시성 향상)
// ========================================

(function (global) {
  const SnakeExpert = {
    init,
    destroy,
    onDifficultyChanged
  };

  // 전역 네임스페이스에 등록
  global.SnakeGames = global.SnakeGames || {};
  global.SnakeGames.expert = SnakeExpert;

  // -----------------------------
  // 공용 DOM / 상태 변수
  // -----------------------------
  let opt = {};
  let canvas, ctx;
  let startBtn, stopBtn, scoreEl, modeEl, diffEl, diffRadios;
  let toastFn;

  const tileCount = 25;
  let tileSize;

  let snake = [];           // [0]이 머리
  let apple = null;         // {x,y}

  let vx = 1, vy = 0;       // 현재 이동 방향
  let nextVx = 1, nextVy = 0;
  let headDx = 1, headDy = 0;

  let isRunning = false;
  let isPaused = false;
  let isGameOver = false;

  let baseTickMs = 120;     // 기본 틱 간격
  let currentTickMs = 120;  // 난이도/속도이벤트 반영 후 실제 간격
  let gameLoopId = null;    // setInterval 핸들

  let difficulty = "normal"; // easy / normal / hard
  let speedMul = 1.0;        // 난이도 기본 속도 계수

  let applesSinceEvent = 0;  // 마지막 이벤트 이후 먹은 사과 수
  let score = 0;

  // 속도 계수 (1.0=100%), 커질수록 "더 빠름"
  // 실제 틱 간격 = baseTickMs * speedMul / speedFactor
  let speedFactor = 1.0; // 0.8 ~ 1.2 (최소 80%, 최대 120%)

  // 장애물 / 지뢰 / 아이템 / 특수 상태
  let obstacles = new Set();      // Set("x,y")
  let previewObstacles = [];      // 이벤트 예고용 장애물 좌표 [{x,y}]
  let mine = null;                // 추적지뢰 {x,y}
  let mineTick = 0;               // 지뢰 이동 간격 제어용 카운터

  let items = [];                 // [{type,x,y}]  type: "bomb","superbomb","shrink","teleport","phase"
  let portalEdge = null;          // 텔레포트 엣지 {axis: "horizontal"|"vertical", used}
  let isPhasing = false;          // 차원이동 상태 여부
  let phaseExit = null;           // 차원이동 출구 {x,y}

  let bombHighlights = [];        // 폭탄 효과 영역 하이라이트 [{x,y,ttl}]
  let warningActive = false;      // 다음 사과에 위험요소+아이템 이벤트 예정 여부

  // WARNING 예정 정보
  let upcomingHazard = null;      // "obstacle" | "mine" | "speed"
  let upcomingItem = null;        // "bomb" | "superbomb" | "shrink" | "teleport" | "phase"
  let upcomingSpeedDelta = null;  // 예고된 속도 변화량 (±0.1, ±0.2)

  let keyHandler = null;

  // HUD 메시지 (아이템/속도 이벤트 안내)
  let hudMessage = "";
  let hudTimer = 0; // tick마다 감소

  // 게임 오버 직후 재시작 방지용(키 떼기 전에 연속 재시작 방지)
  let lastGameOverTime = 0;

  // 이 모드에서 게임을 한 번이라도 시작했는지
  let hasStarted = false;

  // =========================
  // HUD / 경고 관련 유틸
  // =========================

  function showHUD(msg) {
    hudMessage = msg;
    hudTimer = 30; // 짧게 표시 (틱 기준)
  }

  function getSpawnInterval() {
    // 현재 난이도에 따른 이벤트 간격(먹어야 하는 사과 수)
    if (difficulty === "easy") return 7;
    if (difficulty === "hard") return 3;
    return 5; // normal
  }

  // =========================
  // 초기화 / 파괴
  // =========================

  /**
   * Expert 모드 초기화
   */
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

    // 모드 진입 시마다, 이 모드에선 아직 게임을 시작한 적 없는 상태로 리셋
    hasStarted = false;

    // 버튼 이벤트
    startBtn.addEventListener('click', onClickStart);
    stopBtn.addEventListener('click', onClickStop);

    // 키 입력
    keyHandler = onKeyDown;
    document.addEventListener('keydown', keyHandler);

    updateDifficultyConfig();
    resetGame();
  }

  /**
   * Expert 모드 파괴 (이벤트 해제 등)
   */
  function destroy() {
    if (gameLoopId !== null) {
      clearInterval(gameLoopId);
      gameLoopId = null;
    }
    document.removeEventListener('keydown', keyHandler);
    startBtn.removeEventListener('click', onClickStart);
    stopBtn.removeEventListener('click', onClickStop);
  }

  /**
   * 난이도 라디오 변경 시 호출
   */
  function onDifficultyChanged() {
    updateDifficultyConfig();
    if (!isRunning) {
      computeTickInterval();
      draw();
    }
  }

  // =========================
  // 난이도 / 속도 설정
  // =========================

  function updateDifficultyConfig() {
    const checked = [...diffRadios].find(r => r.checked);
    difficulty = checked ? checked.value : "normal";

    // easy: 느림, hard: 빠름 (실제로는 speedMul에 반영)
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

  /**
   * 현재 speedMul / speedFactor를 반영하여 틱 간격 계산 및 루프 재설정
   */
  function computeTickInterval() {
    // speedFactor가 커질수록 더 빠르게 진행되도록 나눗셈 사용
    currentTickMs = baseTickMs * speedMul / speedFactor;

    if (gameLoopId !== null) {
      clearInterval(gameLoopId);
      gameLoopId = setInterval(tick, currentTickMs);
    }
  }

  /**
   * 실제 속도 이벤트 적용
   * - upcomingSpeedDelta(±0.1 or ±0.2)를 누적
   * - speedFactor는 0.8~1.2 범위로 클램핑
   * - HUD에 "예정 변화량" 기준으로 메시지 표시
   */
  function applyScheduledSpeedChange() {
    // WARNING 단계에서 이미 upcomingSpeedDelta를 정해뒀으면 그대로 사용
    if (upcomingSpeedDelta == null) {
      const steps = [-2, -1, 1, 2];      // -20%, -10%, +10%, +20%
      upcomingSpeedDelta = choice(steps) * 0.1;
    }

    const plannedDelta = upcomingSpeedDelta;   // -0.2, -0.1, +0.1, +0.2
    const oldFactor = speedFactor;

    // 누적 + 0.8~1.2 범위 클램핑
    let newFactor = speedFactor + plannedDelta;
    if (newFactor > 1.2) newFactor = 1.2;
    if (newFactor < 0.8) newFactor = 0.8;
    speedFactor = newFactor;

    computeTickInterval();

    const actualDeltaPercent = Math.round((speedFactor - oldFactor) * 100);
    const currentPercent = Math.round(speedFactor * 100);
    let diffPercent = Math.round(plannedDelta * 100);

    if (actualDeltaPercent === 0) {
      showHUD(`속도 변경 적용: 변화 없음 (현재 ${currentPercent}%)`);
    } else {
      const sign = diffPercent > 0 ? "+" : "";
      showHUD(`속도 변경 적용: ${sign}${diffPercent}% (현재 ${currentPercent}%)`);
    }

    upcomingSpeedDelta = null;
  }

  // =========================
  // 게임 상태 관리
  // =========================

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
    speedFactor = 1.0; // 속도 100%로 리셋
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
    // 처음 시작할 때만 true로
    if (!hasStarted) hasStarted = true;
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

  // =========================
  // 입력 처리
  // =========================

  function onKeyDown(e) {
    const key = e.key;

    // 방향키 / 스페이스 / ESC → 스크롤 방지
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," ","Escape"].includes(key)) {
      e.preventDefault();
    }

    // ESC: 일시정지 / 재개
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

    // 바로 반대 방향으로 전환 방지
    if (dx === -vx && dy === -vy) return;
    if (dx === -nextVx && dy === -nextVy) return;

    nextVx = dx;
    nextVy = dy;
    headDx = dx;
    headDy = dy;
  }

  // =========================
  // 유틸 함수
  // =========================

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

  /**
   * 뱀 / 장애물 / 지뢰 / 아이템 / 예고 장애물이 없는 빈 칸 하나 반환
   */
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
      items.some(it => it.x === x && it.y === y) ||
      previewObstacles.some(p => p.x === x && p.y === y)
    );
    return { x, y };
  }

  /**
   * 사과 위치가 장애물/예고 장애물에 3면 이상 둘러싸이지 않았는지 검사
   * - 상하좌우 기준
   */
  function isAppleSafe(x, y) {
    const dirs = [
      [1, 0], [-1, 0],
      [0, 1], [0, -1]
    ];
    let blocked = 0;
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      const k = posKey(nx, ny);
      if (obstacles.has(k)) {
        blocked++;
      } else if (previewObstacles.some(p => p.x === nx && p.y === ny)) {
        blocked++;
      }
    }
    // 3면 이상 막혀 있으면 비안전
    return blocked < 3;
  }

  // =========================
  // 사과 / 점수
  // =========================

  function placeApple() {
    let safety = 0;
    while (true) {
      const cell = randomEmptyCell();
      if (isAppleSafe(cell.x, cell.y) || safety > 1000) {
        apple = cell;
        break;
      }
      safety++;
    }
  }

  /**
   * 사과를 먹었을 때 처리
   * - 점수 증가
   * - 이벤트 카운터 증가
   * - 지뢰 제거(있으면)
   * - WARNING 단계 / 실제 이벤트 발생 처리
   */
  function handleAppleEaten() {
    score++;
    updateScoreUI();
    applesSinceEvent++;

    // "다음 사과를 먹을 때까지 유지" → 여기서 추적지뢰 제거
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
        // 지뢰 → 추적지뢰
        showHUD("WARNING! 다음 사과 후 추적지뢰가 생성됩니다.");
      } else {
        // 속도 이벤트: 10% 단위 변화량만 미리 계산
        const steps = [-2, -1, 1, 2];      // -20, -10, +10, +20
        const delta = choice(steps) * 0.1; // -0.2, -0.1, +0.1, +0.2

        upcomingSpeedDelta = delta;

        const previewFactor = Math.max(0.8, Math.min(1.2, speedFactor + delta));
        const diffPercent = Math.round(delta * 100);
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

  /**
   * WARNING에서 예정해둔 위험요소/아이템 실제 적용
   */
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
      applyScheduledSpeedChange(); // speedFactor 변경
    }

    // 아이템 생성
    spawnItem(upcomingItem);

    upcomingHazard = null;
    upcomingItem = null;
    upcomingSpeedDelta = null;
  }

  // =========================
  // 위험요소 / 아이템 생성
  // =========================

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

  /**
   * 장애물 예고 패턴 생성 (corners / crosses / xshapes / lines / squares / split)
   * - 실제 장애물은 이벤트 발생 시 obstacles로 옮김
   */
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

  /**
   * 추적지뢰 생성
   * - 뱀 머리 근처(±2)에는 생성하지 않도록 회피
   */
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

  /**
   * 아이템 생성
   * - bomb: 4개
   * - superbomb: 1개
   * - shrink: 3개
   * - teleport/phase: 1개
   */
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

  /**
   * 특정 장애물 칸에서 4방향 + 대각선까지 연결된 덩어리(그룹) 찾기
   * - 특수폭탄이 제거할 대상
   */
  function floodFillObstacleGroup(startKey) {
    const stack = [startKey];
    const visited = new Set([startKey]);
    const group = [];

    while (stack.length > 0) {
      const key = stack.pop();
      const [x, y] = key.split(',').map(Number);
      group.push({ x, y });

      const neighbors = [
        [x+1, y], [x-1, y],
        [x, y+1], [x, y-1],
        [x+1, y+1], [x+1, y-1],
        [x-1, y+1], [x-1, y-1]
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

  /**
   * 아이템 효과 적용
   */
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

        for (const c of affectedCells) {
          const k = posKey(c.x, c.y);
          if (obstacles.has(k)) {
            obstacles.delete(k);
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
      // 길이 1칸 감소 (1칸 이상 남도록 체크)
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

  // =========================
  // 게임 루프 / 이동
  // =========================

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

    // 자기 몸 충돌
    if (!isPhasing && snake.some(seg => seg.x === newX && seg.y === newY)) {
      gameOver(); return;
    }

    // 장애물 충돌
    if (!isPhasing && obstacles.has(posKey(newX, newY))) {
      gameOver(); return;
    }

    // 추적지뢰 충돌
    if (!isPhasing && mine && mine.x === newX && mine.y === newY) {
      gameOver(); return;
    }

    // 머리 새로운 위치로 이동
    snake.unshift({ x: newX, y: newY });

    // 차원이동 출구 도달
    if (isPhasing && phaseExit &&
        newX === phaseExit.x && newY === phaseExit.y) {
      isPhasing = false;
      phaseExit = null;
      showHUD("차원이동 종료");
    }

    // 아이템 획득
    if (!isPhasing) {
      const idx = items.findIndex(it => it.x === newX && it.y === newY);
      if (idx !== -1) {
        const item = items[idx];
        items.splice(idx, 1);
        applyItemEffect(item);
      }
    }

    // 사과 획득
    if (!isPhasing && apple && newX === apple.x && newY === apple.y) {
      handleAppleEaten();
    } else {
      // 사과가 아니면 꼬리 제거 (길이 유지)
      snake.pop();
    }

    // 추적지뢰 이동 (2틱마다)
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

  /**
   * 추적지뢰가 뱀 머리를 향해 한 칸씩 이동
   */
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

  // =========================
  // 그리기 유틸
  // =========================

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

  // 길이 감소 아이템: 초록 배경 + "-1" 표시
  function drawShrinkItem(x, y) {
    const px = x * tileSize;
    const py = y * tileSize;
    ctx.fillStyle = "#4caf50";
    ctx.fillRect(px, py, tileSize, tileSize);

    ctx.fillStyle = "#ffffff";
    ctx.font = `${Math.floor(tileSize * 0.7)}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("-1", px + tileSize / 2, py + tileSize / 2);
  }

  // =========================
  // 전체 화면 그리기
  // =========================

  function draw() {
    // 기본 배경
    ctx.fillStyle = "#f5f5f5";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 사과
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

    // 폭탄 하이라이트(주황색 오버레이)
    if (bombHighlights.length > 0) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#ff9800";
      bombHighlights.forEach(h => {
        ctx.fillRect(h.x * tileSize, h.y * tileSize, tileSize, tileSize);
      });
      ctx.globalAlpha = 1.0;
    }

    // 텔레포트 엣지(벽 표시)
    if (portalEdge && !portalEdge.used) {
      drawTeleportEdge(portalEdge);
    }

    // 차원이동 출구 (반전 전: 흰 배경 + 보라 무늬로 그릴 준비)
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
        drawShrinkItem(item.x, item.y);
      }
    }

    // 뱀
    if (!snake.length) return;

    // 머리
    drawSnakeHead(snake[0].x, snake[0].y);

    // 몸통
    for (let i = 1; i < snake.length - 1; i++) {
      const seg = snake[i];
      const px = seg.x * tileSize;
      const py = seg.y * tileSize;

      // 몸통 채우기
      ctx.fillStyle = "#2e7d32";
      ctx.fillRect(px, py, tileSize, tileSize);

      // 몸통 윤곽선
      ctx.strokeStyle = "#1b5e20";
      ctx.lineWidth = 2;
      ctx.strokeRect(px, py, tileSize, tileSize);
    }

    // 꼬리
    if (snake.length > 1) {
      const tail = snake[snake.length - 1];
      const prev = snake[snake.length - 2];
      drawSnakeTail(tail.x, tail.y, prev);
    }

    // 추적지뢰 (항상 맨 위)
    if (mine) {
      drawMine(mine.x, mine.y);
    }

    // WARNING 오버레이
    if (warningActive && !isGameOver) {
      ctx.fillStyle = "rgba(255,0,0,0.07)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#ff3333";
      ctx.font = "32px Arial";
      ctx.textAlign = "center";

      // 다음 위험요소명을 같이 표시
      let hazardName = "";
      if (upcomingHazard === "obstacle") hazardName = "장애물";
      else if (upcomingHazard === "mine") hazardName = "추적지뢰";
      else if (upcomingHazard === "speed") hazardName = "속도";

      const warningText = hazardName ? `WARNING!(${hazardName})` : "WARNING!";
      ctx.fillText(warningText, canvas.width / 2, 40);
    }

    // HUD 메시지 (아이템 등장/효과, 속도 변경 안내 등)
    if (hudTimer > 0 && hudMessage) {
      // WARNING과 겹치지 않도록 위치 조정
      const hudY = (warningActive && !isGameOver) ? 50 : 10;
      const boxHeight = 30;

      ctx.fillStyle = "rgba(0,0,0,0.35)"; // 살짝 투명한 검은 배경
      ctx.fillRect(10, hudY, canvas.width - 20, boxHeight);
      ctx.fillStyle = "#ffffff";
      ctx.font = "16px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(hudMessage, canvas.width/2, hudY + boxHeight/2);
    }

    // 게임오버 / 일시정지 오버레이
    drawOverlay();

    // 차원이동 중이면 전체 색 반전
    if (isPhasing) {
      ctx.save();
      ctx.globalCompositeOperation = "difference";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      // 출구는 반전 후에도 "흰 배경 + 보라 무늬"로 다시 그려서 눈에 띄게
      if (phaseExit) {
        drawPhaseItem(phaseExit.x, phaseExit.y, true);
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

  // ★ 수정: 아직 한 번도 시작 안 했을 때만 시작 안내
  } else if (!hasStarted && !isRunning && !isGameOver) {
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";

    ctx.font = "24px Arial";
    ctx.fillText("Snake Expert", canvas.width / 2, canvas.height / 2 - 30);

    ctx.font = "16px Arial";
    ctx.fillText("Start 버튼 또는 방향키를 눌러 시작", canvas.width / 2, canvas.height / 2 + 5);
  }
}



  // =========================
  // 뱀 머리 / 꼬리 (윤곽선 포함)
  // =========================

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

    // 채우기
    roundRectPath(px, py, tileSize, tileSize, corners);
    ctx.fill();

    // 윤곽선
    ctx.strokeStyle = "#1b5e20";
    ctx.lineWidth = 2;
    ctx.beginPath();
    roundRectPath(px, py, tileSize, tileSize, corners);
    ctx.stroke();

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

    // 채우기
    roundRectPath(px, py, tileSize, tileSize, corners);
    ctx.fill();

    // 윤곽선
    ctx.strokeStyle = "#1b5e20";
    ctx.lineWidth = 2;
    ctx.beginPath();
    roundRectPath(px, py, tileSize, tileSize, corners);
    ctx.stroke();
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
