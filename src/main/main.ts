import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  Tray,
} from "electron";
import { appendFileSync, readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { LanNode, type Peer } from "./lan";
import { PetEngine } from "../core/engine";
import type { GameConfig, PetState } from "../core/types";

const WIN_W = 220;
const WIN_H = 300;
const PET_W = 192;

let petWin: BrowserWindow | null = null;
let communityWin: BrowserWindow | null = null;
let gameWin: BrowserWindow | null = null;
let tray: Tray | null = null;
let engine: PetEngine;

// 开发用:设了这个环境变量就换一份存档目录,方便在同一台机器上开第二个实例
//(单实例锁按 userData 路径判定)。例:QQPET_USER_DATA=/tmp/pet2
if (process.env.QQPET_USER_DATA) {
  app.setPath("userData", process.env.QQPET_USER_DATA);
}

const savePath = () => join(app.getPath("userData"), "save.json");
const logPath = () => join(app.getPath("userData"), "main.log");

function logLine(msg: string): void {
  try {
    mkdirSync(app.getPath("userData"), { recursive: true });
    appendFileSync(logPath(), `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    /* 日志失败不致命 */
  }
}

process.on("uncaughtException", (err) => logLine(`uncaughtException: ${err.stack ?? err}`));
process.on("unhandledRejection", (reason) => logLine(`unhandledRejection: ${reason}`));

let skin: any = null;

function skinDir(id = skin.id): string {
  return join(__dirname, "skins", id);
}

/** 用户偏好(与 config.json 分开:config 是项目默认值,这里是本机选择,不进版本库) */
const prefsPath = () => join(app.getPath("userData"), "prefs.json");
function loadPrefs(): Record<string, any> {
  try {
    return JSON.parse(readFileSync(prefsPath(), "utf-8"));
  } catch {
    return {};
  }
}
function savePrefs(patch: Record<string, any>): void {
  try {
    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(prefsPath(), JSON.stringify({ ...loadPrefs(), ...patch }, null, 2));
  } catch (e) {
    logLine(`prefs save failed: ${e}`);
  }
}

function readSkin(id: string): any {
  return JSON.parse(readFileSync(join(skinDir(id), "skin.json"), "utf-8"));
}

/** 扫 skins/ 目录列出所有可用皮肤 */
function listSkins(): { id: string; displayName: string }[] {
  try {
    return readdirSync(join(__dirname, "skins"), { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(__dirname, "skins", d.name, "skin.json")))
      .map((d) => {
        try {
          return { id: d.name, displayName: readSkin(d.name).displayName ?? d.name };
        } catch {
          return null;
        }
      })
      .filter((x): x is { id: string; displayName: string } => x !== null);
  } catch {
    return [];
  }
}

/** 读 config,按「用户偏好 > config.skin」载入皮肤,把术语表与 NPC 合并进 config */
function loadConfig(): GameConfig {
  const cfg = JSON.parse(readFileSync(join(__dirname, "config.json"), "utf-8"));
  const id = loadPrefs().skin ?? cfg.skin ?? "penguin";
  try {
    skin = readSkin(id);
  } catch (e) {
    logLine(`skin "${id}" 载入失败,回退 penguin: ${e}`);
    skin = readSkin("penguin");
  }
  cfg.terms = skin.terms;
  if (skin.npcs) cfg.marriage.npcs = skin.npcs;
  logLine(`skin loaded: ${skin.id} (${skin.renderer})`);
  return cfg;
}

/** 运行时换皮肤:换素材与文案,不动存档 */
function applySkin(id: string): void {
  if (id === skin.id) return;
  let next: any;
  try {
    next = readSkin(id);
  } catch (e) {
    logLine(`切换皮肤 "${id}" 失败: ${e}`);
    bubble("这个皮肤好像坏了……");
    return;
  }
  skin = next;
  engine.config.terms = skin.terms;
  if (skin.npcs) engine.config.marriage.npcs = skin.npcs;
  savePrefs({ skin: id });
  logLine(`skin switched: ${id} (${skin.renderer})`);

  tray?.setImage(trayIcon());
  tray?.setToolTip(`${skin.displayName} · 宠物`);
  // 重载窗口,渲染层会重新 requestSkin 拉到新素材
  if (alive(petWin)) petWin.reload();
  if (alive(communityWin)) communityWin.reload();
}

// ---------- 局域网 ----------
let lan: LanNode | null = null;
let peers: Peer[] = [];

/** 本机稳定标识:换名字、换皮肤都不变,用来认人 */
function selfId(): string {
  const p = loadPrefs();
  if (p.peerId) return p.peerId;
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  savePrefs({ peerId: id });
  return id;
}

function lanEnabled(): boolean {
  return loadPrefs().lan === true; // 默认关闭,由用户在菜单里主动开启
}

function pushPeers(): void {
  if (alive(communityWin)) communityWin.webContents.send("peers", peers);
}

async function startLan(): Promise<void> {
  if (lan?.isRunning) return;
  lan = new LanNode({
    selfId: selfId(),
    getCard: () => ({
      name: engine.state.name,
      level: engine.level,
      skinId: skin.id,
      gender: engine.state.gender,
    }),
    onPeersChanged: (list) => {
      peers = list;
      pushPeers();
    },
    log: logLine,
  });
  try {
    await lan.start();
  } catch {
    lan = null;
    bubble("局域网启动失败,看看 main.log");
  }
}

async function stopLan(): Promise<void> {
  await lan?.stop();
  lan = null;
  peers = [];
  pushPeers();
}

/** 老存档升级:用 newPet 的默认值兜底新字段 */
function migrate(config: GameConfig, saved: Partial<PetState>): PetState {
  const base = PetEngine.newPet(config, skin?.terms?.defaultName ?? "Q宝", "QGG", Date.now());
  return {
    ...base,
    ...saved,
    inventory: { ...base.inventory, ...(saved.inventory ?? {}) },
    activity: saved.activity ?? base.activity,
    stats: { ...base.stats, ...(saved.stats ?? {}) },
    daily: { ...base.daily, ...(saved.daily ?? {}) },
    outfit: { ...base.outfit, ...(saved.outfit ?? {}) },
  };
}

function loadOrAdopt(config: GameConfig): PetState {
  if (existsSync(savePath())) {
    try {
      return migrate(config, JSON.parse(readFileSync(savePath(), "utf-8")));
    } catch (e) {
      logLine(`save corrupted, re-adopting: ${e}`);
    }
  }
  return PetEngine.newPet(config, skin?.terms?.defaultName ?? "Q宝", "QGG", Date.now());
}

function save(): void {
  try {
    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(savePath(), JSON.stringify(engine.state, null, 2));
  } catch (e) {
    logLine(`save failed: ${e}`);
  }
}

function workArea() {
  return screen.getPrimaryDisplay().workArea;
}
function floorY(): number {
  const wa = workArea();
  return wa.y + wa.height - WIN_H;
}

function alive(win: BrowserWindow | null): win is BrowserWindow {
  return !!win && !win.isDestroyed();
}

function pushSnapshot(): void {
  const snap = engine.snapshot(Date.now());
  if (alive(petWin)) petWin.webContents.send("snapshot", snap);
  if (alive(communityWin)) communityWin.webContents.send("snapshot", snap);
  if (alive(gameWin)) gameWin.webContents.send("snapshot", snap);
}
/** UI 偏好(名牌显隐等)推给桌宠窗口 */
function pushUiPrefs(): void {
  const p = { showName: loadPrefs().showName !== false };
  if (alive(petWin)) petWin.webContents.send("ui-prefs", p);
}

function bubble(text: string): void {
  if (alive(petWin)) petWin.webContents.send("bubble", text);
}
function anim(name: string): void {
  if (alive(petWin)) petWin.webContents.send("anim", name);
}
function randomOf(list: string[]): string {
  return list[Math.floor(Math.random() * list.length)];
}

// ---------- 桌面行为状态机 ----------
let dragging = false;
let dragOffset = { x: 0, y: 0 };
let dragTimer: NodeJS.Timeout | null = null;
let walkTimer: NodeJS.Timeout | null = null;
let hiddenAtEdge = false;

function stopWalk(): void {
  if (walkTimer) clearInterval(walkTimer), (walkTimer = null);
}

function walkTo(targetX: number, done?: () => void): void {
  if (!petWin) return;
  stopWalk();
  const speed = 2.2;
  const dir = targetX > petWin.getBounds().x ? 1 : -1;
  anim(dir > 0 ? "walkRight" : "walkLeft");
  walkTimer = setInterval(() => {
    if (!alive(petWin) || dragging) return stopWalk();
    const b = petWin.getBounds();
    const nx = b.x + dir * speed;
    if ((dir > 0 && nx >= targetX) || (dir < 0 && nx <= targetX)) {
      petWin.setBounds({ x: Math.round(targetX), y: floorY(), width: WIN_W, height: WIN_H });
      stopWalk();
      anim(idleAnim());
      done?.();
    } else {
      petWin.setBounds({ x: Math.round(nx), y: floorY(), width: WIN_W, height: WIN_H });
    }
  }, 30);
}

/** 依状态选默认动画 */
function idleAnim(): string {
  const s = engine.state;
  if (s.dead) return "dead";
  if (s.dnd) return "sleep";
  if (s.sickness && s.sickness.stage >= 3) return "tumble_hold";
  if (s.activity.type === "work") return "dance";
  if (s.activity.type === "school") return "mail";
  return "idle";
}

function scheduleBehavior(): void {
  setTimeout(() => {
    const s = engine.state;
    const busy = s.dead || s.dnd || s.sickness || s.activity.type !== "none";
    if (alive(petWin) && petWin.isVisible() && !dragging && !hiddenAtEdge && !busy) {
      const wa = workArea();
      const roll = Math.random();
      if (roll < 0.45) {
        walkTo(wa.x + Math.random() * (wa.width - WIN_W));
      } else if (roll < 0.55) {
        anim("dance");
        setTimeout(() => anim(idleAnim()), 3000);
      }
    }
    scheduleBehavior();
  }, 5000 + Math.random() * 10000);
}

function startFall(): void {
  if (!petWin) return;
  let v = 0;
  anim("struggle");
  const fall = setInterval(() => {
    if (!alive(petWin) || dragging) return clearInterval(fall);
    v += 3.2;
    const b = petWin.getBounds();
    const ny = Math.min(b.y + v, floorY());
    petWin.setBounds({ x: b.x, y: Math.round(ny), width: WIN_W, height: WIN_H });
    if (ny >= floorY()) {
      clearInterval(fall);
      anim("tumble");
      setTimeout(() => anim(idleAnim()), 900);
    }
  }, 16);
}

function maybeEdgeHide(): boolean {
  if (!petWin) return false;
  const wa = workArea();
  const b = petWin.getBounds();
  const petLeft = b.x + (WIN_W - PET_W) / 2;
  const peek = 42;
  const hide = (x: number) => {
    petWin!.setBounds({ x, y: b.y, width: WIN_W, height: WIN_H });
    hiddenAtEdge = true;
    anim(idleAnim());
    bubble("(躲起来了,只露出一双眼睛)");
  };
  if (petLeft < wa.x - PET_W * 0.45) {
    hide(wa.x - WIN_W + peek);
    return true;
  }
  if (petLeft + PET_W > wa.x + wa.width + PET_W * 0.45) {
    hide(wa.x + wa.width - peek);
    return true;
  }
  return false;
}

function comeBack(): void {
  if (!petWin || !hiddenAtEdge) return;
  hiddenAtEdge = false;
  const wa = workArea();
  const b = petWin.getBounds();
  const nx = b.x < wa.x ? wa.x + 20 : wa.x + wa.width - WIN_W - 20;
  petWin.setBounds({ x: nx, y: b.y, width: WIN_W, height: WIN_H });
  startFall();
}

// ---------- 窗口 ----------
function createPetWindow(): void {
  const wa = workArea();
  petWin = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: wa.x + wa.width - WIN_W - 80,
    y: floorY(),
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: { preload: join(__dirname, "preload.js") },
  });
  // 跟随用户到所有空间(包括全屏 app 的 Space),悬浮在最上层
  petWin.setAlwaysOnTop(true, "screen-saver");
  petWin.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  // 窗口(220×300)比宠物本身大得多,透明区域默认让鼠标穿透,
  // 否则会挡住下面应用的点击。forward:true 让渲染层仍收得到 mousemove,
  // 光标移到宠物身上时再由渲染层通知主进程临时恢复可交互。
  petWin.setIgnoreMouseEvents(true, { forward: true });
  petWin.loadFile(join(__dirname, "index.html"));
  petWin.webContents.on("did-finish-load", () => {
    pushUiPrefs();
    pushSnapshot();
    if (!engine.state.dead) {
      anim("sing");
      bubble(randomOf(engine.config.bubbles.greet));
      setTimeout(() => anim(idleAnim()), 2500);
    } else {
      anim("dead");
    }
  });
}

function openCommunity(tab?: string): void {
  if (communityWin) {
    communityWin.show();
    communityWin.focus();
    if (tab) communityWin.webContents.send("goto-tab", tab);
    return;
  }
  const wa = workArea();
  communityWin = new BrowserWindow({
    width: 860,
    height: 640,
    x: wa.x + Math.round((wa.width - 860) / 2),
    y: wa.y + Math.round((wa.height - 640) / 2),
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: { preload: join(__dirname, "preload.js") },
  });
  communityWin.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  communityWin.loadFile(join(__dirname, "community.html"));
  communityWin.webContents.on("did-finish-load", () => {
    pushSnapshot();
    if (tab) communityWin?.webContents.send("goto-tab", tab);
  });
  communityWin.on("closed", () => (communityWin = null));
}

function openGame(page: "battle" | "maze"): void {
  if (gameWin) {
    gameWin.close();
    gameWin = null;
  }
  const wa = workArea();
  gameWin = new BrowserWindow({
    width: 560,
    height: 480,
    x: wa.x + Math.round((wa.width - 560) / 2),
    y: wa.y + Math.round((wa.height - 480) / 2),
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: { preload: join(__dirname, "preload.js") },
  });
  gameWin.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  gameWin.loadFile(join(__dirname, `${page}.html`));
  gameWin.on("closed", () => (gameWin = null));
}

// ---------- 菜单 / 托盘 ----------
function buildMenu(): Menu {
  const c = engine.config;
  const s = engine.state;
  if (s.dead) {
    return Menu.buildFromTemplate([
      { label: "🪦 宝贝不在了……", enabled: false },
      { type: "separator" },
      { label: "用还魂丹复活", click: () => doAction("revive") },
      { label: "埋葬(清空重新领养)", click: buryFlow },
      { type: "separator" },
      { label: "退出", click: () => app.quit() },
    ]);
  }
  const busy = s.activity.type !== "none";
  return Menu.buildFromTemplate([
    {
      label: "喂食",
      enabled: !busy || s.activity.type !== "travel",
      submenu: c.foods.map((f) => ({
        label: `${f.name}(${f.price}元宝,+${f.hunger}饥饿)`,
        click: () => doAction("feed", f.id),
      })),
    },
    {
      label: "洗澡",
      submenu: c.washes.map((w) => ({
        label: `${w.name}(${w.price}元宝,+${w.clean}清洁)${(s.inventory[w.id] ?? 0) > 0 ? ` [背包×${s.inventory[w.id]}]` : ""}`,
        click: () => doAction("wash", w.id),
      })),
    },
    { label: "看病(医院)", click: () => openCommunity("hospital") },
    {
      label: `给${skin.terms.species}改名`,
      click: () => openCommunity("status:rename"),
    },
    { type: "separator" },
    ...(busy
      ? [
          {
            label:
              s.activity.type === "work"
                ? "下班结算"
                : s.activity.type === "school"
                  ? "放学(保留进度)"
                  : "旅游中……",
            enabled: s.activity.type !== "travel",
            click: () => doAction(s.activity.type === "work" ? "work.stop" : "school.stop"),
          } as Electron.MenuItemConstructorOptions,
        ]
      : [
          { label: "打工", click: () => openCommunity("work") } as Electron.MenuItemConstructorOptions,
          { label: "上学", click: () => openCommunity("school") } as Electron.MenuItemConstructorOptions,
          { label: "宠物旅游", click: () => openCommunity("travel") } as Electron.MenuItemConstructorOptions,
        ]),
    { type: "separator" },
    { label: "进入社区", click: () => openCommunity() },
    { label: "古堡战记", click: () => openGame("battle") },
    { label: "密室探险", click: () => openGame("maze") },
    { type: "separator" },
    { label: "免打扰模式", type: "checkbox", checked: s.dnd, enabled: !busy, click: () => doAction("dnd") },
    {
      label: `局域网邻居${lan?.isRunning ? `(已开启,${peers.length} 位在线)` : ""}`,
      type: "checkbox",
      checked: lanEnabled(),
      click: async () => {
        const on = !lanEnabled();
        savePrefs({ lan: on });
        if (on) {
          await startLan();
          bubble("局域网已开启,正在找邻居……");
        } else {
          await stopLan();
          bubble("已关闭局域网");
        }
        pushSnapshot();
      },
    },
    {
      label: "显示头顶名字",
      type: "checkbox",
      checked: loadPrefs().showName !== false,
      click: () => {
        savePrefs({ showName: loadPrefs().showName === false });
        pushUiPrefs();
      },
    },
    {
      label: "切换皮肤",
      submenu: listSkins().map((sk) => ({
        label: sk.displayName + (sk.id === skin.id ? "(当前)" : ""),
        type: "radio" as const,
        checked: sk.id === skin.id,
        click: () => applySkin(sk.id),
      })),
    },
    { label: "隐藏宠物", click: () => petWin?.hide() },
    { type: "separator" },
    { label: "退出宠物", click: () => app.quit() },
  ]);
}

async function buryFlow(): Promise<void> {
  const r = await dialog.showMessageBox({
    type: "warning",
    message: "确定要埋葬宝贝吗?",
    detail: "埋葬后所有资料(等级、成长、元宝)将清空,重新领养一只新宠物。这一步无法撤销!",
    buttons: ["取消", "含泪埋葬"],
    cancelId: 0,
  });
  if (r.response === 1) {
    engine.state = PetEngine.newPet(engine.config, skin?.terms?.defaultName ?? "Q宝", engine.state.gender, Date.now());
    save();
    pushSnapshot();
    anim("sing");
    bubble(`新的${skin.terms.species}宝贝来啦!这次要好好照顾我哦~`);
    setTimeout(() => anim(idleAnim()), 2500);
  }
}

async function hatchFlow(): Promise<{ ok: boolean; message: string }> {
  const info = engine.hatchInfo();
  if (!info.ok) return { ok: false, message: info.message };
  const r = await dialog.showMessageBox({
    type: "question",
    message: "孵化宠物蛋?",
    detail: `孵化后将开始饲养二代宠物(继承成长加成 +${info.bonusGrowth}),当前宠物的旅程就结束了。确定吗?`,
    buttons: ["取消", "孵化二代"],
    cancelId: 0,
  });
  if (r.response !== 1) return { ok: false, message: "取消了孵化" };
  const old = engine.state;
  const gender = Math.random() < 0.5 ? "QGG" : "QMM";
  engine.state = PetEngine.newPet(engine.config, `${old.name}二世`, gender, Date.now(), {
    generation: old.generation + 1,
    parents: info.parents ?? undefined,
    bonusGrowth: info.bonusGrowth,
  });
  save();
  pushSnapshot();
  anim("sing");
  bubble(`二代宝贝「${engine.state.name}」破壳而出!(${gender === "QGG" ? skin.terms.maleLabel : skin.terms.femaleLabel})`);
  return { ok: true, message: "孵化成功!" };
}

/** 托盘图标:sheet 皮肤裁精灵图首帧,rig 皮肤用 Normal 立绘 */
function trayIcon(): Electron.NativeImage {
  try {
    if (skin.sheet) {
      return nativeImage
        .createFromPath(join(skinDir(), skin.sheet.file))
        .crop({ x: 0, y: 0, width: skin.sheet.frameWidth, height: skin.sheet.frameHeight })
        .resize({ height: 20 });
    }
    if (skin.portraits) {
      return nativeImage
        .createFromPath(join(skinDir(), skin.portraits.dir, skin.portraits.map.normal))
        .resize({ height: 20 });
    }
  } catch (e) {
    logLine(`tray icon failed: ${e}`);
  }
  return nativeImage.createEmpty();
}

function createTray(): void {
  tray = new Tray(trayIcon());
  tray.setToolTip(`${skin.displayName} · 宠物`);
  tray.on("click", () => {
    if (petWin?.isVisible()) petWin.hide();
    else {
      petWin?.show();
      comeBack();
    }
  });
  tray.on("right-click", () => tray?.popUpContextMenu(buildMenu()));
}

// ---------- 动作路由 ----------
function doAction(kind: string, id?: string, extra?: string): { ok: boolean; message: string } {
  const now = Date.now();
  let result: { ok: boolean; message: string } = { ok: false, message: "未知操作" };
  const happy = () => {
    anim("dance");
    setTimeout(() => anim(idleAnim()), 2500);
  };

  switch (kind) {
    case "feed":
      result = engine.feed(id!, now);
      if (result.ok) happy();
      break;
    case "wash":
      result = engine.wash(id!, now);
      if (result.ok) happy();
      break;
    case "dnd":
      engine.toggleDnd();
      anim(engine.state.dnd ? "sleep" : "idle");
      result = { ok: true, message: engine.state.dnd ? "进入免打扰模式,睡觉去了~" : "醒来啦!" };
      break;
    case "consult":
      result = engine.consult(now);
      break;
    case "medicine":
      result = engine.buyMedicine(now);
      if (result.ok) happy();
      break;
    case "revive":
      result = engine.revive(now);
      if (result.ok) {
        anim("sing");
        setTimeout(() => anim(idleAnim()), 2500);
      }
      break;
    case "work.start":
      result = engine.startWork(id!);
      if (result.ok) anim("dance");
      break;
    case "work.stop":
      result = engine.stopWork();
      if (result.ok) anim(idleAnim());
      break;
    case "school.start":
      result = engine.startCourse(id!);
      if (result.ok) anim("mail");
      break;
    case "school.stop":
      result = engine.stopSchool();
      if (result.ok) anim(idleAnim());
      break;
    case "travel.start":
      result = engine.startTravel(id!);
      if (result.ok) {
        bubble(result.message);
        setTimeout(() => petWin?.hide(), 2200);
      }
      break;
    case "signin":
      result = engine.signin();
      break;
    case "mousetrap":
      result = engine.mousetrap(now);
      break;
    case "wishtree":
      result = engine.wishTree(now);
      break;
    case "treasure":
      result = engine.treasureHunt(now);
      break;
    case "race":
      result = engine.race();
      break;
    case "ring.claim":
      result = engine.claimFreeRing();
      break;
    case "ring.buy":
      result = engine.buyRing(id!, now);
      break;
    case "propose":
      result = engine.propose(id!, extra!);
      if (result.ok) happy();
      break;
    case "egg.lay":
      result = engine.layEgg();
      if (result.ok) happy();
      break;
    case "divorce":
      result = engine.divorce();
      break;
    case "outfit.buy":
      result = engine.buyOutfit(id!, now);
      break;
    case "outfit.equip":
      result = engine.equipOutfit(id === "null" ? null : id!, extra as "hat" | "scene");
      break;
    case "rename":
      result = engine.rename(id ?? "");
      break;
    case "pink.buy":
      result = engine.buyPink(now);
      break;
    case "castle.start":
      result = engine.castleStart(now);
      break;
    case "castle.finish":
      result = engine.castleFinish(Number(id ?? 0));
      break;
    case "maze.start":
      result = engine.mazeStart();
      break;
    case "maze.finish":
      result = engine.mazeFinish(id === "1");
      break;
  }
  if (kind !== "castle.start" && kind !== "maze.start") bubble(result.message);
  pushSnapshot();
  save();
  return result;
}

// ---------- 事件处理 ----------
function handleEvents(events: string[]): void {
  let delay = 0;
  for (const ev of events) {
    if (ev === "__DEAD__") {
      anim("dead");
      petWin?.show();
      bubble("宝贝……永远地闭上了眼睛(右键选择复活或埋葬)");
      continue;
    }
    if (ev.includes("旅游回来")) {
      petWin?.show();
      startFall();
    }
    setTimeout(() => bubble(ev), delay);
    delay += 4200;
  }
}

let lastNagAt = 0;
function nagCheck(): void {
  const s = engine.state;
  if (s.dnd || s.dead) return;
  const now = Date.now();
  if (now - lastNagAt < 3 * 60_000) return;
  const b = engine.config.bubbles;
  let text: string | null = null;
  if (s.sickness) text = randomOf(b.sick) + `(${engine.sicknessStage()!.quote})`;
  else if (engine.hungerLow) text = randomOf(b.hungry);
  else if (engine.cleanLow) text = randomOf(b.dirty);
  else if (s.activity.type === "work") text = randomOf(b.working);
  else if (s.activity.type === "school") text = randomOf(b.studying);
  else if (s.mood < 300) text = randomOf(b.sad);
  else if (Math.random() < 0.15) text = randomOf(b.happy);
  if (text) {
    lastNagAt = now;
    bubble(text);
  }
}

// ---------- IPC ----------
/** 渲染层判断光标是否压在宠物身上,据此开关鼠标穿透 */
ipcMain.on("set-interactive", (_e, on: boolean) => {
  if (!alive(petWin) || dragging) return; // 拖拽中始终保持可交互
  petWin.setIgnoreMouseEvents(!on, { forward: true });
});

ipcMain.on("pet-click", () => {
  if (hiddenAtEdge) return comeBack();
  if (engine.state.dead) return;
  if (engine.petClick(Date.now())) {
    anim("dance");
    setTimeout(() => anim(idleAnim()), 1500);
    pushSnapshot();
  }
});
ipcMain.on("pet-double-click", () => openCommunity());
ipcMain.on("pet-menu", () => {
  if (petWin) buildMenu().popup({ window: petWin });
});
ipcMain.on("drag-start", (_e, ox: number, oy: number) => {
  if (engine.state.dead || engine.state.activity.type === "travel") return;
  dragging = true;
  hiddenAtEdge = false;
  dragOffset = { x: ox, y: oy };
  stopWalk();
  anim("struggle");
  dragTimer = setInterval(() => {
    if (!alive(petWin)) return;
    const p = screen.getCursorScreenPoint();
    petWin.setBounds({
      x: Math.round(p.x - dragOffset.x),
      y: Math.round(p.y - dragOffset.y),
      width: WIN_W,
      height: WIN_H,
    });
  }, 16);
});
ipcMain.on("drag-end", () => {
  if (!dragging) return;
  dragging = false;
  if (dragTimer) clearInterval(dragTimer), (dragTimer = null);
  if (!petWin) return;
  if (maybeEdgeHide()) return;
  if (petWin.getBounds().y < floorY() - 8) startFall();
  else {
    petWin.setBounds({ ...petWin.getBounds(), y: floorY() });
    anim(idleAnim());
  }
});
ipcMain.handle("action", (_e, kind: string, id?: string, extra?: string) => {
  if (kind === "egg.hatch") return hatchFlow();
  if (kind === "bury") {
    buryFlow();
    return { ok: true, message: "" };
  }
  return doAction(kind, id, extra);
});
ipcMain.handle("get-snapshot", () => engine.snapshot(Date.now()));
ipcMain.handle("get-config", () => engine.config);
ipcMain.handle("get-skin", () => skin);
ipcMain.handle("get-peers", () => ({ enabled: lanEnabled(), running: !!lan?.isRunning, peers }));
ipcMain.handle("peer-card", async (_e, id: string) => {
  const p = lan?.find(id);
  if (!lan || !p) return { ok: false, message: "对方不在家" };
  try {
    const r = await lan.fetchCard(p);
    return { ok: true, card: r.body };
  } catch {
    return { ok: false, message: "对方不在家" };
  }
});
ipcMain.on("close-window", (e) => BrowserWindow.fromWebContents(e.sender)?.close());
ipcMain.on("open-game", (_e, page: "battle" | "maze") => openGame(page));

// ---------- 启动 ----------
// 单实例锁:两个实例会同时 tick、同时写 save.json,后写的覆盖先写的 → 进度丢失。
// 抢不到锁的那个直接退出,并让已在运行的实例把宠物叫出来。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (alive(petWin)) {
      petWin.show();
      comeBack();
      bubble("我已经在这儿啦~");
    }
  });
  main();
}

function main(): void {
  app.whenReady().then(() => {
    logLine(`app ready, userData=${app.getPath("userData")}`);
    if (process.platform === "darwin") app.dock?.hide();
    const config = loadConfig();
    engine = new PetEngine(config, loadOrAdopt(config));

    createPetWindow();
    createTray();
    scheduleBehavior();
    if (lanEnabled()) startLan();

    const TICK_SEC = 15;
    setInterval(() => {
      const minutes = (TICK_SEC / 60) * (config.timeScale || 1);
      const events = engine.tick(minutes, Date.now());
      if (events.length) handleEvents(events);
      nagCheck();
      pushSnapshot();
      save();
    }, TICK_SEC * 1000);

    logLine("startup complete");
  });
}

app.on("before-quit", () => {
  lan?.stop();
  if (engine?.state.activity.type === "work") engine.settleWork("退出前自动结算:");
  save();
});
app.on("window-all-closed", () => {
  /* 桌宠常驻,靠托盘退出 */
});
