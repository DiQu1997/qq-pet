/**
 * 测试用 preload 桩:模拟 src/main/preload.ts 暴露的 window.qqpet。
 *
 * ⚠ 这个桩必须和真实 preload 的接口 **完全一致**:
 *   - 少一个方法(如 onUiPrefs),渲染层调用时会 TypeError,整个脚本静默死掉;
 *   - 快照少字段(如 level),界面显示 undefined 却不会让测试失败 —— 假通过。
 * 本项目已经因为这两点各踩过一次,改动时请对照 src/main/preload.ts 逐项核对。
 */
const { contextBridge } = require("electron");
const fs = require("fs");
const DIST = require("path").join(__dirname, "..", "dist");
const SKIN_ID = process.env.SKIN_ID || "penguin";
const skin = JSON.parse(fs.readFileSync(`${DIST}/skins/${SKIN_ID}/skin.json`, "utf-8"));
const cfg = JSON.parse(fs.readFileSync(`${DIST}/config.json`, "utf-8"));

const state = {
  name: skin.terms.defaultName, gender: "QGG", generation: 1, parents: null,
  hunger: 2600, clean: 1900, mood: 850, health: 5, growth: 120, yuanbao: 640,
  dnd: false, onlineMinutes: 512, sickness: null, dead: false,
  inventory: {}, activity: { type: "none", refId: "", minutes: 0, plannedMinutes: 0, unpaidMinutes: 0 },
  completedCourses: [], currentCourse: null, stats: { wu: 5, zhi: 5, mei: 5 },
  marriage: null, freeRingClaimed: false, daily: {}, dreamRewardCount: 0,
  outfit: { hat: null, scene: null }, ownedOutfits: [], pinkUntil: 0,
};

let animCb = () => {};
let snapCb = () => {};
let bubbleCb = () => {};
let gotoCb = () => {};
let uiCb = () => {};
let peersCb = () => {};
let roomCb = () => {};

/** 健身房假名单:一只企鹅 + 一只卡比兽,验证跨皮肤同屏 */
let roomState = {
  selfId: "aaa-1",
  members: [
    { id: "aaa-1", room: "gym", name: "阿尔法", level: 10, skinId: "penguin",
      gender: "QGG", outfit: { hat: "hat_crown", scene: null }, lastSeen: Date.now() },
    { id: "bbb-2", room: "gym", name: "贝塔", level: 7, skinId: "snorlax",
      gender: "QMM", outfit: { hat: null, scene: null }, lastSeen: Date.now() },
  ],
};

/** 局域网假状态,测试里可用 __drive.lan() 替换 */
let lanState = {
  enabled: true,
  running: true,
  peers: [
    { id: "peer-1", name: "卡比", level: 1, skinId: "snorlax", gender: "QGG",
      host: "10.0.0.169", port: 50947, lastSeen: Date.now() },
  ],
  diag: { running: true, selfId: "self-test", httpPort: 54493,
          localIp: "10.0.0.104", beaconsSent: 12, lastBeaconError: null, peerCount: 1 },
};

/** 完整快照:字段须与 StatusSnapshot 对齐,派生规则照抄引擎,避免与产品脱节 */
function snapshot() {
  const level = cfg.levelGrowth.filter((g) => state.growth >= g).length || 1;
  const attrMax =
    cfg.attr.baseMax + cfg.attr.perLevelMax * Math.min(level, cfg.attr.maxLevelForAttr);
  const band =
    cfg.growthByMood.find((b) => state.mood >= b.min) ||
    cfg.growthByMood[cfg.growthByMood.length - 1];
  const label = (v, bands) => {
    for (const b of bands) if (b.pct > 0 && v >= attrMax * b.pct) return b.label;
    return bands[bands.length - 1].label;
  };
  return {
    state,
    level,
    hungerMax: attrMax,
    cleanMax: attrMax,
    hungerLabel: label(state.hunger, cfg.hungerStates),
    cleanLabel: label(state.clean, cfg.cleanStates),
    moodLabel: band.label,
    moodColor: band.color,
    growthPerHour: band.perHour,
    levelBase: cfg.levelGrowth[level - 1] ?? 0,
    nextLevelGrowth: cfg.levelGrowth[level] ?? null,
    sicknessInfo: null,
    isPink: state.pinkUntil > Date.now(),
    activityLabel: "",
  };
}

const calls = [];

// —— 与 src/main/preload.ts 一一对应 ——
contextBridge.exposeInMainWorld("qqpet", {
  onSnapshot(cb) { snapCb = cb; },
  onBubble(cb) { bubbleCb = cb; },
  onAnim(cb) { animCb = cb; },
  onGotoTab(cb) { gotoCb = cb; },
  onUiPrefs(cb) { uiCb = cb; },
  petClick() { calls.push("click"); },
  petDoubleClick() { calls.push("dblclick"); },
  petMenu() { calls.push("menu"); },
  dragStart(x, y) { calls.push(`drag:${Math.round(x)},${Math.round(y)}`); },
  dragEnd() {},
  setInteractive(on) { calls.push(`interactive:${on}`); },
  async action(kind, id) { calls.push(`${kind}:${id ?? ""}`); return { ok: true, message: "预览" }; },
  async requestSnapshot() { return snapshot(); },
  async requestConfig() { return cfg; },
  async requestSkin() { return skin; },
  // —— 局域网(测试用假数据)——
  async requestPeers() { return lanState; },
  async peerCard(id) {
    const p = lanState.peers.find((x) => x.id === id);
    return p ? { ok: true, card: p } : { ok: false, message: "对方不在家" };
  },
  async visitStart(id) {
    calls.push(`visit:${id}`);
    return { ok: true, message: "出发去串门啦" };
  },
  onPeers(cb) { peersCb = cb; },
  // —— 健身房(测试用假名单)——
  openGym() {},
  async gymJoin() { return { selfId: roomState.selfId, members: roomState.members }; },
  async gymRoster() { return { members: roomState.members }; },
  gymLeave() {},
  onRoom(cb) { roomCb = cb; },
  closeWindow() {},
  openGame() {},
});

// —— 测试驱动接口 ——
contextBridge.exposeInMainWorld("__calls", {
  get: () => calls.slice(),
  clear: () => (calls.length = 0),
});
contextBridge.exposeInMainWorld("__gotoTab", (t) => gotoCb(t));
contextBridge.exposeInMainWorld("__drive", {
  anim: (n) => animCb(n),
  /** 改状态并推送**完整**快照(不是只带 state 的半成品) */
  snap: (patch) => { Object.assign(state, patch); snapCb(snapshot()); },
  bubble: (t) => bubbleCb(t),
  ui: (p) => uiCb(p),
  lan: (patch) => { lanState = { ...lanState, ...patch }; peersCb(lanState.peers); },
  room: (members) => { roomState = { ...roomState, members }; roomCb(members); },
});
