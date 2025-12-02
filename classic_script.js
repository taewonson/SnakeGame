// classic_script.js
// ========================================
//  ▷ 모드: Classic
//  - 기본 스네이크
//  - 난이도에 따라 "표시만" 바뀌고, 속도는 항상 동일
//  - 장애물 / 아이템 없음
//  - ESC: 일시정지 / 재개
// ========================================

(function(global){
  const SnakeClassic = { init, destroy, onDifficultyChanged };

  // 전역 네임스페이스에 등록
  global.SnakeGames = global.SnakeGames || {};
  global.SnakeGames.classic = SnakeClassic;

  // -----------------------------
  // 공용 DOM / 상태 변수
  // -----------------------------
  let opt = {};
  let canvas, ctx;
  let startBtn, stopBtn, scoreEl, modeEl, diffEl, diffRadios;
  let toastFn;

  const tileCount = 25;   // 그리드 가로/세로 타일 수
  let tileSize;           // 한 타일의 픽셀 크기

  let snake = [];         // 뱀 몸통 좌표 배열 [0]이 머리
  let apple = null;       // 사과 좌표 {x,y}

  // 현재 이동 방향, 다음 이동 방향 (키 입력 버퍼용)
  let vx=1, vy=0, nextVx=1, nextVy=0;

  // 머리 방향(눈/둥근 모서리 계산용)
  let headDx=1, headDy=0;

  let score=0;

  // 게임 상태 플래그
  let isRunning=false;
  let isPaused=false;
  let isGameOver=false;

  // 틱 간격(ms)
  let baseMs=120;   // classic: 항상 이 값 사용
  let tickMs=120;
  let loop=null;    // setInterval 핸들

  // 처음 게임이 시작된 적 있는지 여부
  let hasStarted = false;

  // 키 이벤트 핸들러 참조
  let keyHandler = null;

  // =========================
  // 초기화 / 정리
  // =========================

  /**
   * 게임 모듈 초기화
   * @param {Object} o - {canvas, startBtn, stopBtn, scoreEl, modeEl, diffEl, diffRadios, toast}
   */
  function init(o){
    opt = o;
    canvas = o.canvas;
    ctx = canvas.getContext("2d");
    startBtn = o.startBtn;
    stopBtn = o.stopBtn;
    scoreEl = o.scoreEl;
    modeEl = o.modeEl;
    diffEl = o.diffEl;
    diffRadios = o.diffRadios;
    toastFn = o.toast || function(){};

    modeEl.textContent = "Classic";
    tileSize = canvas.width / tileCount;

     // 모드에 진입할 때마다 "아직 이 세션에서는 시작 안 함" 상태로 초기화
    hasStarted = false;

    // 버튼 이벤트
    startBtn.addEventListener("click", startGameClick);
    stopBtn.addEventListener("click", stopGameClick);

    // 키보드 입력
    keyHandler = onKey;
    document.addEventListener("keydown", keyHandler);

    // 초기 상태 세팅
    reset();
    applyDifficulty(); // 난이도 텍스트만 반영, 속도 고정
  }

  /**
   * 게임 모듈 파괴 (이벤트 해제, 루프 정리)
   */
  function destroy(){
    document.removeEventListener("keydown", keyHandler);
    startBtn.removeEventListener("click", startGameClick);
    stopBtn.removeEventListener("click", stopGameClick);
    if(loop) clearInterval(loop);
  }

  /**
   * 외부에서 난이도 라디오 버튼 변경 시 호출
   */
  function onDifficultyChanged(){
    applyDifficulty();
    if(!isRunning) draw();
  }

  // =========================
  // 난이도 / 속도 (표시만)
  // =========================

  /**
   * Classic 모드 난이도 적용
   * - diffEl 텍스트만 변경
   * - tickMs는 baseMs로 고정 (속도 변화 없음)
   */
  function applyDifficulty(){
    const checked = [...diffRadios].find(r=>r.checked);
    const d = checked ? checked.value : "normal";
    diffEl.textContent = d.charAt(0).toUpperCase()+d.slice(1);

    // Classic에서는 속도 고정
    tickMs = baseMs;

    // 이미 진행 중이면 같은 간격으로 다시 setInterval (실질 변화 없음)
    if(loop){
      clearInterval(loop);
      loop=setInterval(tick,tickMs);
    }
  }

  // =========================
  // 게임 상태 제어
  // =========================

  // Start 버튼 클릭
  function startGameClick(){
    // Start: 처음 시작 or 재시작만, 일시정지 해제 X
    if(!isRunning || isGameOver) startGame();
  }

  // Stop 버튼 클릭 (강제 게임오버)
  function stopGameClick(){
    if(!isGameOver) gameOver();
  }

  /**
   * 게임 상태 초기화 (뱀/사과/점수/플래그 등)
   */
  function reset(){
    const cx = Math.floor(tileCount/2);
    const cy = Math.floor(tileCount/2);

    // 시작 길이 2칸 (오른쪽 진행)
    snake=[
      {x:cx+1,y:cy}, // 머리
      {x:cx,  y:cy}  // 꼬리
    ];
    vx=1;vy=0;
    nextVx=1;nextVy=0;
    headDx=1;headDy=0;
    score=0;
    scoreEl.textContent=score;
    isRunning=false; isPaused=false; isGameOver=false;
    placeApple();
    draw();
  }

  /**
   * 실제 게임 시작 (루프 시작)
   */
  function startGame(){
    // ★ 처음 한 번만 플래그 ON
    if (!hasStarted) hasStarted = true;
    reset();
    isRunning=true;
    if(loop) clearInterval(loop);
    loop=setInterval(tick,tickMs);
  }

  /**
   * 강제 정지(일시정지 아님): 루프만 멈추고 화면은 유지
   */
  function stopGame(){
    isRunning=false; isPaused=false; isGameOver=false;
    if(loop){ clearInterval(loop); loop=null; }
    draw();
  }

  // 일시정지
  function pause(){
    if(!isRunning || isPaused) return;
    isPaused=true;
    if(loop){ clearInterval(loop); loop=null; }
    draw(); // 일시정지 오버레이 표시
  }

  // 일시정지 해제
  function resume(){
    if(!isRunning || !isPaused || isGameOver) return;
    isPaused=false;
    // classic은 tickMs 고정
    loop=setInterval(tick,tickMs);
  }

  // =========================
  // 입력 처리
  // =========================

  function onKey(e){
    const key=e.key;
    // 방향키, 스페이스, ESC는 기본 스크롤/동작 방지
    if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," ","Escape"].includes(key)){
      e.preventDefault();
    }

    // ESC: 일시정지/재개
    if(key==="Escape"){
      if(isRunning && !isPaused) pause();
      else if(isRunning && isPaused) resume();
      return;
    }

    const map={
      ArrowUp:{dx:0,dy:-1},
      ArrowDown:{dx:0,dy:1},
      ArrowLeft:{dx:-1,dy:0},
      ArrowRight:{dx:1,dy:0}
    };
    if(!(key in map)) return;
    const {dx,dy}=map[key];

    // 게임이 멈춰있으면 키 입력으로도 시작
    if(!isRunning && !isGameOver) startGame();
    else if(isGameOver) startGame();
    else if(isPaused) resume();

    // 바로 반대 방향으로는 못 돌게 막기
    if(dx === -vx && dy === -vy) return;
    if(dx === -nextVx && dy === -nextVy) return;

    nextVx=dx; nextVy=dy;
    headDx=dx; headDy=dy;
  }

  // =========================
  // 사과 배치
  // =========================

  function placeApple(){
    let x,y;
    while(true){
      x = rand(0,tileCount-1);
      y = rand(0,tileCount-1);
      // 뱀 몸통과 겹치지 않는 위치
      if(!snake.some(s=>s.x===x && s.y===y)) break;
    }
    apple={x,y};
  }

  // =========================
  // 메인 게임 루프
  // =========================

  function tick(){
    if(!isRunning || isPaused || isGameOver) return;

    // 이동 방향 확정
    vx=nextVx; vy=nextVy;
    const head=snake[0];
    let nx=head.x+vx;
    let ny=head.y+vy;

    // 벽 충돌 체크
    if(nx<0 || nx>=tileCount || ny<0 || ny>=tileCount){
      gameOver(); return;
    }
    // 자기 몸 충돌 체크
    if(snake.some(s=>s.x===nx && s.y===ny)){
      gameOver(); return;
    }

    // 머리 앞으로 한 칸 추가
    snake.unshift({x:nx,y:ny});

    // 사과 먹었는지 체크
    if(apple && nx===apple.x && ny===apple.y){
      score++;
      scoreEl.textContent=score;
      placeApple();   // 사과 새로 생성
      // 꼬리 안 자름 (길이 1 증가)
    } else {
      // 사과 못 먹었으면 꼬리 한 칸 제거 (길이 유지)
      snake.pop();
    }

    draw();
  }

  /**
   * 게임오버 처리
   */
  function gameOver(){
    isGameOver=true;
    isRunning=false;
    if(loop){ clearInterval(loop); loop=null; }
    draw(); // 게임오버 오버레이 표시
  }

  // =========================
  // 그리기
  // =========================

  function draw(){
    // 배경
    ctx.fillStyle="#f5f5f5";
    ctx.fillRect(0,0,canvas.width,canvas.height);

    // 사과
    if(apple){
      drawApple(apple.x, apple.y);
    }

    if(!snake.length) return;

    // 머리
    drawSnakeHead(snake[0].x, snake[0].y);

    // 몸통 (1 ~ length-2)
    for(let i=1;i<snake.length-1;i++){
      const s = snake[i];
      const px = s.x*tileSize;
      const py = s.y*tileSize;

      // 몸통 채우기
      ctx.fillStyle="#2e7d32";
      ctx.fillRect(px, py, tileSize, tileSize);

      // 몸통 윤곽선
      ctx.strokeStyle="#1b5e20";
      ctx.lineWidth=2;
      ctx.strokeRect(px, py, tileSize, tileSize);
    }

    // 꼬리
    if(snake.length>1){
      const tail=snake[snake.length-1];
      const prev=snake[snake.length-2];
      drawSnakeTail(tail.x, tail.y, prev);
    }

    // 오버레이 (게임오버 / 일시정지)
    drawOverlay();
  }

  /**
   * 게임오버 / 일시정지 오버레이
   */
  function drawOverlay(){
  if(isGameOver){
    ctx.fillStyle="rgba(0,0,0,0.5)";
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle="#fff";
    ctx.font="32px Arial";
    ctx.textAlign="center";
    ctx.fillText("GAME OVER", canvas.width/2, canvas.height/2 - 10);
    ctx.font="16px Arial";
    ctx.fillText("Start 버튼 또는 방향키를 눌러 재시작", canvas.width/2, canvas.height/2 + 20);

  } else if(isRunning && isPaused){
    ctx.fillStyle="rgba(0,0,0,0.4)";
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle="#fff";
    ctx.font="28px Arial";
    ctx.textAlign="center";
    ctx.fillText("PAUSED", canvas.width/2, canvas.height/2);
    ctx.font="14px Arial";
    ctx.fillText("ESC 키로 다시 시작", canvas.width/2, canvas.height/2 + 24);

  // ★ 수정: 아직 한 번도 시작 안 했을 때만 시작 안내 화면
  } else if(!hasStarted && !isRunning && !isGameOver){
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";

    ctx.font = "24px Arial";
    ctx.fillText("Snake Classic", canvas.width / 2, canvas.height / 2 - 30);

    ctx.font = "16px Arial";
    ctx.fillText("Start 버튼 또는 방향키를 눌러 시작", canvas.width / 2, canvas.height / 2 + 5);
  }
}



  // =========================
  // 사과 / 뱀 모양
  // =========================

  function drawApple(x,y){
    const cx = x*tileSize + tileSize/2;
    const cy = y*tileSize + tileSize/2;
    const r = tileSize*0.4;
    ctx.fillStyle="#e53935";
    ctx.beginPath();
    ctx.arc(cx,cy,r,0,Math.PI*2);
    ctx.fill();
    ctx.strokeStyle="#b71c1c";
    ctx.lineWidth=2;
    ctx.beginPath();
    ctx.arc(cx,cy,r,0,Math.PI*2);
    ctx.stroke();
    ctx.fillStyle="#2e7d32";
    ctx.beginPath();
    ctx.ellipse(cx+r*0.2, cy-r*0.7, r*0.4, r*0.2, -0.5, 0, Math.PI*2);
    ctx.fill();
  }

  /**
   * 뱀 머리 그리기 (둥근 모서리 + 눈 + 윤곽선)
   */
  function drawSnakeHead(x,y){
    const px = x*tileSize;
    const py = y*tileSize;
    const r = 8;

    ctx.fillStyle="#2e7d32";
    ctx.beginPath();

    const corners = {tl:0,tr:0,br:0,bl:0};
    // 진행 방향에 따라 앞쪽 모서리를 둥글게
    if(headDx === 1){
      corners.tr = r; corners.br = r;
    }else if(headDx === -1){
      corners.tl = r; corners.bl = r;
    }else if(headDy === -1){
      corners.tl = r; corners.tr = r;
    }else{
      corners.bl = r; corners.br = r;
    }

    // 채우기
    roundRectPath(px,py,tileSize,tileSize,corners);
    ctx.fill();

    // 윤곽선
    ctx.strokeStyle="#1b5e20";
    ctx.lineWidth=2;
    ctx.beginPath();
    roundRectPath(px,py,tileSize,tileSize,corners);
    ctx.stroke();

    // 눈
    drawEyes(px,py);
  }

  /**
   * 뱀 꼬리 그리기 (이전 세그먼트 방향 기준 둥근 모서리 + 윤곽선)
   */
  function drawSnakeTail(x,y,prev){
    const px=x*tileSize;
    const py=y*tileSize;
    const r=8;
    const dx = x - prev.x;
    const dy = y - prev.y;

    ctx.fillStyle="#2e7d32";
    ctx.beginPath();

    const corners = {tl:0,tr:0,br:0,bl:0};
    // prev → tail 진행 방향 쪽만 둥글게
    if(dx === 1){
      corners.tr=r; corners.br=r;
    }else if(dx === -1){
      corners.tl=r; corners.bl=r;
    }else if(dy === 1){
      corners.bl=r; corners.br=r;
    }else{
      corners.tl=r; corners.tr=r;
    }

    // 채우기
    roundRectPath(px,py,tileSize,tileSize,corners);
    ctx.fill();

    // 윤곽선
    ctx.strokeStyle="#1b5e20";
    ctx.lineWidth=2;
    ctx.beginPath();
    roundRectPath(px,py,tileSize,tileSize,corners);
    ctx.stroke();
  }

  /**
   * 눈 위치 및 동공 그리기
   */
  function drawEyes(px,py){
    ctx.fillStyle="#fff";
    const e = tileSize*0.2;
    const r = 4;
    let ex1,ey1,ex2,ey2;

    if(headDx === 1){
      ex1=px+tileSize*0.7; ey1=py+e;
      ex2=px+tileSize*0.7; ey2=py+tileSize-e;
    }else if(headDx === -1){
      ex1=px+tileSize*0.3; ey1=py+e;
      ex2=px+tileSize*0.3; ey2=py+tileSize-e;
    }else if(headDy === -1){
      ex1=px+e; ey1=py+tileSize*0.3;
      ex2=px+tileSize-e; ey2=py+tileSize*0.3;
    }else{
      ex1=px+e; ey1=py+tileSize*0.7;
      ex2=px+tileSize-e; ey2=py+tileSize*0.7;
    }

    ctx.beginPath();
    ctx.arc(ex1,ey1,r,0,Math.PI*2);
    ctx.arc(ex2,ey2,r,0,Math.PI*2);
    ctx.fill();

    ctx.fillStyle="#000";
    ctx.beginPath();
    ctx.arc(ex1,ey1,2,0,Math.PI*2);
    ctx.arc(ex2,ey2,2,0,Math.PI*2);
    ctx.fill();
  }

  /**
   * 모서리 개별 반경을 가진 라운드 사각형 path 생성
   */
  function roundRectPath(x,y,w,h,r){
    const tl=r.tl||0, tr=r.tr||0, br=r.br||0, bl=r.bl||0;
    ctx.moveTo(x+tl, y);
    ctx.lineTo(x+w-tr, y);
    if(tr) ctx.quadraticCurveTo(x+w,y,x+w,y+tr);
    else ctx.lineTo(x+w,y);
    ctx.lineTo(x+w, y+h-br);
    if(br) ctx.quadraticCurveTo(x+w,y+h,x+w-br,y+h);
    else ctx.lineTo(x+w,y+h);
    ctx.lineTo(x+bl,y+h);
    if(bl) ctx.quadraticCurveTo(x,y+h,x,y+h-bl);
    else ctx.lineTo(x,y+h);
    ctx.lineTo(x,y+tl);
    if(tl) ctx.quadraticCurveTo(x,y,x+tl,y);
    else ctx.lineTo(x,y);
  }

  // 랜덤 정수 [min,max]
  function rand(min,max){
    return Math.floor(Math.random()*(max-min+1))+min;
  }

})(window);
