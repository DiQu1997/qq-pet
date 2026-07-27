const mazeCanvas = document.getElementById("maze") as HTMLCanvasElement;
const mctx = mazeCanvas.getContext("2d")!;
const COLS = 20;
const ROWS = 15;
const CELL = 22;

// 每格四面墙:[上,右,下,左]
type Cell = [boolean, boolean, boolean, boolean];
const grid: Cell[][] = [];
let px = 0;
let py = 0;
let timeLeft = 90;
let running = false;
let doneSent = false;

function genMaze() {
  for (let y = 0; y < ROWS; y++) {
    grid[y] = [];
    for (let x = 0; x < COLS; x++) grid[y][x] = [true, true, true, true];
  }
  const visited = new Set<string>();
  const stack: [number, number][] = [[0, 0]];
  visited.add("0,0");
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const neighbors: [number, number, number, number][] = [];
    const dirs: [number, number, number, number][] = [
      [cx, cy - 1, 0, 2],
      [cx + 1, cy, 1, 3],
      [cx, cy + 1, 2, 0],
      [cx - 1, cy, 3, 1],
    ];
    for (const [nx, ny, wall, oppWall] of dirs) {
      if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && !visited.has(`${nx},${ny}`))
        neighbors.push([nx, ny, wall, oppWall]);
    }
    if (!neighbors.length) {
      stack.pop();
      continue;
    }
    const [nx, ny, wall, oppWall] = neighbors[Math.floor(Math.random() * neighbors.length)];
    grid[cy][cx][wall] = false;
    grid[ny][nx][oppWall] = false;
    visited.add(`${nx},${ny}`);
    stack.push([nx, ny]);
  }
}

function draw() {
  mctx.clearRect(0, 0, mazeCanvas.width, mazeCanvas.height);
  mctx.strokeStyle = "#3d5266";
  mctx.lineWidth = 2;
  const ox = (mazeCanvas.width - COLS * CELL) / 2;
  const oy = (mazeCanvas.height - ROWS * CELL) / 2;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const c = grid[y][x];
      const X = ox + x * CELL;
      const Y = oy + y * CELL;
      mctx.beginPath();
      if (c[0]) (mctx.moveTo(X, Y), mctx.lineTo(X + CELL, Y));
      if (c[1]) (mctx.moveTo(X + CELL, Y), mctx.lineTo(X + CELL, Y + CELL));
      if (c[2]) (mctx.moveTo(X, Y + CELL), mctx.lineTo(X + CELL, Y + CELL));
      if (c[3]) (mctx.moveTo(X, Y), mctx.lineTo(X, Y + CELL));
      mctx.stroke();
    }
  }
  mctx.font = `${CELL - 6}px sans-serif`;
  mctx.textAlign = "center";
  mctx.textBaseline = "middle";
  mctx.fillText("🚪", ox + (COLS - 0.5) * CELL, oy + (ROWS - 0.5) * CELL);
  mctx.fillText("🐧", ox + (px + 0.5) * CELL, oy + (py + 0.5) * CELL);
}

async function finish(escaped: boolean) {
  if (doneSent) return;
  doneSent = true;
  running = false;
  const res = await window.qqpet.action("maze.finish", escaped ? "1" : "0");
  document.getElementById("tip")!.textContent = res.message + "(3 秒后关闭)";
  setTimeout(() => window.qqpet.closeWindow(), 3200);
}

window.addEventListener("keydown", (e) => {
  if (!running) return;
  const c = grid[py][px];
  if (e.key === "ArrowUp" && !c[0]) py--;
  else if (e.key === "ArrowRight" && !c[1]) px++;
  else if (e.key === "ArrowDown" && !c[2]) py++;
  else if (e.key === "ArrowLeft" && !c[3]) px--;
  else return;
  e.preventDefault();
  draw();
  if (px === COLS - 1 && py === ROWS - 1) finish(true);
});

(async () => {
  const cfg = await window.qqpet.requestConfig();
  timeLeft = cfg.games.maze.timeLimitSec;
  const start = await window.qqpet.action("maze.start");
  if (!start.ok) {
    document.getElementById("tip")!.textContent = start.message;
    document.getElementById("timer")!.textContent = "0";
    return;
  }
  genMaze();
  running = true;
  draw();
  const timerEl = document.getElementById("timer")!;
  timerEl.textContent = String(timeLeft);
  const tick = setInterval(() => {
    if (!running) return clearInterval(tick);
    timeLeft--;
    timerEl.textContent = String(timeLeft);
    if (timeLeft <= 0) {
      clearInterval(tick);
      finish(false);
    }
  }, 1000);
})();

document.getElementById("close")!.onclick = () => {
  if (running) finish(false);
  else window.qqpet.closeWindow();
};

export {};
