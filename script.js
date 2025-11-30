// script.js

const canvas = document.getElementById("game-board");
const ctx = canvas.getContext("2d");

// ====== 기본 설정 ======
const tileCount = 25;
const tileSize = canvas.width / tileCount; // 600 / 25 = 24px

let snake;        // [{x,y}, ...] 형태 (머리가 index 0)
let apple;        // { x, y }
let vx, vy;       // 실제 이동 방향
let nextVx, nextVy; // 다음 틱에 적용할 이동 방향

// 머리 표시용 방향 (머리 모양/눈 방향은 이걸 기준으로 그림)
let headDx, headDy;

let score = 0;
let gameInterval = null;
let isRunning = false;
let isGameOver = false;

// 한 칸 이동 속도(ms)
// 이전: 100ms  →  지금: 120ms (게임 속도 더 느리게)
const tickMs = 120;

// ====== 헬퍼: 둥근 사각형 ======
function drawRoundedRect(x, y, w, h, r) {
  const radius = { tl: r.tl || 0, tr: r.tr || 0, br: r.br || 0, bl: r.bl || 0 };

  ctx.beginPath();
  ctx.moveTo(x + radius.tl, y);
  ctx.lineTo(x + w - radius.tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius.tr);
  ctx.lineTo(x + w, y + h - radius.br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius.br, y + h);
  ctx.lineTo(x + radius.bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius.bl);
  ctx.lineTo(x, y + radius.tl);
  ctx.quadraticCurveTo(x, y, x + radius.tl, y);
  ctx.closePath();
  ctx.fill();
}

// ====== 초기화 ======
function resetGame() {
  const startX = Math.floor(tileCount / 2);
  const startY = Math.floor(tileCount / 2);

  snake = [{ x: startX, y: startY }];

  // 기본 방향: 오른쪽
  vx = 1; vy = 0;
  nextVx = vx; nextVy = vy;

  // 머리도 같은 방향으로 표시
  headDx = vx;
  headDy = vy;

  score = 0;
  document.getElementById("score").textContent = score;

  isRunning = false;
  isGameOver = false;

  placeApple();
  draw();
}

function placeApple() {
  while (true) {
    const x = Math.floor(Math.random() * tileCount);
    const y = Math.floor(Math.random() * tileCount);

    if (!snake.some(seg => seg.x === x && seg.y === y)) {
      apple = { x, y };
      break;
    }
  }
}

// ====== 방향 전환 (정반대 금지, 머리는 즉시 회전) ======
function setDirection(dx, dy) {
  // 현재 이동 방향 기준으로 180도 회전은 막기
  if (dx === -vx && dy === -vy) return;

  // 실제 이동 방향은 다음 틱에 적용
  nextVx = dx;
  nextVy = dy;

  // 머리는 바로 회전해서 표시 (입력 반응 빠르게 보이도록)
  headDx = dx;
  headDy = dy;
}

// ====== 틱 처리 ======
function tick() {
  if (isGameOver) return;

  // 이번 틱에서 실제 이동 방향 갱신
  vx = nextVx;
  vy = nextVy;

  const head = snake[0];
  const newHead = { x: head.x + vx, y: head.y + vy };

  // 벽 충돌
  if (
    newHead.x < 0 || newHead.x >= tileCount ||
    newHead.y < 0 || newHead.y >= tileCount
  ) {
    return endGame();
  }

  // 몸통 충돌
  if (snake.some(seg => seg.x === newHead.x && seg.y === newHead.y)) {
    return endGame();
  }

  snake.unshift(newHead);

  // 사과
  if (newHead.x === apple.x && newHead.y === apple.y) {
    score++;
    document.getElementById("score").textContent = score;
    placeApple();
  } else {
    snake.pop();
  }

  draw();
}

// ====== 그리기 ======
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // ------- 배경 -------
  ctx.fillStyle = "#f0f0f0";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // ------- 사과 (둥근 사각형 + 하이라이트) -------
  ctx.fillStyle = "#FF7043";
  drawRoundedRect(
    apple.x * tileSize,
    apple.y * tileSize,
    tileSize,
    tileSize,
    { tl: 6, tr: 6, br: 6, bl: 6 }
  );

  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fillRect(
    apple.x * tileSize + 3,
    apple.y * tileSize + 3,
    tileSize / 3,
    tileSize / 3
  );

  // ------- 뱀 -------
  for (let i = 0; i < snake.length; i++) {
    const seg = snake[i];

    const px = seg.x * tileSize;
    const py = seg.y * tileSize;

    if (i === 0) {
      // ===== 머리 (둥근 방향 + 눈 + 눈동자) =====
      ctx.fillStyle = "#388e3c";

      // 머리 방향은 headDx/headDy 기준 (입력에 즉시 반응)
      let r = { tl: 0, tr: 0, br: 0, bl: 0 };
      if (headDx > 0) r = { tl: 0, tr: 8, br: 8, bl: 0 };
      else if (headDx < 0) r = { tl: 8, tr: 0, br: 0, bl: 8 };
      else if (headDy < 0) r = { tl: 8, tr: 8, br: 0, bl: 0 };
      else if (headDy > 0) r = { tl: 0, tr: 0, br: 8, bl: 8 };

      drawRoundedRect(px, py, tileSize, tileSize, r);

      // 눈 + 눈동자
      const eyeSize = tileSize / 4;
      const pupilSize = eyeSize / 2;

      let eye1 = { x: 0, y: 0 };
      let eye2 = { x: 0, y: 0 };

      if (headDx > 0) {
        // 오른쪽
        eye1.x = px + tileSize - eyeSize - 3;
        eye1.y = py + tileSize / 4;
        eye2.x = px + tileSize - eyeSize - 3;
        eye2.y = py + tileSize / 1.6;
      } else if (headDx < 0) {
        // 왼쪽
        eye1.x = px + 3;
        eye1.y = py + tileSize / 4;
        eye2.x = px + 3;
        eye2.y = py + tileSize / 1.6;
      } else if (headDy < 0) {
        // 위
        eye1.x = px + tileSize / 4;
        eye1.y = py + 3;
        eye2.x = px + tileSize / 1.6;
        eye2.y = py + 3;
      } else if (headDy > 0) {
        // 아래
        eye1.x = px + tileSize / 4;
        eye1.y = py + tileSize - eyeSize - 3;
        eye2.x = px + tileSize / 1.6;
        eye2.y = py + tileSize - eyeSize - 3;
      }

      // 흰자
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(eye1.x, eye1.y, eyeSize, eyeSize);
      ctx.fillRect(eye2.x, eye2.y, eyeSize, eyeSize);

      // 눈동자
      ctx.fillStyle = "#000000";
      ctx.fillRect(
        eye1.x + (eyeSize - pupilSize) / 2,
        eye1.y + (eyeSize - pupilSize) / 2,
        pupilSize,
        pupilSize
      );
      ctx.fillRect(
        eye2.x + (eyeSize - pupilSize) / 2,
        eye2.y + (eyeSize - pupilSize) / 2,
        pupilSize,
        pupilSize
      );
    }

    else if (i === snake.length - 1) {
      // ===== 꼬리 (진행 반대쪽만 둥글게) =====
      ctx.fillStyle = "#43A047";

      const prev = snake[i - 1];
      let r = { tl: 0, tr: 0, br: 0, bl: 0 };

      if (prev.x > seg.x) r = { tl: 8, tr: 0, br: 0, bl: 8 };
      else if (prev.x < seg.x) r = { tl: 0, tr: 8, br: 8, bl: 0 };
      else if (prev.y > seg.y) r = { tl: 8, tr: 8, br: 0, bl: 0 };
      else if (prev.y < seg.y) r = { tl: 0, tr: 0, br: 8, bl: 8 };

      drawRoundedRect(px, py, tileSize, tileSize, r);
    }

    else {
      // ===== 몸통: 네모 =====
      ctx.fillStyle = "#43A047";
      ctx.fillRect(px, py, tileSize, tileSize);
    }
  }

  // 게임오버 표시
  if (isGameOver) {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.font = "36px Arial";
    ctx.fillText("GAME OVER", canvas.width / 2, canvas.height / 2 - 25);

    ctx.font = "20px Arial";
    ctx.fillText(`점수: ${score}`, canvas.width / 2, canvas.height / 2 + 5);

    ctx.font = "14px Arial";
    ctx.fillText(
      "다시 시작하려면 [시작] 버튼 또는 방향키를 누르세요",
      canvas.width / 2,
      canvas.height / 2 + 35
    );
  }
}

// ====== 게임 제어 ======
function startGame() {
  if (isRunning) return;
  if (isGameOver) resetGame();

  isRunning = true;
  gameInterval = setInterval(tick, tickMs);
}

function stopGame() {
  isRunning = false;
  clearInterval(gameInterval);
}

function endGame() {
  isRunning = false;
  isGameOver = true;
  clearInterval(gameInterval);
  draw();
}

// ====== 입력 ======
window.addEventListener("keydown", (e) => {
  const key = e.key;

  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) {
    e.preventDefault();
  }

  if (!isRunning && !isGameOver) {
    startGame();
  } else if (!isRunning && isGameOver) {
    resetGame();
    startGame();
  }

  if (key === "ArrowUp") setDirection(0, -1);
  if (key === "ArrowDown") setDirection(0, 1);
  if (key === "ArrowLeft") setDirection(-1, 0);
  if (key === "ArrowRight") setDirection(1, 0);
});

document.getElementById("start-btn").addEventListener("click", () => {
  if (!isRunning && isGameOver) resetGame();
  startGame();
});

document.getElementById("stop-btn").addEventListener("click", stopGame);

// ====== 시작 ======
resetGame();
