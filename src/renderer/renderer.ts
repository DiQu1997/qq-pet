interface AnimDef {
  row: number;
  frames: number;
  fps: number;
  loop: boolean;
}
interface SpriteMeta {
  sheet: string;
  frameWidth: number;
  frameHeight: number;
  animations: Record<string, AnimDef>;
}

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

const sheet = new Image();
let meta: SpriteMeta | null = null;

let current = "idle";
let frame = 0;
let lastFrameAt = 0;
let bubbleText = "";
let bubbleUntil = 0;
let snap: any = null;
let outfits: any[] = [];

const PET_SCALE = 0.72;
let petW = 138;
let petH = 150;
let petX = 0;
let petY = 0;

async function init() {
  meta = await fetch("assets/sprites.json").then((r) => r.json());
  const cfg = await window.qqpet.requestConfig();
  outfits = cfg.outfits ?? [];
  petW = Math.round(meta!.frameWidth * PET_SCALE);
  petH = Math.round(meta!.frameHeight * PET_SCALE);
  petX = Math.round((canvas.width - petW) / 2);
  petY = canvas.height - petH;
  sheet.src = "assets/" + meta!.sheet;
  requestAnimationFrame(loop);
}

function setAnim(name: string) {
  if (name === current) return;
  // 伪动画:dead(坟墓)/tumble_hold(趴地不动)由绘制层处理
  current = name;
  frame = 0;
  lastFrameAt = 0;
}

function drawBubble(text: string) {
  ctx.font = "13px 'PingFang SC', sans-serif";
  const padding = 8;
  const maxW = canvas.width - 16;
  const w = Math.min(ctx.measureText(text).width + padding * 2, maxW);
  const h = 26;
  const x = (canvas.width - w) / 2;
  const y = 8;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.strokeStyle = "#f5a0b9";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 10);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(canvas.width / 2 - 5, y + h);
  ctx.lineTo(canvas.width / 2 + 5, y + h);
  ctx.lineTo(canvas.width / 2, y + h + 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#5a3e48";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, y + h / 2, maxW - padding * 2);
}

function drawTombstone() {
  const cx = canvas.width / 2;
  const baseY = canvas.height - 20;
  ctx.fillStyle = "#9aa0a8";
  ctx.beginPath();
  ctx.roundRect(cx - 45, baseY - 110, 90, 110, [45, 45, 4, 4]);
  ctx.fill();
  ctx.fillStyle = "#7d838c";
  ctx.beginPath();
  ctx.roundRect(cx - 58, baseY - 12, 116, 14, 4);
  ctx.fill();
  ctx.fillStyle = "#5a5f66";
  ctx.font = "bold 16px 'PingFang SC', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("R.I.P", cx, baseY - 80);
  ctx.font = "12px 'PingFang SC', sans-serif";
  ctx.fillText(snap?.state?.name ?? "", cx, baseY - 58);
  ctx.font = "18px sans-serif";
  ctx.fillText("🌼", cx - 40, baseY - 4);
  ctx.fillText("🌼", cx + 40, baseY - 4);
}

function drawScene() {
  const sceneId = snap?.state?.outfit?.scene;
  if (!sceneId) return;
  const o = outfits.find((x) => x.id === sceneId);
  if (!o?.color) return;
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = o.color;
  ctx.beginPath();
  ctx.ellipse(canvas.width / 2, petY + petH * 0.62, petW * 0.78, petH * 0.66, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHat() {
  const hatId = snap?.state?.outfit?.hat;
  if (!hatId || snap?.state?.dead) return;
  const o = outfits.find((x) => x.id === hatId);
  if (!o?.emoji) return;
  ctx.font = "34px sans-serif";
  ctx.textAlign = "center";
  // 帽子戴在头顶,随待机帧轻微浮动
  const bob = Math.sin(Date.now() / 300) * 2;
  ctx.fillText(o.emoji, canvas.width / 2 + 6, petY + 26 + bob);
}

function drawSickMark() {
  if (!snap?.state?.sickness || snap?.state?.dead) return;
  ctx.font = "22px sans-serif";
  ctx.textAlign = "center";
  const pulse = Math.sin(Date.now() / 250) * 3;
  ctx.fillText("🤒", canvas.width / 2 + petW / 2 - 8, petY + 30 + pulse);
}

function loop(t: number) {
  if (!meta) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (snap?.state?.dead) {
    drawTombstone();
    if (bubbleText && Date.now() < bubbleUntil) drawBubble(bubbleText);
    requestAnimationFrame(loop);
    return;
  }

  let animName = current;
  let holdLastFrame = false;
  if (animName === "dead") animName = "idle";
  if (animName === "tumble_hold") {
    animName = "tumble";
    holdLastFrame = true;
  }
  const def = meta.animations[animName] ?? meta.animations.idle;
  if (!lastFrameAt) lastFrameAt = t;
  if (t - lastFrameAt >= 1000 / def.fps) {
    lastFrameAt = t;
    if (holdLastFrame) frame = def.frames - 1;
    else if (frame < def.frames - 1) frame++;
    else if (def.loop) frame = 0;
  }

  drawScene();
  if (sheet.complete) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      sheet,
      Math.min(frame, def.frames - 1) * meta.frameWidth,
      def.row * meta.frameHeight,
      meta.frameWidth,
      meta.frameHeight,
      petX,
      petY,
      petW,
      petH,
    );
  }
  drawHat();
  drawSickMark();
  if (bubbleText && Date.now() < bubbleUntil) drawBubble(bubbleText);
  requestAnimationFrame(loop);
}

// ---------- 交互 ----------
let downPos = { x: 0, y: 0 };
let draggingNow = false;
let clickTimer: ReturnType<typeof setTimeout> | null = null;

function inPet(e: MouseEvent): boolean {
  return e.offsetX >= petX && e.offsetX <= petX + petW && e.offsetY >= petY - 10;
}

canvas.addEventListener("mousedown", (e) => {
  if (e.button === 2 || !inPet(e)) return;
  downPos = { x: e.screenX, y: e.screenY };
  const onMove = (me: MouseEvent) => {
    if (!draggingNow && Math.hypot(me.screenX - downPos.x, me.screenY - downPos.y) > 6) {
      draggingNow = true;
      window.qqpet.dragStart(e.offsetX, e.offsetY);
    }
  };
  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    if (draggingNow) {
      draggingNow = false;
      window.qqpet.dragEnd();
    }
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
});

canvas.addEventListener("click", (e) => {
  if (draggingNow || !inPet(e)) return;
  if (clickTimer) return;
  clickTimer = setTimeout(() => {
    clickTimer = null;
    window.qqpet.petClick();
  }, 220);
});

canvas.addEventListener("dblclick", (e) => {
  if (!inPet(e)) return;
  if (clickTimer) {
    clearTimeout(clickTimer);
    clickTimer = null;
  }
  window.qqpet.petDoubleClick();
});

canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  window.qqpet.petMenu();
});

window.qqpet.onAnim((name) => setAnim(name));
window.qqpet.onBubble((text) => {
  bubbleText = text;
  bubbleUntil = Date.now() + 3800;
});
window.qqpet.onSnapshot((s) => {
  snap = s;
});

init();

export {};
