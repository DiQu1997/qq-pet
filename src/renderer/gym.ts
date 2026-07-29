/**
 * 局域网健身房:同一个房间里的所有宠物同屏显示。
 *
 * 布局不需要协商:名单按 id 排序后,序号即工位。每台机器拿到的是同一份
 * 有序名单,算出的画面自然一致 —— 不用选主,也不用同步坐标。
 */
import { PetSprite, type SpriteSkin } from "./pet-sprite";

const $ = (id: string) => document.getElementById(id)!;

/** 工位:器械名 + 该位置做什么动作。动作沿用皮肤已有的动画 */
const STATIONS = [
  { gear: "🏃 跑步机", anim: "walkRight" },
  { gear: "🏋️ 举铁区", anim: "dance" },
  { gear: "🧘 瑜伽垫", anim: "idle" },
  { gear: "🚴 动感单车", anim: "walkLeft" },
  { gear: "🤸 跳操区", anim: "dance" },
  { gear: "🛋️ 休息区", anim: "sleep" },
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
        scale: (skin.scale ?? 1) * 0.72,
        outfits: cfg?.outfits ?? [],
      });
      el.appendChild(sprite.el);
      // 垫子与器械名跟宠物同属一个纵向流,天然对齐
      const mat = document.createElement("div");
      mat.className = "mat";
      const label = document.createElement("div");
      label.className = "label";
      label.textContent = station.gear;
      el.append(mat, label);
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
