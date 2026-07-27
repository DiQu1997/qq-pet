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
let animCb = () => {}, snapCb = () => {}, bubbleCb = () => {};
const calls = [];
contextBridge.exposeInMainWorld("qqpet", {
  onSnapshot(cb) { snapCb = cb; }, onBubble(cb) { bubbleCb = cb; },
  onAnim(cb) { animCb = cb; }, onGotoTab() {},
  petClick() { calls.push("click"); }, petDoubleClick() { calls.push("dblclick"); },
  petMenu() { calls.push("menu"); },
  dragStart(x, y) { calls.push(`drag:${Math.round(x)},${Math.round(y)}`); }, dragEnd() {},
  setInteractive(on) { calls.push(`interactive:${on}`); },
  async action() { return { ok: true, message: "" }; },
  async requestSnapshot() { return { state }; },
  async requestConfig() { return cfg; },
  async requestSkin() { return skin; },
  closeWindow() {}, openGame() {},
});
contextBridge.exposeInMainWorld("__calls", { get: () => calls.slice(), clear: () => (calls.length = 0) });
contextBridge.exposeInMainWorld("__drive", {
  anim: (n) => animCb(n),
  snap: (patch) => snapCb({ state: Object.assign(state, patch) }),
  bubble: (t) => bubbleCb(t),
});
