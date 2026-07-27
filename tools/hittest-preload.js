const { contextBridge, ipcRenderer } = require("electron");
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
let animCb = () => {}, snapCb = () => {}, bubbleCb = () => {}, gotoCb = () => {};

/** 完整快照:字段必须与 StatusSnapshot 对齐,否则测试会假通过 */
function snapshot() {
  const level = cfg.levelGrowth.filter((g) => state.growth >= g).length || 1;
  const attrMax = cfg.attr.baseMax + cfg.attr.perLevelMax * Math.min(level, cfg.attr.maxLevelForAttr);
  const band = cfg.growthByMood.find((b) => state.mood >= b.min) ||
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
contextBridge.exposeInMainWorld("qqpet", {
  onSnapshot(cb) { snapCb = cb; }, onBubble(cb) { bubbleCb = cb; },
  onAnim(cb) { animCb = cb; }, onGotoTab(cb) { gotoCb = cb; },
  petClick() { calls.push("click"); }, petDoubleClick() { calls.push("dblclick"); },
  petMenu() { calls.push("menu"); },
  dragStart(x, y) { calls.push(`drag:${Math.round(x)},${Math.round(y)}`); }, dragEnd() {},
  setInteractive(on) { calls.push(`interactive:${on}`); },
  async action(kind, id) { calls.push(`${kind}:${id ?? ""}`); return { ok: true, message: "预览" }; },
  async requestSnapshot() { return snapshot(); },
  async requestConfig() { return cfg; },
  async requestSkin() { return skin; },
  closeWindow() {}, openGame() {},
});
contextBridge.exposeInMainWorld("__calls", { get: () => calls.slice(), clear: () => (calls.length = 0) });
contextBridge.exposeInMainWorld("__gotoTab", (t) => gotoCb(t));
contextBridge.exposeInMainWorld("__drive", {
  anim: (n) => animCb(n),
  snap: (patch) => snapCb({ state: Object.assign(state, patch) }),
  bubble: (t) => bubbleCb(t),
});
