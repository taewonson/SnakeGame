// classic_script.js
(function(global){
  const SnakeClassic = { init, destroy, onDifficultyChanged };

  global.SnakeGames = global.SnakeGames || {};
  global.SnakeGames.classic = SnakeClassic;

  let opt = {};
  let canvas, ctx;
  let startBtn, stopBtn, scoreEl, modeEl, diffEl, diffRadios;
  let toastFn;

  const tileCount = 25;
  let tileSize;

  let snake = [];
  let apple = null;

  let vx=1, vy=0, nextVx=1, nextVy=0;
  let headDx=1, headDy=0;

  let score=0;
  let isRunning=false, isPaused=false, isGameOver=false;
  let baseMs=120, tickMs=120;
  let loop=null;

  let keyHandler = null;

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

    startBtn.addEventListener("click", startGameClick);
    stopBtn.addEventListener("click", stopGameClick);

    keyHandler = onKey;
    document.addEventListener("keydown", keyHandler);

    reset();
    applyDifficulty();
  }

  function destroy(){
    document.removeEventListener("keydown", keyHandler);
    startBtn.removeEventListener("click", startGameClick);
    stopBtn.removeEventListener("click", stopGameClick);
    if(loop) clearInterval(loop);
  }

  function onDifficultyChanged(){
    applyDifficulty();
    if(!isRunning) draw();
  }

  function startGameClick(){
    // Start: 처음 시작 or 재시작만, 일시정지 해제 X
    if(!isRunning || isGameOver) startGame();
  }

  function stopGameClick(){
    // Stop: 강제 GAME OVER
  if(!isGameOver) gameOver();
  }

  function applyDifficulty(){
    const checked = [...diffRadios].find(r=>r.checked);
    const d = checked ? checked.value : "normal";
    diffEl.textContent = d.charAt(0).toUpperCase()+d.slice(1);

    let mul=1;
    if(d==="easy") mul=1.1;
    else if(d==="hard") mul=0.9;
    tickMs = baseMs * mul;

    if(loop){
      clearInterval(loop);
      loop=setInterval(tick,tickMs);
    }
  }

  function reset(){
    const cx = Math.floor(tileCount/2);
    const cy = Math.floor(tileCount/2);
    // 시작 길이 2칸 (오른쪽으로 진행 중)
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

  function startGame(){
    reset();
    isRunning=true;
    if(loop) clearInterval(loop);
    loop=setInterval(tick,tickMs);
  }

  function stopGame(){
    isRunning=false; isPaused=false; isGameOver=false;
    if(loop){ clearInterval(loop); loop=null; }
    draw();
  }

  function pause(){
    if(!isRunning || isPaused) return;
    isPaused=true;
    if(loop){ clearInterval(loop); loop=null; }
    draw(); // 일시정지 오버레이 표시
  }

  function resume(){
    if(!isRunning || !isPaused || isGameOver) return;
    isPaused=false;
    applyDifficulty();
    loop=setInterval(tick,tickMs);
  }

  function onKey(e){
    const key=e.key;
    if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," ","Escape"].includes(key)){
      e.preventDefault();
    }

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

    if(!isRunning && !isGameOver) startGame();
    else if(isGameOver) startGame();
    else if(isPaused) resume();

    if(dx === -vx && dy === -vy) return;
    if(dx === -nextVx && dy === -nextVy) return;

    nextVx=dx; nextVy=dy;
    headDx=dx; headDy=dy;
  }

  function placeApple(){
    let x,y;
    while(true){
      x = rand(0,tileCount-1);
      y = rand(0,tileCount-1);
      if(!snake.some(s=>s.x===x && s.y===y)) break;
    }
    apple={x,y};
  }

  function tick(){
    if(!isRunning || isPaused || isGameOver) return;

    vx=nextVx; vy=nextVy;
    const head=snake[0];
    let nx=head.x+vx;
    let ny=head.y+vy;

    if(nx<0 || nx>=tileCount || ny<0 || ny>=tileCount){
      gameOver(); return;
    }
    if(snake.some(s=>s.x===nx && s.y===ny)){
      gameOver(); return;
    }

    snake.unshift({x:nx,y:ny});

    if(apple && nx===apple.x && ny===apple.y){
      score++;
      scoreEl.textContent=score;
      placeApple();
    } else {
      snake.pop();
    }

    draw();
  }

  function gameOver(){
    isGameOver=true;
    isRunning=false;
    if(loop){ clearInterval(loop); loop=null; }
    draw(); // 게임오버 오버레이 표시
  }

  function draw(){
    ctx.fillStyle="#f5f5f5";
    ctx.fillRect(0,0,canvas.width,canvas.height);

    if(apple){
      drawApple(apple.x, apple.y);
    }

    if(!snake.length) return;

    drawSnakeHead(snake[0].x, snake[0].y);

    for(let i=1;i<snake.length-1;i++){
      const s = snake[i];
      ctx.fillStyle="#2e7d32"; // 몸통도 머리/꼬리와 색 통일
      ctx.fillRect(s.x*tileSize, s.y*tileSize, tileSize, tileSize);
    }

    if(snake.length>1){
      const tail=snake[snake.length-1];
      const prev=snake[snake.length-2];
      drawSnakeTail(tail.x, tail.y, prev);
    }

    drawOverlay();
  }

  function drawOverlay(){
    if(isGameOver){
      ctx.fillStyle="rgba(0,0,0,0.5)";
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle="#fff";
      ctx.font="32px Arial";
      ctx.textAlign="center";
      ctx.fillText("GAME OVER", canvas.width/2, canvas.height/2 - 10);
      ctx.font="16px Arial";
      ctx.fillText("Start 버튼으로 새 게임 시작", canvas.width/2, canvas.height/2 + 20);
    } else if(isRunning && isPaused){
      ctx.fillStyle="rgba(0,0,0,0.4)";
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle="#fff";
      ctx.font="28px Arial";
      ctx.textAlign="center";
      ctx.fillText("PAUSED", canvas.width/2, canvas.height/2);
      ctx.font="14px Arial";
      ctx.fillText("ESC 키로 다시 시작", canvas.width/2, canvas.height/2 + 24);
    }
  }

  // ===== 사과 / 뱀 모양 =====

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

  function drawSnakeHead(x,y){
    const px = x*tileSize;
    const py = y*tileSize;
    const r = 8;
    ctx.fillStyle="#2e7d32";
    ctx.beginPath();

    const corners = {tl:0,tr:0,br:0,bl:0};
    if(headDx === 1){
      corners.tr = r; corners.br = r;
    }else if(headDx === -1){
      corners.tl = r; corners.bl = r;
    }else if(headDy === -1){
      corners.tl = r; corners.tr = r;
    }else{
      corners.bl = r; corners.br = r;
    }

    roundRectPath(px,py,tileSize,tileSize,corners);
    ctx.fill();

    drawEyes(px,py);
  }

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

    roundRectPath(px,py,tileSize,tileSize,corners);
    ctx.fill();
  }

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

  function rand(min,max){
    return Math.floor(Math.random()*(max-min+1))+min;
  }

})(window);
