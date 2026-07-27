const $c = (id: string) => document.getElementById(id)!;

let cfg: any = null;
let snap: any = null;
let skin: any = null;
const T = (k: string, fb = "") => skin?.terms?.[k] ?? fb;
let activeTab = "status";

const TABS = [
  { id: "status", icon: "🐧", name: "宠物状态" },
  { id: "shop", icon: "🛒", name: "便利商城" },
  { id: "hospital", icon: "🏥", name: "宠物医院" },
  { id: "school", icon: "🏫", name: "学校" },
  { id: "work", icon: "💼", name: "打工街" },
  { id: "church", icon: "⛪", name: "教堂" },
  { id: "travel", icon: "🧳", name: "旅游" },
  { id: "welfare", icon: "🎁", name: "福利站" },
  { id: "games", icon: "🎮", name: "游乐场" },
  { id: "outfit", icon: "👒", name: "名品城" },
  { id: "pink", icon: "💎", name: "粉钻贵族" },
];

const BANNERS: Record<string, { icon: string; title: string; sub: string }> = {
  status: { icon: "🐧", title: "宠物名片", sub: "宝贝的全部家当都在这儿了" },
  shop: { icon: "🛒", title: "便利商城", sub: "粮店 1 元宝≈18 点饥饿,洗护 1 元宝≈36 点清洁,买了直接用在宝贝身上" },
  hospital: { icon: "🏥", title: "宠物医院", sub: "先挂号确诊,才能对症下药 —— 乱吃药会让病情加重!" },
  school: { icon: "🏫", title: "宠物学校", sub: "上学涨三围、发文凭解锁高薪工作。上课时心情封顶 900" },
  work: { icon: "💼", title: "打工街", sub: "打工时心情封顶 600、消耗加大,每天最多干 8 小时,超时宝贝要罢工" },
  church: { icon: "⛪", title: "教堂", sub: "戒指越贵爱情值越高,将来蛋越多、后代越强" },
  travel: { icon: "🧳", title: "宠物旅游", sub: "旅游期间心情每分钟 +5,路上有宝箱、奇遇和小客人" },
  welfare: { icon: "🎁", title: "福利站", sub: "每天来白拿一份,周末还有额外的好东西" },
  games: { icon: "🎮", title: "游乐场", sub: "玩游戏赚元宝,还能顺便涨心情" },
  outfit: { icon: "👒", title: "瓦里步行街 · 名品城", sub: "买下的装扮会真的穿在桌面上的宝贝身上" },
  pink: { icon: "💎", title: "粉钻贵族", sub: "做尊贵的宠物,养宠从此不费心" },
};

function esc(s: any): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

async function act(kind: string, id?: string, extra?: string) {
  const res = await window.qqpet.action(kind, id, extra);
  showMsg(res.message, res.ok);
  snap = await window.qqpet.requestSnapshot();
  render();
}

function showMsg(text: string, ok = true) {
  const el = $c("msg");
  el.textContent = text ? `${ok ? "✅" : "⚠️"} ${text}` : "";
  el.classList.remove("pop");
  void el.offsetWidth;
  el.classList.add("pop");
}

/** 通用卡片 */
function card(o: {
  icon: string;
  title: string;
  tags?: string[];
  desc?: string;
  req?: string;
  reqWarn?: boolean;
  action: string;
  state?: "normal" | "locked" | "done";
}): string {
  const cls = o.state === "locked" ? " locked" : o.state === "done" ? " done" : "";
  return `<div class="card${cls}">
    <div class="ic-badge">${o.icon}</div>
    <div class="c-body">
      <div class="c-title">${esc(o.title)}${(o.tags ?? []).join("")}</div>
      ${o.desc ? `<div class="c-desc">${esc(o.desc)}</div>` : ""}
      ${o.req ? `<div class="c-req${o.reqWarn ? " warn" : ""}">${o.reqWarn ? "🔒" : "•"} ${esc(o.req)}</div>` : ""}
    </div>
    ${o.action}
  </div>`;
}

const coinTag = (n: number) => `<span class="tag coinTag">💰${n}</span>`;
const tag = (t: string) => `<span class="tag">${esc(t)}</span>`;
const greyTag = (t: string) => `<span class="tag grey">${esc(t)}</span>`;
const btn = (label: string, onclick: string, opts: { gold?: boolean; sm?: boolean } = {}) =>
  `<button class="btn${opts.gold ? " gold" : ""}${opts.sm ? " sm" : ""}" onclick="${onclick}">${esc(label)}</button>`;
const btnOff = (label: string) => `<button class="btn dis" disabled>${esc(label)}</button>`;
const stamp = (t: string, lock = false) => `<span class="stamp${lock ? " lock" : ""}">${esc(t)}</span>`;
const section = (icon: string, t: string) => `<div class="section">${icon} ${esc(t)}</div>`;
const notice = (t: string, alarm = false) =>
  `<div class="notice${alarm ? " alarm" : ""}"><span>${alarm ? "⚠️" : "💡"}</span><span>${t}</span></div>`;

function priceOf(p: number): number {
  return snap.isPink ? Math.round(p * cfg.pinkDiamond.shopDiscount) : p;
}
function priceTag(p: number): string {
  return snap.isPink && p > 0
    ? `<span class="tag coinTag">💰<s style="opacity:.55">${p}</s> ${priceOf(p)}</span>`
    : coinTag(p);
}

// ---------- HUD ----------
function renderHud(): string {
  const s = snap.state;
  const next = snap.nextLevelGrowth;
  const base = snap.levelBase ?? 0;
  const gPct = next ? ((s.growth - base) / (next - base)) * 100 : 100;
  const mini = (cls: string, label: string, val: number, max: number, tagText: string) =>
    `<div class="minibar">
      <div class="lab"><span>${label} ${esc(tagText)}</span><span>${Math.round((val / max) * 100)}%</span></div>
      <div class="track"><i class="${cls}" style="width:${Math.max(0, Math.min(100, (val / max) * 100))}%"></i></div>
    </div>`;
  return `<div class="hud">
    <div class="avatar" style="${avatarStyle()}"></div>
    <div class="hud-main">
      <div class="hud-name">
        <span>${esc(s.name)}</span>
        <span class="lvbadge">Lv.${snap.level}</span>
        ${s.generation > 1 ? greyTag(`第${s.generation}代`) : ""}
        ${s.dead ? `<span class="tag" style="background:#eee;border-color:#bbb;color:#777">🪦 已故</span>` : ""}
        ${snap.sicknessInfo ? `<span class="tag" style="background:#ffecef;border-color:#f0a0aa;color:#b03a4a">🤒 ${esc(snap.sicknessInfo.disease)}</span>` : ""}
        ${snap.activityLabel ? greyTag(snap.activityLabel) : ""}
      </div>
      <div class="minibars">
        ${mini("f-hunger", "🍚", s.hunger, snap.hungerMax, snap.hungerLabel)}
        ${mini("f-clean", "🛁", s.clean, snap.cleanMax, snap.cleanLabel)}
        ${mini("f-mood", "💗", s.mood, 1000, snap.moodLabel)}
        ${mini("f-growth", "🌱", gPct, 100, `${snap.growthPerHour}/时`)}
      </div>
    </div>
    ${snap.isPink ? `<div class="badge-pink">💎 粉钻</div>` : ""}
    <div class="coin">💰 ${s.yuanbao}</div>
  </div>`;
}

/** 头像:rig 皮肤用情绪立绘,sheet 皮肤裁精灵图首帧 */
function avatarStyle(): string {
  if (!skin) return "";
  const base = `skins/${skin.id}`;
  if (skin.portraits) {
    const st = snap.state;
    const m = st.mood ?? 0;
    const key = st.dead ? "dizzy" : st.sickness ? "pain" : st.dnd ? "sigh"
      : m >= 900 ? "joyous" : m >= 700 ? "happy" : m >= 400 ? "normal" : m >= 200 ? "sad" : "crying";
    const f = skin.portraits.map[key] ?? skin.portraits.map.normal;
    return `background-image:url('${base}/${skin.portraits.dir}/${f}');background-size:contain;` +
           `image-rendering:pixelated;width:52px;height:52px;border-radius:12px`;
  }
  if (skin.sheet) {
    const k = 52 / skin.sheet.frameHeight;
    return `background-image:url('${base}/${skin.sheet.file}');` +
           `background-size:${(skin.sheet.frameWidth * 8 * k).toFixed(0)}px auto;` +
           `background-position:0 0;width:${(skin.sheet.frameWidth * k).toFixed(0)}px;height:52px`;
  }
  return "";
}

function banner(id: string): string {
  const b = BANNERS[id];
  return `<div class="banner"><span class="big">${b.icon}</span>
    <div><h3>${esc(b.title)}</h3><p>${esc(b.sub)}</p></div></div>`;
}

// ---------- 各场所 ----------
function renderStatus(): string {
  const s = snap.state;
  const sys = cfg.school.systemNames;
  const spouse = s.marriage ? cfg.marriage.npcs.find((n: any) => n.id === s.marriage.spouseId) : null;
  const bag = Object.entries(s.inventory as Record<string, number>).filter(([, n]) => n > 0);
  const stat = (k: string, v: string) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  return `${banner("status")}
  ${section("📊", "能力与家当")}
  <div class="statgrid">
    ${stat("等级", `Lv.${snap.level}`)}
    ${stat("成长值", s.growth.toFixed(1))}
    ${stat("健康", `${s.health}/5`)}
    ${stat(sys.wu, String(s.stats.wu))}
    ${stat(sys.zhi, String(s.stats.zhi))}
    ${stat(sys.mei, String(s.stats.mei))}
    ${stat("在线", `${Math.round(s.onlineMinutes / 60)} 时`)}
    ${stat("文凭", `${s.completedCourses.length} 张`)}
  </div>
  ${spouse ? notice(`💑 已与 <b>${esc(spouse.name)}</b> 结为夫妻,爱情值 <b>${s.marriage.ringLove + Math.round((s.growth - s.marriage.growthAtMarriage) * 10)}</b>,已育 ${s.marriage.eggsBorn}/${cfg.marriage.maxEggs} 只蛋`) : ""}
  ${s.parents ? notice(`👨‍👩‍👧 父:<b>${esc(s.parents.father)}</b> · 母:<b>${esc(s.parents.mother)}</b>`) : ""}
  ${section("🎒", "背包")}
  <div class="inline">${
    bag.map(([k, n]) => `<span class="bagitem">${itemIcon(k)} ${esc(itemName(k))} <b>×${n}</b></span>`).join("") ||
    `<span class="empty">空空如也,去福利站白拿点东西吧~</span>`
  }</div>
  ${section("✏️", `改名卡 · 现在叫「${esc(s.name)}」`)}
  <div class="inline">
    <input type="text" id="renameInput" maxlength="8" placeholder="输入新名字(1~8字),回车确认" />
    ${btn(`使用(💰${cfg.renameCardPrice})`, "doRename()", { gold: true })}
  </div>`;
}

function itemName(id: string): string {
  const dict: Record<string, string> = { revive_pill: "还魂丹", egg: "宠物蛋" };
  if (dict[id]) return dict[id];
  const all = [...cfg.foods, ...cfg.washes, ...cfg.marriage.rings, ...cfg.outfits];
  return all.find((x: any) => x.id === id)?.name ?? id;
}
function itemIcon(id: string): string {
  const dict: Record<string, string> = { revive_pill: "💊", egg: "🥚" };
  if (dict[id]) return dict[id];
  const all = [...cfg.foods, ...cfg.washes, ...cfg.marriage.rings, ...cfg.outfits];
  const it = all.find((x: any) => x.id === id);
  return it?.icon ?? it?.emoji ?? "📦";
}

function renderShop(): string {
  const s = snap.state;
  const full = s.hunger >= snap.hungerMax * 0.6;
  const clean = s.clean >= snap.cleanMax * 0.9;
  const foods = cfg.foods
    .map((f: any) =>
      card({
        icon: f.icon,
        title: f.name,
        tags: [priceTag(f.price), tag(`+${f.hunger} 饥饿`)],
        desc: f.desc,
        action: full ? btnOff("吃撑了") : btn("买来喂它", `act('feed','${f.id}')`, { gold: true }),
        state: full ? "locked" : "normal",
      }),
    )
    .join("");
  const washes = cfg.washes
    .map((w: any) => {
      const owned = s.inventory[w.id] ?? 0;
      return card({
        icon: w.icon,
        title: w.name,
        tags: [owned ? greyTag(`背包 ×${owned} 免费用`) : priceTag(w.price), tag(`+${w.clean} 清洁`)],
        desc: w.desc,
        action: clean ? btnOff("很干净了") : btn("买来给它洗", `act('wash','${w.id}')`, { gold: true }),
        state: clean ? "locked" : "normal",
      });
    })
    .join("");
  return `${banner("shop")}
  ${section("🍚", "粮店")}<div class="grid">${foods}</div>
  ${section("🛁", "洗护用品")}<div class="grid">${washes}</div>`;
}

function renderHospital(): string {
  const s = snap.state;
  if (s.dead) {
    return `${banner("hospital")}
    ${notice("🪦 宝贝已经死亡……用还魂丹能让它回来,等级、成长、元宝全部保留。", true)}
    ${section("💊", "急救室")}
    <div class="grid wide">
      ${card({
        icon: "💊",
        title: "还魂丹复活",
        tags: [
          (s.inventory.revive_pill ?? 0) > 0 ? greyTag(`背包 ×${s.inventory.revive_pill} 免费用`) : priceTag(cfg.sickness.revivePillPrice),
        ],
        desc: "传说中的仙丹,能把宝贝从另一个世界拉回来。复活后保留全部资料",
        action: btn("复活!", "act('revive')", { gold: true }),
      })}
      ${card({
        icon: "🪦",
        title: "埋葬",
        tags: [greyTag("不可撤销")],
        desc: `清空等级、成长、元宝和所有物品,重新领养一只全新的${T("species","宠物")}宝贝`,
        action: btn("含泪埋葬", "act('bury')"),
      })}
    </div>`;
  }
  const sick = snap.sicknessInfo;
  if (!sick) {
    return `${banner("hospital")}
    ${notice("医生检查了一下:<b>宝贝壮得像头小牛,没有生病</b>~")}
    ${section("📋", "预防须知")}
    <div class="grid">
      ${cfg.sickness.chains
        ? Object.values(cfg.sickness.chains)
            .map((ch: any) =>
              card({
                icon: ch.icon ?? "🤒",
                title: ch.name,
                tags: [greyTag("4 级恶化")],
                desc: ch.stages.map((x: any) => x.disease).join(" → ") + " → 死亡",
                req: `药费 ${ch.stages.map((x: any) => x.price).join("/")} 元宝,越拖越贵`,
                action: stamp("未患病", true),
              }),
            )
            .join("")
        : ""}
    </div>
    ${notice("饥饿或清洁掉到黄色区间、心情低于 500 都容易染病。病了不治,每 12 小时恶化一级,四级之后就会死亡。")}`;
  }
  const diagnosed = s.sickness?.diagnosed;
  return `${banner("hospital")}
  ${notice(`当前病情:<b>${esc(sick.disease)}</b>(${esc(sick.chainName)})—— "${esc(sick.quote)}"`, true)}
  ${section("🩺", "就诊流程")}
  <div class="grid wide">
    ${card({
      icon: "🩺",
      title: "① 挂号诊断",
      tags: [snap.isPink ? greyTag("粉钻免费") : coinTag(cfg.sickness.consultFee)],
      desc: "医生确诊后才会开处方。不确诊就买药 = 吃错药,病情反而加重",
      action: diagnosed ? stamp("已确诊") : btn("挂号", "act('consult')", { gold: true }),
      state: diagnosed ? "done" : "normal",
    })}
    ${card({
      icon: "💊",
      title: "② 按处方抓药",
      tags: [diagnosed ? priceTag(sick.medicinePrice) : greyTag("需先确诊")],
      desc: diagnosed ? "对症下药,药到病除,还附赠一点饥饿和清洁恢复" : "还没挂号,医生不会给你开药",
      req: diagnosed ? undefined : "先完成挂号诊断",
      reqWarn: !diagnosed,
      action: diagnosed ? btn("买药服下", "act('medicine')", { gold: true }) : btnOff("买药服下"),
      state: diagnosed ? "normal" : "locked",
    })}
  </div>`;
}

function courseName(cid: string): string {
  const [p, k] = cid.split("_");
  const st = cfg.school.stages.find((x: any) => x.prefix === p);
  const sub = cfg.school.subjects.find((x: any) => x.key === k);
  return `${st?.name ?? ""}${sub?.name ?? ""}`;
}

function courseLock(cid: string): string | null {
  const s = snap.state;
  const [prefix, key] = cid.split("_");
  const stage = cfg.school.stages.find((x: any) => x.prefix === prefix);
  const subject = cfg.school.subjects.find((x: any) => x.key === key);
  if (snap.level < stage.minLevel) return `需要 Lv.${stage.minLevel}(还差 ${stage.minLevel - snap.level} 级)`;
  const idx = cfg.school.stages.findIndex((x: any) => x.prefix === prefix);
  if (idx > 0) {
    const prev = cfg.school.stages[idx - 1];
    const missing = cfg.school.subjects
      .filter((x: any) => x.system === subject.system)
      .filter((x: any) => !s.completedCourses.includes(`${prev.prefix}_${x.key}`));
    if (missing.length)
      return `先修完${prev.name}${cfg.school.systemNames[subject.system]}系:${missing.map((m: any) => m.name).join("、")}`;
  }
  return null;
}

function renderSchool(): string {
  const s = snap.state;
  const learning = s.activity.type === "school";
  const blocks = cfg.school.stages
    .map((st: any) => {
      const cards = cfg.school.subjects
        .map((sub: any) => {
          const cid = `${st.prefix}_${sub.key}`;
          const done = s.completedCourses.includes(cid);
          const inProg = s.currentCourse?.courseId === cid;
          const lock = done ? null : courseLock(cid);
          const mins = inProg ? Math.round(s.currentCourse.minutesDone) : 0;
          const total = st.hours * 60;
          return card({
            icon: sub.icon,
            title: `${st.name}${sub.name}`,
            tags: [
              tag(`${cfg.school.systemNames[sub.system]}+${st.attrGain}`),
              coinTag(st.scholarship),
              greyTag(`${st.hours} 小时`),
            ],
            desc: inProg
              ? `📖 已学 ${mins} / ${total} 分钟(${Math.round((mins / total) * 100)}%)`
              : done
                ? "文凭已到手"
                : "修完发文凭 + 领奖学金",
            req: lock ?? undefined,
            reqWarn: !!lock,
            action: done
              ? stamp("🎓 已毕业")
              : lock
                ? btnOff("条件不足")
                : learning
                  ? btnOff(inProg ? "上课中" : "先放学")
                  : btn(inProg ? "继续上课" : "报名上课", `act('school.start','${cid}')`, { gold: !inProg }),
            state: done ? "done" : lock ? "locked" : "normal",
          });
        })
        .join("");
      return `${section(st.icon, `${st.name} · ${st.minLevel} 级可入学`)}<div class="grid">${cards}</div>`;
    })
    .join("");
  return `${banner("school")}
  ${learning ? `<div class="grid wide">${card({
    icon: "📖",
    title: "正在上课",
    tags: [tag(snap.activityLabel || "上课中")],
    desc: "放学后进度会保留,下次接着学",
    action: btn("放学回家", "act('school.stop')"),
    state: "done",
  })}</div>` : ""}
  ${notice("进阶规则:要学<b>中学</b>某系课程,必须先修完<b>小学</b>该系全部三门;大学同理。攻略共识是「单系直通大学」最省时间。")}
  ${blocks}`;
}

function jobLock(j: any): string | null {
  const s = snap.state;
  if (snap.level < j.minLevel) return `需要 Lv.${j.minLevel}(还差 ${j.minLevel - snap.level} 级)`;
  const need: string[] = j.diplomas.includes("ALL")
    ? cfg.school.stages.flatMap((st: any) => cfg.school.subjects.map((sub: any) => `${st.prefix}_${sub.key}`))
    : j.diplomas;
  const missing = need.filter((d) => !s.completedCourses.includes(d));
  if (missing.length) {
    if (missing.length > 3) return `还缺 ${missing.length} 张文凭(需全部课程)`;
    return `还缺文凭:${missing.map(courseName).join("、")}`;
  }
  return null;
}

function renderWork(): string {
  const s = snap.state;
  const working = s.activity.type === "work";
  const worked = Math.round(s.daily.workMinutes);
  const capped = worked >= cfg.work.dailyLimitMinutes;
  const places: Record<string, any[]> = {};
  for (const j of cfg.work.jobs) (places[j.place] ??= []).push(j);
  const placeIcons: Record<string, string> = {
    建筑工地: "🏗️", 报社: "📰", 警察局: "🚓", 法院: "⚖️", 艺术剧院: "🎭",
  };
  const blocks = Object.entries(places)
    .map(([place, jobs]) => {
      const cards = jobs
        .map((j: any) => {
          const lock = jobLock(j);
          const need = j.diplomas.includes("ALL")
            ? "需要全部 27 张文凭"
            : j.diplomas.length
              ? `需 ${j.diplomas.map(courseName).join(" + ")}`
              : "无学历要求";
          return card({
            icon: j.icon,
            title: j.name,
            tags: [`<span class="tag coinTag">💰${j.wage}/时</span>`, greyTag(`Lv.${j.minLevel}`)],
            desc: j.desc,
            req: lock ?? need,
            reqWarn: !!lock,
            action: lock
              ? btnOff("条件不足")
              : working || capped
                ? btnOff("上岗")
                : btn("上岗", `act('work.start','${j.id}')`, { gold: true }),
            state: lock ? "locked" : "normal",
          });
        })
        .join("");
      return `${section(placeIcons[place] ?? "🏢", place)}<div class="grid">${cards}</div>`;
    })
    .join("");
  return `${banner("work")}
  ${working ? `<div class="grid wide">${card({
    icon: "💪",
    title: "正在打工",
    tags: [tag(snap.activityLabel || "打工中")],
    desc: "下班时按分钟结算工资,中途生病会自动提前下班",
    action: btn("下班结算", "act('work.stop')", { gold: true }),
    state: "done",
  })}</div>` : ""}
  ${capped ? notice("今天已经打满 <b>8 小时</b>,宝贝罢工了,明天再来吧!", true)
           : notice(`今日已打工 <b>${worked} / ${cfg.work.dailyLimitMinutes}</b> 分钟。打工时消耗加大(约 18~30 元宝/时),<b>5 级前打工不划算</b>。`)}
  ${blocks}`;
}

function renderChurch(): string {
  const s = snap.state;
  const m = cfg.marriage;
  if (s.marriage) {
    const spouse = m.npcs.find((n: any) => n.id === s.marriage.spouseId);
    const love = s.marriage.ringLove + Math.round((s.growth - s.marriage.growthAtMarriage) * 10);
    const canEgg = s.marriage.minutesSinceLastEgg >= m.eggIntervalMinutes && s.marriage.eggsBorn < m.maxEggs;
    const remainH = Math.max(0, Math.ceil((m.eggIntervalMinutes - s.marriage.minutesSinceLastEgg) / 60));
    const eggs = s.inventory.egg ?? 0;
    return `${banner("church")}
    ${section("💑", "婚姻生活")}
    <div class="statgrid">
      <div class="stat"><div class="k">配偶</div><div class="v">${spouse?.icon ?? ""} ${esc(spouse?.name ?? "?")}</div></div>
      <div class="stat"><div class="k">爱情值</div><div class="v">❤️ ${love}</div></div>
      <div class="stat"><div class="k">已育宠物蛋</div><div class="v">🥚 ${s.marriage.eggsBorn}/${m.maxEggs}</div></div>
      <div class="stat"><div class="k">结婚时长</div><div class="v">${Math.round(s.marriage.marriedMinutes / 60)} 时</div></div>
    </div>
    ${section("🥚", "培育与孵化")}
    <div class="grid wide">
      ${card({
        icon: "🥚",
        title: "培育宠物蛋",
        tags: [greyTag(`每 200 小时一只`)],
        desc: "找神父特里斯坦主持培育仪式,按爱情值分蛋",
        req: canEgg ? "感情深厚,现在就可以培育!" : s.marriage.eggsBorn >= m.maxEggs ? "一生 10 次机会已用完" : `还需约 ${remainH} 小时`,
        reqWarn: !canEgg,
        action: canEgg ? btn("培育", "act('egg.lay')", { gold: true }) : btnOff("培育"),
        state: canEgg ? "normal" : "locked",
      })}
      ${card({
        icon: "🐣",
        title: "孵化宠物蛋",
        tags: [eggs ? tag(`拥有 ×${eggs}`) : greyTag("没有蛋")],
        desc: "孵出二代宝贝,按爱情值继承成长加成,名片上会记着父母。当前宝贝的旅程就此结束",
        action: eggs > 0 ? btn("孵化二代", "act('egg.hatch')", { gold: true }) : btnOff("孵化二代"),
        state: eggs > 0 ? "normal" : "locked",
      })}
      ${card({
        icon: "💔",
        title: "离婚",
        tags: [greyTag(`魅力 -${m.divorcePenaltyMeiPct}%`)],
        desc: "爱情值清零、婚戒消失,从此各奔东西",
        action: btn("找神父办理", "act('divorce')"),
      })}
    </div>`;
  }
  const rings = m.rings
    .map((r: any) => {
      const owned = s.inventory[r.id] ?? 0;
      const free = r.price === 0;
      const lvLock = free && snap.level < m.freeRingLevel ? `需要 Lv.${m.freeRingLevel}` : null;
      return card({
        icon: r.icon,
        title: r.name,
        tags: [tag(`❤️ ${r.love}`), greyTag(`成功率 ${Math.round(r.acceptRate * 100)}%`), free ? greyTag("免费") : priceTag(r.price)],
        desc: free ? "教堂小天使的祝福,一生只能领一枚" : "越贵的戒指爱情值越高,后代属性越好",
        req: owned ? `已拥有 ×${owned},可以拿去求婚了` : lvLock ?? undefined,
        reqWarn: !owned && !!lvLock,
        action: free
          ? s.freeRingClaimed
            ? stamp(owned ? "已领取" : "已领过")
            : lvLock
              ? btnOff("领取")
              : btn("找小天使领", "act('ring.claim')", { gold: true })
          : btn(owned ? "再买一枚" : "购买", `act('ring.buy','${r.id}')`, { gold: true }),
        state: owned ? "done" : lvLock ? "locked" : "normal",
      });
    })
    .join("");
  const myRings = m.rings.filter((r: any) => (s.inventory[r.id] ?? 0) > 0);
  const lvOk = snap.level >= m.minLevel;
  const candidates = m.npcs
    .filter((n: any) => n.gender !== s.gender)
    .map((n: any) => {
      const action = !lvOk
        ? btnOff("求婚")
        : myRings.length
          ? myRings.map((r: any) => btn(`${r.icon} 求婚`, `act('propose','${n.id}','${r.id}')`, { sm: true, gold: true })).join(" ")
          : btnOff("需要戒指");
      return card({
        icon: n.icon,
        title: n.name,
        tags: [greyTag(n.gender === "QGG" ? T("maleLabel","男孩") : T("femaleLabel","女孩")), greyTag(`Lv.${n.level}`)],
        desc: n.personality,
        req: !lvOk ? `需要 Lv.${m.minLevel} 才能结婚` : myRings.length ? undefined : "先去珠宝店备一枚戒指",
        reqWarn: !lvOk || !myRings.length,
        action: `<span class="inline">${action}</span>`,
        state: !lvOk || !myRings.length ? "locked" : "normal",
      });
    })
    .join("");
  return `${banner("church")}
  ${section("💍", "珠宝店")}<div class="grid">${rings}</div>
  ${section("💌", T("matchmaker","红娘 · 待嫁待娶"))}<div class="grid">${candidates}</div>`;
}

function renderTravel(): string {
  const s = snap.state;
  if (s.activity.type === "travel") {
    return `${banner("travel")}
    ${notice(`宝贝正在外面玩耍,还有 <b>${Math.round(s.activity.plannedMinutes - s.activity.minutes)} 分钟</b>回来。回来会跟你汇报一路的见闻~`)}
    <div class="grid wide">${card({
      icon: "✈️",
      title: "旅行中",
      tags: [tag("心情 +5/分钟")],
      desc: "桌面上暂时看不到它,别担心,它玩得很开心",
      action: stamp("旅途愉快"),
      state: "done",
    })}</div>`;
  }
  const lvOk = snap.level >= cfg.travel.minLevel;
  const cards = cfg.travel.modes
    .map((mo: any) =>
      card({
        icon: mo.icon,
        title: mo.name,
        tags: [coinTag(mo.fare), greyTag(`${mo.minutes} 分钟`)],
        desc: mo.desc + (mo.id === "mystery" ? " · 有机会触发梦想奖励(380→5000 元宝递增)" : ""),
        req: lvOk ? undefined : `需要 Lv.${cfg.travel.minLevel}`,
        reqWarn: !lvOk,
        action: lvOk ? btn("出发!", `act('travel.start','${mo.id}')`, { gold: true }) : btnOff("出发!"),
        state: lvOk ? "normal" : "locked",
      }),
    )
    .join("");
  return `${banner("travel")}
  ${notice(`路上可能捡到<b>宝箱和钥匙</b>、带回<b>小客人</b>串门。已领梦想奖励 <b>${s.dreamRewardCount}</b> 次,下一次会更多。`)}
  ${section("🗺️", "线路选择")}<div class="grid">${cards}</div>`;
}

function renderWelfare(): string {
  const s = snap.state;
  const d = s.daily;
  const w = cfg.welfare;
  const weekend = [0, 6].includes(new Date().getDay());
  const items = [
    { icon: "📅", name: "每日签到", desc: "来了就有,风雨无阻", tags: [coinTag(w.signin.min) + coinTag(w.signin.max)], kind: "signin", used: d.signedIn, lock: null },
    { icon: "🪤", name: "捕鼠夹", desc: `运气好能夹到肥老鼠${snap.isPink ? "(粉钻每天 2 次)" : ""}`, tags: [greyTag(`0~${w.mousetrap.max} 元宝`)], kind: "mousetrap", used: d.mousetrapUsed >= (snap.isPink ? 2 : 1), lock: snap.level < w.mousetrap.minLevel ? `需要 Lv.${w.mousetrap.minLevel}` : null },
    { icon: "🎋", name: "许愿树", desc: "只在周末开放,对着树许个愿", tags: [greyTag(w.wishTree.rewards.join(" / ") + " 元宝")], kind: "wishtree", used: d.wishTreeUsed, lock: weekend ? null : "只在周末开放" },
    { icon: "🗺️", name: "寻宝乐园", desc: "周末限定,挖挖看有什么", tags: [greyTag(`${w.treasureHunt.min}~${w.treasureHunt.max} 元宝`)], kind: "treasure", used: d.treasureUsed, lock: snap.level < w.treasureHunt.minLevel ? `需要 Lv.${w.treasureHunt.minLevel}` : weekend ? null : "只在周末开放" },
    { icon: "🐮", name: "嘉年华牛翔赛跑", desc: "一半的概率能赢个沐浴球", tags: [greyTag("奖品:沐浴球")], kind: "race", used: d.raceUsed, lock: snap.level < w.race.minLevel ? `需要 Lv.${w.race.minLevel}` : null },
  ];
  return `${banner("welfare")}
  <div class="grid">${items
    .map((e) =>
      card({
        icon: e.icon,
        title: e.name,
        tags: e.tags,
        desc: e.desc,
        req: e.lock ?? undefined,
        reqWarn: !!e.lock,
        action: e.used ? stamp("今日已领") : e.lock ? btnOff("领取") : btn("领取", `act('${e.kind}')`, { gold: true }),
        state: e.used ? "done" : e.lock ? "locked" : "normal",
      }),
    )
    .join("")}</div>`;
}

function renderGames(): string {
  const s = snap.state;
  const castle = cfg.games.castle;
  const cLimit = snap.isPink ? castle.pinkDailyLimit : castle.dailyLimit;
  const cLeft = cLimit - s.daily.castlePlays;
  const mLeft = cfg.games.maze.dailyLimit - s.daily.mazePlays;
  return `${banner("games")}
  <div class="grid">
    ${card({
      icon: "🏰",
      title: castle.name,
      tags: [tag(`剩 ${Math.max(0, cLeft)} 次`), coinTag(castle.normalReward + castle.bosses.reduce((a: number, b: any) => a + b.reward, 0))],
      desc: `回合制冒险,依次挑战${castle.bosses.map((b: any) => b.name).join("、")}。武力值越高,血量和攻击越强`,
      req: cLeft > 0 ? `今日 ${s.daily.castlePlays}/${cLimit} 次` : "今天的次数用完了",
      reqWarn: cLeft <= 0,
      action: cLeft > 0 ? btn("进入古堡", "window.qqpet.openGame('battle')", { gold: true }) : btnOff("进入古堡"),
      state: cLeft > 0 ? "normal" : "locked",
    })}
    ${card({
      icon: "🚪",
      title: cfg.games.maze.name,
      tags: [tag(`剩 ${Math.max(0, mLeft)} 次`), greyTag(`${cfg.games.maze.timeLimitSec} 秒限时`)],
      desc: "教堂地下的迷宫,方向键操作,走到出口就能带走日用品和食物",
      req: mLeft > 0 ? `今日 ${s.daily.mazePlays}/${cfg.games.maze.dailyLimit} 次` : "今天的次数用完了",
      reqWarn: mLeft <= 0,
      action: mLeft > 0 ? btn("进入密室", "window.qqpet.openGame('maze')", { gold: true }) : btnOff("进入密室"),
      state: mLeft > 0 ? "normal" : "locked",
    })}
  </div>
  ${section("🏆", "Boss 图鉴")}
  <div class="grid">${castle.bosses
    .map((b: any, i: number) =>
      card({
        icon: ["👹", "🧟", "🐺"][i] ?? "👾",
        title: b.name,
        tags: [greyTag(`HP ${b.hp}`), greyTag(`攻击 ${b.atk}`)],
        desc: `古堡第 ${i + 1} 关的守卫`,
        action: stamp(`赏金 💰${b.reward}`, true),
      }),
    )
    .join("")}</div>`;
}

function renderOutfit(): string {
  const s = snap.state;
  const slotName: Record<string, string> = { hat: "帽子", scene: "场景泡泡" };
  const slotIcon: Record<string, string> = { hat: "👒", scene: "🫧" };
  const groups: Record<string, any[]> = { hat: [], scene: [] };
  for (const o of cfg.outfits) groups[o.slot].push(o);
  const blocks = Object.entries(groups)
    .map(([slot, items]) => {
      const wearing = s.outfit[slot];
      const head = `${section(slotIcon[slot], `${slotName[slot]}${wearing ? ` · 佩戴中:${itemName(wearing)}` : ""}`)}
        ${wearing ? `<div style="margin-bottom:8px">${btn("脱下当前装扮", `act('outfit.equip','null','${slot}')`, { sm: true })}</div>` : ""}`;
      const cards = items
        .map((o: any) => {
          const owned = s.ownedOutfits.includes(o.id);
          const on = wearing === o.id;
          return card({
            icon: o.emoji ?? "🎨",
            title: o.name,
            tags: [tag(`魅力 +${o.mei}`), owned ? greyTag("已拥有") : priceTag(o.price)],
            desc: slot === "hat" ? "会戴在桌面宝贝的头顶上" : "会在桌面宝贝身后画一圈光晕",
            action: on
              ? stamp("穿戴中")
              : owned
                ? btn("穿上", `act('outfit.equip','${o.id}','${slot}')`, { gold: true })
                : btn("购买", `act('outfit.buy','${o.id}')`, { gold: true }),
            state: on ? "done" : "normal",
          });
        })
        .join("");
      return head + `<div class="grid">${cards}</div>`;
    })
    .join("");
  return `${banner("outfit")}${blocks}`;
}

function renderPink(): string {
  const p = cfg.pinkDiamond;
  const until = snap.state.pinkUntil;
  const perks = [
    { icon: "🛍️", t: "全场 8 折", d: "食物、药品、戒指、装扮,买什么都便宜两成" },
    { icon: "🍚", t: `每日 ${p.freeMealPerDay} 次免费用餐`, d: "外加每天一次免费清洗,基础开销直接归零" },
    { icon: "🛡️", t: "生病免疫", d: "再也不用担心宝贝染上感冒、咳嗽、肠胃病" },
    { icon: "🏥", t: "看病免挂号费", d: "医院随便进,50 元宝的挂号费全免" },
    { icon: "💊", t: "还魂丹 8 折", d: "万一真的出事,复活也更便宜" },
    { icon: "🎮", t: "游戏次数翻倍", d: `捕鼠夹每天 2 次,古堡战记每天 ${cfg.games.castle.pinkDailyLimit} 次` },
  ];
  return `${banner("pink")}
  ${snap.isPink
    ? notice(`💎 <b>粉钻贵族已开通</b>,有效期至 <b>${new Date(until).toLocaleDateString()}</b>,续费可叠加时长。`)
    : notice("开通后立刻生效,所有特权同时享受。单机版用元宝就能买,不用充钱~")}
  ${section("👑", "贵族特权")}
  <div class="grid">${perks
    .map((x) => card({ icon: x.icon, title: x.t, desc: x.d, action: stamp(snap.isPink ? "生效中" : "未开通", !snap.isPink), state: snap.isPink ? "done" : "normal" }))
    .join("")}</div>
  ${section("💳", "开通")}
  <div class="grid wide">${card({
    icon: "💎",
    title: `粉钻贵族 ${p.days} 天`,
    tags: [coinTag(p.price)],
    desc: "全部六项特权,到期后自动失效,可提前续费叠加",
    action: btn(snap.isPink ? "续费 30 天" : "立即开通", "act('pink.buy')", { gold: true }),
  })}</div>`;
}

// ---------- 框架 ----------
const RENDERERS: Record<string, () => string> = {
  status: renderStatus, shop: renderShop, hospital: renderHospital, school: renderSchool,
  work: renderWork, church: renderChurch, travel: renderTravel, welfare: renderWelfare,
  games: renderGames, outfit: renderOutfit, pink: renderPink,
};

function render() {
  if (!cfg || !snap) return;
  const nav = $c("nav");
  nav.innerHTML = TABS.map(
    (t) =>
      `<button class="${t.id === activeTab ? "active" : ""}" data-tab="${t.id}"><span class="ic">${t.icon}</span>${t.name}</button>`,
  ).join("");
  nav.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      activeTab = (b as HTMLElement).dataset.tab!;
      render();
    }),
  );
  $c("main").setAttribute("data-venue", activeTab);
  $c("hud").innerHTML = renderHud();
  $c("content").innerHTML = (RENDERERS[activeTab] ?? renderStatus)();
}

(window as any).act = act;
(window as any).doRename = () => {
  const input = document.getElementById("renameInput") as HTMLInputElement | null;
  if (input?.value.trim()) act("rename", input.value.trim());
  else showMsg("先输入一个新名字吧", false);
};
// 输入框里按回车直接改名
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.target as HTMLElement)?.id === "renameInput") {
    (window as any).doRename();
  }
});

window.qqpet.onSnapshot((s) => {
  snap = s;
  render();
});
window.qqpet.onGotoTab((tab) => {
  // 支持 "status:rename" 这种带动作的形式,从右键菜单直达并聚焦
  const [name, action] = tab.split(":");
  activeTab = name;
  render();
  if (action === "rename") {
    const input = document.getElementById("renameInput") as HTMLInputElement | null;
    input?.scrollIntoView({ block: "center" });
    input?.focus();
    input?.classList.add("flash");
  }
});
$c("close").onclick = () => window.qqpet.closeWindow();

(async () => {
  skin = await window.qqpet.requestSkin();
  cfg = await window.qqpet.requestConfig();
  const tb = document.querySelector(".titlebar span");
  if (tb) tb.textContent = T("communityTitle", "🏝️ 宠物社区");
  const st = document.createElement("style");
  st.textContent = `#msg:empty::before{content:"${T("idleHint", "四处逛逛吧~")}"}`;
  document.head.appendChild(st);
  snap = await window.qqpet.requestSnapshot();
  render();
})();

export {};
