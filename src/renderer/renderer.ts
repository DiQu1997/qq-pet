import { RigRenderer, type RigSpec } from "./rig";

interface SheetAnim {
  row: number;
  frames: number;
  fps: number;
  loop: boolean;
}
interface Skin {
  id: string;
  displayName: string;
  renderer: "sheet" | "rig";
  scale: number;
  terms: Record<string, string>;
  sheet?: {
    file: string;
    frameWidth: number;
    frameHeight: number;
    animations: Record<string, SheetAnim>;
  };
  rig?: RigSpec;
  portraits?: { dir: string; map: Record<string, string> };
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const stage = $("stage");
const petBox = $("pet");
const canvas = $<HTMLCanvasElement>("sheet");
const rigBox = $("rig");
const bubbleEl = $("bubble");
const graveEl = $("grave");
const hatEl = $("hat");
const markEl = $("mark");
const sceneEl = $("scene");
const portraitEl = $<HTMLImageElement>("portrait");
const bubbleTextEl = $("bubbleText");

let skin: Skin | null = null;
let outfits: any[] = [];
let snap: any = null;
let rig: RigRenderer | null = null;

// sheet 后端状态
const ctx = canvas.getContext("2d")!;
const sheetImg = new Image();
let current = "idle";
let frame = 0;
let lastFrameAt = 0;
let petW = 138;
let petH = 150;

let bubbleTimer: ReturnType<typeof setTimeout> | null = null;

// ---------- 初始化 ----------
async function init() {
  const sk: Skin = await window.qqpet.requestSkin();
  skin = sk;
  const cfg = await window.qqpet.requestConfig();
  outfits = cfg.outfits ?? [];

  if (sk.renderer === "rig" && sk.rig) {
    canvas.style.display = "none";
    const svgText = await fetch(`skins/${sk.id}/${sk.rig.file}`).then((r) => r.text());
    rig = new RigRenderer(sk.rig, sk.scale);
    await rig.mount(rigBox, svgText);
    petW = rig.size.w;
    petH = rig.size.h;
  } else if (sk.sheet) {
    rigBox.style.display = "none";
    petW = Math.round(sk.sheet.frameWidth * sk.scale);
    petH = Math.round(sk.sheet.frameHeight * sk.scale);
    canvas.width = petW;
    canvas.height = petH;
    sheetImg.src = `skins/${sk.id}/${sk.sheet.file}`;
  }
  positionOverlays();
  requestAnimationFrame(loop);
}

/** 覆盖层(帽子/标记/立绘/场景)按当前宠物尺寸摆位 */
function positionOverlays() {
  const cx = stage.clientWidth / 2;
  const bottom = 0;
  hatEl.style.bottom = `${bottom + petH - 26}px`;
  markEl.style.left = `${cx + petW / 2 - 16}px`;
  markEl.style.bottom = `${bottom + petH - 34}px`;
  sceneEl.style.width = `${petW * 1.08}px`;
  sceneEl.style.height = `${petH * 0.92}px`;
}

function setAnim(name: string) {
  if (name === current) return;
  current = name;
  frame = 0;
  lastFrameAt = 0;
  if (rig) rig.setAnim(name, performance.now());
}

// ---------- 绘制 ----------
function drawSheet(t: number) {
  const s = skin?.sheet;
  if (!s) return;
  let animName = current;
  let hold = false;
  if (animName === "dead") animName = "idle";
  if (animName === "tumble_hold") {
    animName = "tumble";
    hold = true;
  }
  const def = s.animations[animName] ?? s.animations.idle;
  if (!lastFrameAt) lastFrameAt = t;
  if (t - lastFrameAt >= 1000 / def.fps) {
    lastFrameAt = t;
    if (hold) frame = def.frames - 1;
    else if (frame < def.frames - 1) frame++;
    else if (def.loop) frame = 0;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (sheetImg.complete) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      sheetImg,
      Math.min(frame, def.frames - 1) * s.frameWidth,
      def.row * s.frameHeight,
      s.frameWidth,
      s.frameHeight,
      0,
      0,
      petW,
      petH,
    );
  }
}

function loop(t: number) {
  if (rig) rig.draw(t);
  else drawSheet(t);
  requestAnimationFrame(loop);
}

// ---------- 状态同步 ----------
/** 心情/病情 → 情绪立绘 key */
function emotionOf(s: any): string {
  if (!s) return "normal";
  if (s.dead) return "dizzy";
  if (s.sickness) return "pain";
  if (s.dnd) return "sigh";
  if (s.activity?.type === "work") return "determined";
  if (s.activity?.type === "travel") return "inspired";
  if (s.activity?.type === "school") return "normal";
  const m = s.mood ?? 0;
  if (m >= 900) return "joyous";
  if (m >= 700) return "happy";
  if (m >= 400) return "normal";
  if (m >= 200) return "sad";
  return "crying";
}

function applySnapshot(s: any) {
  snap = s;
  const st = s.state;

  // 死亡 → 坟墓
  const dead = !!st.dead;
  graveEl.style.display = dead ? "block" : "none";
  petBox.classList.toggle("hidden", dead);
  hatEl.style.display = dead ? "none" : "block";
  if (dead) $("graveName").textContent = st.name;

  // 装扮
  const hat = outfits.find((o) => o.id === st.outfit?.hat);
  hatEl.textContent = hat?.emoji ?? "";
  const scene = outfits.find((o) => o.id === st.outfit?.scene);
  sceneEl.style.background = scene?.color ?? "transparent";

  // 病态标记
  markEl.textContent = st.sickness && !dead ? "🤒" : "";

}

function showBubble(text: string) {
  if (!text) return;
  // 有立绘的皮肤:气泡里带上当前情绪的脸
  if (skin?.portraits && snap?.state) {
    const key = emotionOf(snap.state);
    const file = skin.portraits.map[key] ?? skin.portraits.map.normal;
    portraitEl.src = `skins/${skin.id}/${skin.portraits.dir}/${file}`;
    portraitEl.style.display = "block";
  }
  bubbleTextEl.textContent = text;
  bubbleEl.classList.add("show");
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubbleEl.classList.remove("show"), 3800);
}

// ---------- 交互 ----------
function inPet(e: MouseEvent): boolean {
  const cx = stage.clientWidth / 2;
  return (
    Math.abs(e.offsetX - cx) <= petW / 2 + 6 &&
    e.offsetY >= stage.clientHeight - petH - 12
  );
}

let downPos = { x: 0, y: 0 };
let draggingNow = false;
let clickTimer: ReturnType<typeof setTimeout> | null = null;

stage.addEventListener("mousedown", (e) => {
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

stage.addEventListener("click", (e) => {
  if (draggingNow || !inPet(e) || clickTimer) return;
  clickTimer = setTimeout(() => {
    clickTimer = null;
    window.qqpet.petClick();
  }, 220);
});

stage.addEventListener("dblclick", (e) => {
  if (!inPet(e)) return;
  if (clickTimer) {
    clearTimeout(clickTimer);
    clickTimer = null;
  }
  window.qqpet.petDoubleClick();
});

stage.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  window.qqpet.petMenu();
});

window.qqpet.onAnim(setAnim);
window.qqpet.onBubble(showBubble);
window.qqpet.onSnapshot(applySnapshot);

init();

export {};
