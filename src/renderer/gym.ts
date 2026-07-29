/**
 * 局域网健身房:同一个房间里的所有宠物同屏显示。
 *
 * 布局不需要协商:名单按 id 排序后,序号即工位。每台机器拿到的是同一份
 * 有序名单,算出的画面自然一致 —— 不用选主,也不用同步坐标。
 */
import { PetSprite, type SpriteSkin } from "./pet-sprite";

const $ = (id: string) => document.getElementById(id)!;

/**
 * 工位定义。三层叠加才看得出"在运动":
 *   anim   — 皮肤自带的精灵动画
 *   motion — 叠在宠物身上的 CSS 节奏(起伏/深蹲/呼吸)
 *   equip  — 器械本身的动画(履带滚动、杠铃起落、车轮转)
 * 其中 equip 是主要信号:静态器械配原地走路,看起来只会像在发呆。
 */
interface Station {
  gear: string;
  anim: string;
  motion: string;
  /** 器械 DOM;fx 是汗滴之类的特效 */
  equip: string;
  fx?: string;
}
const STATIONS: Station[] = [
  {
    gear: "🏃 跑步机", anim: "gymRun", motion: "m-run",
    equip: `<div class="equip treadmill"><div class="belt"></div><div class="base"></div>
            <div class="console"><i></i></div></div>`,
    fx: `<span class="fx sweat">💧</span><span class="fx sweat b">💧</span>`,
  },
  {
    gear: "🏋️ 举铁区", anim: "gymLift", motion: "m-lift",
    equip: `<div class="equip weights"><div class="plate"></div></div>`,
    // 杠铃挂在 pet-wrap 里才能压在头顶,放器械层会从躯干穿过去
    fx: `<div class="barbell"></div><span class="fx sweat">💧</span>`,
  },
  {
    gear: "🧘 瑜伽垫", anim: "gymStretch", motion: "m-breathe",
    equip: `<div class="equip yoga"><div class="mat"><i></i></div></div>`,
  },
  {
    gear: "🚴 动感单车", anim: "gymRun", motion: "m-pedal",
    equip: `<div class="equip bike"><div class="seat"></div><div class="wheel"></div><div class="frame"></div></div>`,
    fx: `<span class="fx sweat">💧</span>`,
  },
  {
    gear: "🤸 跳操区", anim: "gymJump", motion: "m-jump",
    equip: `<div class="equip aerobic"><div class="pad"></div></div>`,
    fx: `<span class="fx puff">💨</span>`,
  },
  {
    gear: "🥊 沙袋区", anim: "gymBox", motion: "m-box",
    equip: `<div class="equip bagzone"><div class="pad"></div></div>`,
    // 沙袋吊在侧面,被打时会晃
    fx: `<div class="punchbag"><i></i></div><span class="fx sweat">💧</span>`,
  },
  {
    gear: "🪢 跳绳区", anim: "gymRope", motion: "m-rope",
    equip: `<div class="equip ropezone"><div class="pad"></div></div>`,
    fx: `<div class="rope"></div><span class="fx sweat">💧</span>`,
  },
  {
    gear: "🛋️ 休息区", anim: "sleep", motion: "m-rest",
    equip: `<div class="equip rest"><div class="sofa"></div></div>`,
  },
];
const MAX_SLOTS = STATIONS.length;

let cfg: any = null;
let selfId = "";
const skinCache = new Map<string, SpriteSkin>();
/** 当前画面上的精灵:id → {sprite, slotEl} */
const live = new Map<string, { sprite: PetSprite; el: HTMLElement }>();

async function getSkin(id: string): Promise<SpriteSkin | null> {
  if (skinCache.has(id)) return skinCache.get(id)!;
  try {
    const s = await fetch(`skins/${id}/skin.json`).then((r) => r.json());
    skinCache.set(id, s);
    return s;
  } catch {
    return null; // 本机没有这套皮肤
  }
}

/**
 * 工位横坐标:以房间中心为基准等距排开,而不是铺满整个宽度 ——
 * 只有两个人时铺满会把它们甩到左右边缘,画面很空。
 */
function slotX(index: number, total: number): number {
  const w = $("room").clientWidth;
  const cx = w / 2;
  if (total <= 1) return cx;
  const gap = Math.min(190, (w - 150) / (total - 1));
  return cx + (index - (total - 1) / 2) * gap;
}

async function syncRoster(members: any[]): Promise<void> {
  const shown = members.slice(0, MAX_SLOTS);
  $("empty").style.display = shown.length > 1 ? "none" : "block";
  $("status").textContent = shown.length
    ? `房间里有 ${shown.length} 位${members.length > MAX_SLOTS ? `(只显示前 ${MAX_SLOTS} 位)` : ""}`
    : "";

  // 走掉的人:移除精灵
  const ids = new Set(shown.map((m) => m.id));
  for (const [id, item] of live) {
    if (!ids.has(id)) {
      item.el.remove();
      live.delete(id);
    }
  }

  const slots = $("slots");

  for (let i = 0; i < shown.length; i++) {
    const m = shown[i];
    const station = STATIONS[i % MAX_SLOTS];
    let item = live.get(m.id);

    if (!item) {
      const skin = await getSkin(m.skinId);
      if (!skin) continue; // 本机没这套皮肤,先跳过(约定双方都有)
      const el = document.createElement("div");
      el.className = "slot" + (m.id === selfId ? " me" : "");
      const sprite = new PetSprite(skin, {
        // 房间里统一缩小一点,保证多只能排得下
        scale: (skin.scale ?? 1) * 0.85,
        outfits: cfg?.outfits ?? [],
      });
      // 宠物外面套一层做运动节奏,不干扰精灵动画本身
      const wrap = document.createElement("div");
      wrap.className = `pet-wrap ${station.motion}`;
      wrap.appendChild(sprite.el);
      if (station.fx) wrap.insertAdjacentHTML("beforeend", station.fx);
      el.appendChild(wrap);
      // 器械与器械名跟宠物同属一个纵向流,天然对齐
      el.insertAdjacentHTML("beforeend", station.equip);
      const label = document.createElement("div");
      label.className = "label";
      label.textContent = station.gear;
      el.appendChild(label);
      slots.appendChild(el);
      await sprite.mount();
      item = { sprite, el };
      live.set(m.id, item);
    }

    item.el.style.left = `${slotX(i, shown.length)}px`;
    item.sprite.setInfo({ name: m.name, level: m.level, outfit: m.outfit });
    item.sprite.setAnim(station.anim);
  }
}

function loop(t: number): void {
  for (const { sprite } of live.values()) sprite.draw(t);
  requestAnimationFrame(loop);
}

$("close").onclick = () => {
  window.qqpet.gymLeave();
  window.qqpet.closeWindow();
};

window.qqpet.onRoom((members) => {
  syncRoster(members);
});

(async () => {
  cfg = await window.qqpet.requestConfig();
  const info = await window.qqpet.gymJoin();
  selfId = info.selfId;
  await syncRoster(info.members);
  requestAnimationFrame(loop);
  // 名单靠推送,但轮询兜底(有人静默掉线时 TTL 到期需要重算布局)
  setInterval(async () => {
    const r = await window.qqpet.gymRoster();
    await syncRoster(r.members);
  }, 2000);
})();

export {};
