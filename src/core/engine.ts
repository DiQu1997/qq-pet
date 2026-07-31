import type {
  ActionResult,
  Activity,
  GameConfig,
  Job,
  PetState,
  StatusSnapshot,
} from "./types";

function emptyActivity(): Activity {
  return { type: "none", refId: "", minutes: 0, plannedMinutes: 0, unpaidMinutes: 0 };
}

function dateStr(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function isWeekend(ts: number): boolean {
  const day = new Date(ts).getDay();
  return day === 0 || day === 6;
}

/** 纯逻辑引擎:不碰 Electron/文件系统。tick 粒度 = 1 分钟(可小数)。rng 可注入便于测试 */
export class PetEngine {
  constructor(
    public readonly config: GameConfig,
    public state: PetState,
    private rng: () => number = Math.random,
  ) {}

  static newPet(
    config: GameConfig,
    name: string,
    gender: "QGG" | "QMM",
    now: number,
    opts?: { generation?: number; parents?: { father: string; mother: string }; bonusGrowth?: number },
  ): PetState {
    return {
      name,
      gender,
      generation: opts?.generation ?? 1,
      parents: opts?.parents ?? null,
      adoptedAt: now,
      hunger: Math.round((config.attr.baseMax + config.attr.perLevelMax) * 0.6),
      clean: Math.round((config.attr.baseMax + config.attr.perLevelMax) * 0.72),
      mood: config.attr.moodMax,
      health: 5,
      growth: 1 + (opts?.bonusGrowth ?? 0),
      yuanbao: config.economy.initialYuanbao,
      dnd: false,
      lastClickGainAt: 0,
      onlineMinutes: 0,
      sickness: null,
      dead: false,
      inventory: { revive_pill: config.economy.initialRevivePills },
      activity: emptyActivity(),
      completedCourses: [],
      currentCourse: null,
      stats: { wu: 0, zhi: 0, mei: 0 },
      marriage: null,
      freeRingClaimed: false,
      daily: PetEngine.freshDaily(dateStr(now)),
      dreamRewardCount: 0,
      outfit: { hat: null, scene: null },
      ownedOutfits: [],
      pinkUntil: 0,
    };
  }

  static freshDaily(date: string) {
    return {
      date,
      workMinutes: 0,
      signedIn: false,
      mousetrapUsed: 0,
      wishTreeUsed: false,
      treasureUsed: false,
      raceUsed: false,
      castlePlays: 0,
      mazePlays: 0,
      freeMealsUsed: 0,
      freeWashesUsed: 0,
    };
  }

  /** 物种名(由皮肤术语表提供,缺省"宠物") */
  private get species(): string {
    return (this.config as any).terms?.species ?? "宠物";
  }

  // ---------- 派生 ----------
  get level(): number {
    let lv = 0;
    for (const need of this.config.levelGrowth) {
      if (this.state.growth >= need) lv++;
      else break;
    }
    return Math.max(1, lv);
  }

  get attrMax(): number {
    const { baseMax, perLevelMax, maxLevelForAttr } = this.config.attr;
    return baseMax + perLevelMax * Math.min(this.level, maxLevelForAttr);
  }

  /** 实际可达上限:喂到这里就喂不进去了,界面按它算百分比 */
  get hungerFull(): number {
    return this.attrMax * (this.config.attr.feedCapPct ?? 0.6);
  }
  get cleanFull(): number {
    return this.attrMax * (this.config.attr.washCapPct ?? 0.9);
  }

  get hungerLow(): boolean {
    return this.state.hunger < this.attrMax * 0.24;
  }
  get cleanLow(): boolean {
    return this.state.clean < this.attrMax * 0.48;
  }
  isPink(now: number): boolean {
    return this.state.pinkUntil > now;
  }
  private shopPrice(price: number, now: number): number {
    return this.isPink(now) ? Math.round(price * this.config.pinkDiamond.shopDiscount) : price;
  }

  get moodCap(): number {
    if (this.state.activity.type === "work") return this.config.attr.moodCapWork;
    if (this.state.activity.type === "school") return this.config.attr.moodCapSchool;
    return this.config.attr.moodMax;
  }

  growthRate(mood: number) {
    for (const band of this.config.growthByMood) {
      if (mood >= band.min) return band;
    }
    return this.config.growthByMood[this.config.growthByMood.length - 1];
  }

  sicknessStage() {
    const s = this.state.sickness;
    if (!s) return null;
    return this.config.sickness.chains[s.chain].stages[s.stage - 1];
  }

  private diplomasOk(job: Job): boolean {
    if (job.diplomas.includes("ALL")) {
      const all = this.config.school.stages.flatMap((st) =>
        this.config.school.subjects.map((sub) => `${st.prefix}_${sub.key}`),
      );
      return all.every((c) => this.state.completedCourses.includes(c));
    }
    return job.diplomas.every((d) => this.state.completedCourses.includes(d));
  }

  jobAvailable(job: Job): { ok: boolean; reason: string } {
    if (this.level < job.minLevel) return { ok: false, reason: `需要 ${job.minLevel} 级` };
    if (!this.diplomasOk(job)) return { ok: false, reason: "学历不够" };
    return { ok: true, reason: "" };
  }

  // ---------- tick ----------
  /** 推进 minutes 分钟。返回需要冒泡展示的事件文本 */
  tick(minutes: number, now: number): string[] {
    const s = this.state;
    const c = this.config;
    const events: string[] = [];
    if (s.dead || s.dnd) return events;

    // 跨天重置
    const today = dateStr(now);
    if (s.daily.date !== today) s.daily = PetEngine.freshDaily(today);

    // --- 属性衰减 ---
    let hungerRate = c.decay.hungerPerMin;
    let cleanRate = c.decay.cleanPerMin;
    if (s.activity.type === "work") {
      const bracket = [...c.work.decayByLevel].reverse().find((b) => this.level >= b.minLevel);
      if (bracket) {
        hungerRate = bracket.hungerPerMin;
        cleanRate = bracket.cleanPerMin;
      }
    }
    s.hunger = Math.max(0, s.hunger - hungerRate * minutes);
    s.clean = Math.max(0, s.clean - cleanRate * minutes);

    // --- 心情 ---
    let moodDelta = -c.decay.moodPerMin;
    if (this.hungerLow || this.cleanLow) moodDelta -= c.decay.moodPenaltyPerMin;
    if (s.sickness) moodDelta -= c.decay.moodSickPerMin;
    if (s.activity.type === "travel" || s.activity.type === "visiting")
      moodDelta += c.moodGain.travelPerMin + c.decay.moodPerMin;
    s.mood = Math.max(0, Math.min(this.moodCap, s.mood + moodDelta * minutes));

    // --- 成长 ---
    s.growth += (this.growthRate(s.mood).perHour / 60) * minutes;
    s.onlineMinutes += minutes;
    if (s.marriage) {
      s.marriage.marriedMinutes += minutes;
      s.marriage.minutesSinceLastEgg += minutes;
    }

    // --- 活动推进 ---
    events.push(...this.tickActivity(minutes, now));

    // --- 疾病 ---
    events.push(...this.tickSickness(minutes, now));

    return events;
  }

  private tickActivity(minutes: number, now: number): string[] {
    const s = this.state;
    const events: string[] = [];
    const act = s.activity;
    if (act.type === "none") return events;
    act.minutes += minutes;

    if (act.type === "work") {
      act.unpaidMinutes += minutes;
      s.daily.workMinutes += minutes;
      if (s.daily.workMinutes >= this.config.work.dailyLimitMinutes) {
        events.push(this.settleWork("今天已经打了 8 小时工,宝贝罢工回家了!"));
      }
    } else if (act.type === "school" && s.currentCourse) {
      s.currentCourse.minutesDone += minutes;
      const course = this.courseInfo(s.currentCourse.courseId);
      if (course && s.currentCourse.minutesDone >= course.stage.hours * 60) {
        s.completedCourses.push(s.currentCourse.courseId);
        s.stats[course.subject.system] += course.stage.attrGain;
        s.yuanbao += course.stage.scholarship;
        events.push(
          `毕业啦!修完${course.stage.name}${course.subject.name},领到奖学金 ${course.stage.scholarship} 元宝,${this.config.school.systemNames[course.subject.system]}+${course.stage.attrGain}`,
        );
        s.currentCourse = null;
        s.activity = emptyActivity();
      }
    } else if (act.type === "travel") {
      if (act.minutes >= act.plannedMinutes) {
        events.push(...this.finishTravel(now));
      }
    } else if (act.type === "visiting") {
      // 按墙上时钟结束,与主人家的客人窗口(setTimeout)对齐;
      // 若按在线分钟计,app 重启会冻结进度,出现"永远在串门"
      if (this.visitOverdue(now)) {
        events.push(this.finishVisit());
      }
    }
    return events;
  }

  private tickSickness(minutes: number, now: number): string[] {
    const s = this.state;
    const c = this.config.sickness;
    const events: string[] = [];

    if (!s.sickness) {
      if (this.isPink(now) && this.config.pinkDiamond.immuneSickness) return events;
      let risk = 0;
      if (s.hunger < this.attrMax * 0.12) risk += c.riskPerMinHungry;
      if (s.clean < this.attrMax * 0.24) risk += c.riskPerMinDirty;
      if (s.mood < 500) risk += c.riskPerMinSadUnder500;
      if (risk > 0 && this.rng() < 1 - Math.pow(1 - risk, minutes)) {
        const chains = Object.keys(c.chains);
        const chain = chains[Math.floor(this.rng() * chains.length)];
        s.sickness = { chain, stage: 1, minutes: 0, diagnosed: false };
        s.health = 4;
        // 生病中断打工/学习
        if (s.activity.type === "work") events.push(this.settleWork("宝贝生病了,提前下班……"));
        events.push(`生病了!${c.chains[chain].stages[0].quote}`);
      }
      return events;
    }

    s.sickness.minutes += minutes;
    if (s.sickness.stage < 4 && s.sickness.minutes >= c.stageAdvanceMinutes) {
      s.sickness.stage += 1;
      s.sickness.minutes = 0;
      s.sickness.diagnosed = false; // 病情变了要重新诊断
      s.health = 5 - s.sickness.stage;
      events.push(`病情加重了……${this.sicknessStage()!.quote}`);
    } else if (s.sickness.stage === 4 && s.sickness.minutes >= c.deathAfterFinalStageMinutes) {
      s.dead = true;
      s.health = 0;
      s.activity = emptyActivity();
      events.push("__DEAD__");
    }
    return events;
  }

  // ---------- 喂养 ----------
  private spend(price: number): boolean {
    if (this.state.yuanbao < price) return false;
    this.state.yuanbao -= price;
    return true;
  }

  private addMood(amount: number): void {
    this.state.mood = Math.min(this.moodCap, this.state.mood + amount);
  }

  private guardAlive(): ActionResult | null {
    if (this.state.dead) return { ok: false, message: "宝贝已经不在了……用还魂丹复活它吧" };
    return null;
  }

  feed(itemId: string, now: number): ActionResult {
    const dead = this.guardAlive();
    if (dead) return dead;
    const item = this.config.foods.find((f) => f.id === itemId);
    if (!item) return { ok: false, message: "没有这种食物" };
    if (this.state.hunger >= this.hungerFull)
      return { ok: false, message: "宝贝已经吃撑了,再喂就浪费啦" };
    let price = this.shopPrice(item.price, now);
    let free = false;
    if (this.isPink(now) && this.state.daily.freeMealsUsed < this.config.pinkDiamond.freeMealPerDay) {
      this.state.daily.freeMealsUsed++;
      price = 0;
      free = true;
    }
    if (price > 0 && !this.spend(price)) return { ok: false, message: "元宝不够了……去打工赚点吧" };
    this.state.hunger = Math.min(this.attrMax, this.state.hunger + (item.hunger ?? 0));
    this.addMood(this.config.moodGain.feedWash);
    this.cancelDnd();
    return { ok: true, message: free ? `粉钻免费用餐!吃了${item.name}~` : `吃了${item.name},真香!` };
  }

  wash(itemId: string, now: number): ActionResult {
    const dead = this.guardAlive();
    if (dead) return dead;
    const item = this.config.washes.find((w) => w.id === itemId);
    if (!item) return { ok: false, message: "没有这种清洁用品" };
    if (this.state.clean >= this.cleanFull) return { ok: false, message: "宝贝已经很干净了" };
    // 库存里的沐浴球等可以直接用
    let price = this.shopPrice(item.price, now);
    let free = false;
    if ((this.state.inventory[itemId] ?? 0) > 0) {
      this.state.inventory[itemId]--;
      price = 0;
    } else if (this.isPink(now) && this.state.daily.freeWashesUsed < this.config.pinkDiamond.freeWashPerDay) {
      this.state.daily.freeWashesUsed++;
      price = 0;
      free = true;
    }
    if (price > 0 && !this.spend(price)) return { ok: false, message: "元宝不够了……去打工赚点吧" };
    this.state.clean = Math.min(this.attrMax, this.state.clean + (item.clean ?? 0));
    this.addMood(this.config.moodGain.feedWash);
    this.cancelDnd();
    return { ok: true, message: free ? `粉钻免费清洗!用${item.name}洗得香喷喷~` : `用${item.name}洗得干干净净~` };
  }

  petClick(now: number): boolean {
    if (this.state.dead) return false;
    const cooldownMs = this.config.moodGain.clickCooldownSec * 1000;
    if (now - this.state.lastClickGainAt < cooldownMs) return false;
    this.state.lastClickGainAt = now;
    this.addMood(this.config.moodGain.click);
    return true;
  }

  toggleDnd(on?: boolean): void {
    if (this.state.activity.type !== "none") return; // 活动中不能免打扰
    this.state.dnd = on ?? !this.state.dnd;
  }
  private cancelDnd(): void {
    if (this.state.dnd) this.state.dnd = false;
  }

  // ---------- 医疗 ----------
  consult(now: number): ActionResult {
    const dead = this.guardAlive();
    if (dead) return dead;
    const s = this.state.sickness;
    if (!s) return { ok: false, message: "医生说:宝贝很健康,不用看病~" };
    const fee = this.isPink(now) && this.config.pinkDiamond.freeConsult ? 0 : this.config.sickness.consultFee;
    if (fee > 0 && !this.spend(fee)) return { ok: false, message: `挂号要 ${fee} 元宝,钱不够了` };
    s.diagnosed = true;
    const st = this.sicknessStage()!;
    return {
      ok: true,
      message: `诊断结果:${st.disease}(${this.config.sickness.chains[s.chain].name})。处方:${st.medicine},药费 ${st.price} 元宝`,
    };
  }

  buyMedicine(now: number): ActionResult {
    const dead = this.guardAlive();
    if (dead) return dead;
    const s = this.state.sickness;
    if (!s) return { ok: false, message: "宝贝没有生病" };
    if (!s.diagnosed) return { ok: false, message: "要先挂号开处方,乱吃药会吃错的!" };
    const st = this.sicknessStage()!;
    const price = this.shopPrice(st.price, now);
    if (!this.spend(price)) return { ok: false, message: `${st.medicine}要 ${price} 元宝,钱不够了` };
    this.state.sickness = null;
    this.state.health = 5;
    this.state.hunger = Math.min(this.attrMax, this.state.hunger + this.config.sickness.medicineBonusHunger);
    this.state.clean = Math.min(this.attrMax, this.state.clean + this.config.sickness.medicineBonusClean);
    return { ok: true, message: `吃了${st.medicine},病好了!精神抖擞~` };
  }

  revive(now: number): ActionResult {
    if (!this.state.dead) return { ok: false, message: "宝贝好好的呢" };
    const inv = this.state.inventory;
    if ((inv.revive_pill ?? 0) > 0) {
      inv.revive_pill--;
    } else {
      const price = this.isPink(now)
        ? Math.round(this.config.sickness.revivePillPrice * this.config.pinkDiamond.reviveDiscount)
        : this.config.sickness.revivePillPrice;
      if (!this.spend(price)) return { ok: false, message: `还魂丹要 ${price} 元宝……` };
    }
    this.state.dead = false;
    this.state.sickness = null;
    this.state.health = 5;
    this.state.mood = 500;
    this.state.hunger = Math.round(this.attrMax * 0.3);
    this.state.clean = Math.round(this.attrMax * 0.3);
    return { ok: true, message: "还魂丹生效,宝贝活过来了!快好好照顾它" };
  }

  /** 埋葬 = 清档,由调用方负责生成新宠物 */
  canBury(): boolean {
    return this.state.dead;
  }

  // ---------- 打工 ----------
  startWork(jobId: string): ActionResult {
    const dead = this.guardAlive();
    if (dead) return dead;
    if (this.state.sickness) return { ok: false, message: "宝贝生着病,不能去打工" };
    if (this.state.activity.type !== "none") return { ok: false, message: "宝贝正忙着呢" };
    const job = this.config.work.jobs.find((j) => j.id === jobId);
    if (!job) return { ok: false, message: "没有这份工作" };
    const avail = this.jobAvailable(job);
    if (!avail.ok) return { ok: false, message: `干不了${job.name}:${avail.reason}` };
    if (this.state.daily.workMinutes >= this.config.work.dailyLimitMinutes)
      return { ok: false, message: "今天已经打满 8 小时工了,宝贝要罢工的!" };
    this.state.activity = { type: "work", refId: jobId, minutes: 0, plannedMinutes: 0, unpaidMinutes: 0 };
    this.state.mood = Math.min(this.state.mood, this.config.attr.moodCapWork);
    return { ok: true, message: `去${job.place}当${job.name}啦,时薪 ${job.wage} 元宝` };
  }

  /** 结算并结束打工,返回消息 */
  settleWork(prefix?: string): string {
    const act = this.state.activity;
    if (act.type !== "work") return "没有在打工";
    const job = this.config.work.jobs.find((j) => j.id === act.refId)!;
    const pay = Math.floor((act.unpaidMinutes / 60) * job.wage);
    this.state.yuanbao += pay;
    this.state.activity = emptyActivity();
    const worked = Math.round(act.minutes);
    return `${prefix ?? "下班!"}打了 ${worked} 分钟${job.name},赚到 ${pay} 元宝`;
  }

  stopWork(): ActionResult {
    if (this.state.activity.type !== "work") return { ok: false, message: "没有在打工" };
    return { ok: true, message: this.settleWork() };
  }

  // ---------- 学习 ----------
  courseInfo(courseId: string) {
    const [prefix, key] = courseId.split("_");
    const stage = this.config.school.stages.find((s) => s.prefix === prefix);
    const subject = this.config.school.subjects.find((s) => s.key === key);
    if (!stage || !subject) return null;
    return { stage, subject };
  }

  courseAvailable(courseId: string): { ok: boolean; reason: string } {
    const info = this.courseInfo(courseId);
    if (!info) return { ok: false, reason: "没有这门课" };
    if (this.state.completedCourses.includes(courseId)) return { ok: false, reason: "已经修完了" };
    if (this.level < info.stage.minLevel) return { ok: false, reason: `需要 ${info.stage.minLevel} 级` };
    const idx = this.config.school.stages.findIndex((s) => s.prefix === info.stage.prefix);
    if (idx > 0) {
      const prev = this.config.school.stages[idx - 1];
      const sameSystem = this.config.school.subjects.filter((s) => s.system === info.subject.system);
      const missing = sameSystem.filter(
        (s) => !this.state.completedCourses.includes(`${prev.prefix}_${s.key}`),
      );
      if (missing.length > 0)
        return { ok: false, reason: `要先修完${prev.name}${info.subject.system === "wu" ? "武力" : info.subject.system === "zhi" ? "智力" : "魅力"}系全部课程` };
    }
    return { ok: true, reason: "" };
  }

  startCourse(courseId: string): ActionResult {
    const dead = this.guardAlive();
    if (dead) return dead;
    if (this.state.sickness) return { ok: false, message: "宝贝生着病,不能去上学" };
    if (this.state.activity.type !== "none") return { ok: false, message: "宝贝正忙着呢" };
    const avail = this.courseAvailable(courseId);
    if (!avail.ok) return { ok: false, message: avail.reason };
    const info = this.courseInfo(courseId)!;
    const existing = this.state.currentCourse?.courseId === courseId ? this.state.currentCourse : null;
    this.state.currentCourse = existing ?? { courseId, minutesDone: 0 };
    this.state.activity = { type: "school", refId: courseId, minutes: 0, plannedMinutes: 0, unpaidMinutes: 0 };
    this.state.mood = Math.min(this.state.mood, this.config.attr.moodCapSchool);
    return {
      ok: true,
      message: `开始学${info.stage.name}${info.subject.name}(共 ${info.stage.hours} 小时,已学 ${Math.round((this.state.currentCourse.minutesDone / 60) * 10) / 10} 小时)`,
    };
  }

  stopSchool(): ActionResult {
    if (this.state.activity.type !== "school") return { ok: false, message: "没有在上学" };
    this.state.activity = emptyActivity();
    return { ok: true, message: "放学啦!课程进度已保存,下次接着学" };
  }

  // ---------- 旅游 ----------
  startTravel(modeId: string): ActionResult {
    const dead = this.guardAlive();
    if (dead) return dead;
    if (this.state.sickness) return { ok: false, message: "宝贝生着病,不能去旅游" };
    if (this.state.activity.type !== "none") return { ok: false, message: "宝贝正忙着呢" };
    if (this.level < this.config.travel.minLevel)
      return { ok: false, message: `${this.config.travel.minLevel} 级才能去旅游` };
    const mode = this.config.travel.modes.find((m) => m.id === modeId);
    if (!mode) return { ok: false, message: "没有这条线路" };
    if (!this.spend(mode.fare)) return { ok: false, message: `路费要 ${mode.fare} 元宝,钱不够了` };
    this.state.activity = {
      type: "travel",
      refId: modeId,
      minutes: 0,
      plannedMinutes: mode.minutes,
      unpaidMinutes: 0,
    };
    return { ok: true, message: `宝贝背上小书包出发去「${mode.name}」啦,${mode.minutes} 分钟后回来` };
  }

  private finishTravel(now: number): string[] {
    const c = this.config.travel;
    const mode = c.modes.find((m) => m.id === this.state.activity.refId);
    this.state.activity = emptyActivity();
    const events: string[] = [];
    const npcs = this.config.marriage.npcs;
    let report = `旅游回来啦!这次去「${mode?.name ?? "外面"}」玩得很开心`;

    if (mode?.id === "mystery" && this.rng() < c.dreamRewardChance) {
      const amount = Math.min(c.dreamRewardBase + this.state.dreamRewardCount * c.dreamRewardStep, c.dreamRewardMax);
      this.state.dreamRewardCount++;
      this.state.yuanbao += amount;
      events.push(`触发梦想奖励!捡到 ${amount} 元宝!(第 ${this.state.dreamRewardCount} 次)`);
    }
    if (this.rng() < c.chestChance) {
      const roll = this.rng();
      if (roll < 0.5) {
        const amt = 20 + Math.floor(this.rng() * 60);
        this.state.yuanbao += amt;
        events.push(`路上捡到宝箱和钥匙,打开得到 ${amt} 元宝`);
      } else {
        this.state.inventory.bath_ball = (this.state.inventory.bath_ball ?? 0) + 1;
        events.push("路上捡到宝箱和钥匙,打开得到一个沐浴球");
      }
    }
    if (this.rng() < c.guestChance) {
      const guest = npcs[Math.floor(this.rng() * npcs.length)];
      this.addMood(100);
      events.push(`带回了小客人「${guest.name}」来串门,两只${this.species}玩得很开心(心情+100)`);
    }
    events.unshift(report);
    return events;
  }

  // ---------- 局域网串门 ----------
  /** 出门去邻居家。时长由调用方给,到点自动回来 */
  startVisit(peerId: string, peerName: string, minutes: number, now: number): ActionResult {
    const dead = this.guardAlive();
    if (dead) return dead;
    if (this.state.sickness) return { ok: false, message: "宝贝生着病,不方便去串门" };
    if (this.state.activity.type !== "none") return { ok: false, message: "宝贝正忙着呢" };
    this.state.activity = {
      type: "visiting",
      refId: peerId,
      refName: peerName,
      minutes: 0,
      plannedMinutes: minutes,
      unpaidMinutes: 0,
      startedAtMs: now,
    };
    return { ok: true, message: `出发去「${peerName}」家串门啦,${minutes} 分钟后回来` };
  }

  /** 串门是否已到点(墙上时钟)。老存档没有 startedAtMs 的一律视为到点 */
  visitOverdue(now: number): boolean {
    const act = this.state.activity;
    if (act.type !== "visiting") return false;
    if (!act.startedAtMs) return true;
    return now - act.startedAtMs >= act.plannedMinutes * 60_000;
  }

  /** 到点(或被提前叫回)结束串门 */
  finishVisit(): string {
    const act = this.state.activity;
    const who = act.refName || "邻居";
    this.state.activity = emptyActivity();
    this.addMood(this.config.moodGain.game);
    const souvenir = 20 + Math.floor(this.rng() * 40);
    this.state.yuanbao += souvenir;
    return `从「${who}」家回来啦!玩得很开心,还带回 ${souvenir} 元宝的伴手礼`;
  }

  isVisiting(): boolean {
    return this.state.activity.type === "visiting";
  }

  /** 家里来客人了:主人家的宝贝也开心 */
  receiveGuest(guestName: string): string {
    this.addMood(this.config.moodGain.toy);
    return `「${guestName}」来家里串门啦!两个小家伙玩得很开心(心情 +${this.config.moodGain.toy})`;
  }

  // ---------- 福利 ----------
  signin(): ActionResult {
    const dead = this.guardAlive();
    if (dead) return dead;
    if (this.state.daily.signedIn) return { ok: false, message: "今天已经签过到啦" };
    const w = this.config.welfare.signin;
    const amt = w.min + Math.floor(this.rng() * (w.max - w.min + 1));
    this.state.daily.signedIn = true;
    this.state.yuanbao += amt;
    return { ok: true, message: `每日签到成功,获得 ${amt} 元宝` };
  }

  mousetrap(now: number): ActionResult {
    const dead = this.guardAlive();
    if (dead) return dead;
    const w = this.config.welfare.mousetrap;
    if (this.level < w.minLevel) return { ok: false, message: `${w.minLevel} 级才能用捕鼠夹` };
    const limit = this.isPink(now) ? 2 : 1;
    if (this.state.daily.mousetrapUsed >= limit) return { ok: false, message: "今天的捕鼠夹用完啦" };
    this.state.daily.mousetrapUsed++;
    const amt = Math.floor(this.rng() * (w.max + 1));
    this.state.yuanbao += amt;
    return { ok: true, message: amt > 0 ? `捕鼠夹夹到一只老鼠,得到 ${amt} 元宝!` : "捕鼠夹空了,一只老鼠都没来……" };
  }

  wishTree(now: number): ActionResult {
    const dead = this.guardAlive();
    if (dead) return dead;
    const w = this.config.welfare.wishTree;
    if (w.weekendOnly && !isWeekend(now)) return { ok: false, message: "许愿树只在周末开放" };
    if (this.state.daily.wishTreeUsed) return { ok: false, message: "今天已经许过愿啦" };
    this.state.daily.wishTreeUsed = true;
    const amt = w.rewards[Math.floor(this.rng() * w.rewards.length)];
    this.state.yuanbao += amt;
    return { ok: true, message: `对着许愿树许了个愿,树上掉下 ${amt} 元宝!` };
  }

  treasureHunt(now: number): ActionResult {
    const dead = this.guardAlive();
    if (dead) return dead;
    const w = this.config.welfare.treasureHunt;
    if (this.level < w.minLevel) return { ok: false, message: `${w.minLevel} 级才能寻宝` };
    if (w.weekendOnly && !isWeekend(now)) return { ok: false, message: "寻宝乐园只在周末开放" };
    if (this.state.daily.treasureUsed) return { ok: false, message: "今天已经寻过宝啦" };
    this.state.daily.treasureUsed = true;
    const amt = w.min + Math.floor(this.rng() * (w.max - w.min + 1));
    this.state.yuanbao += amt;
    return { ok: true, message: `寻宝挖到 ${amt} 元宝!` };
  }

  race(): ActionResult {
    const dead = this.guardAlive();
    if (dead) return dead;
    const w = this.config.welfare.race;
    if (this.level < w.minLevel) return { ok: false, message: `${w.minLevel} 级才能参加牛翔赛跑` };
    if (this.state.daily.raceUsed) return { ok: false, message: "今天已经跑过啦" };
    this.state.daily.raceUsed = true;
    if (this.rng() < w.winRate) {
      this.state.inventory[w.prizeItem] = (this.state.inventory[w.prizeItem] ?? 0) + 1;
      return { ok: true, message: "牛翔赛跑赢啦!奖品:沐浴球一个" };
    }
    return { ok: true, message: "牛翔赛跑输了……明天再来" };
  }

  // ---------- 结婚 ----------
  claimFreeRing(): ActionResult {
    const dead = this.guardAlive();
    if (dead) return dead;
    const m = this.config.marriage;
    if (this.level < m.freeRingLevel) return { ok: false, message: `${m.freeRingLevel} 级才能领挚爱金戒` };
    if (this.state.freeRingClaimed) return { ok: false, message: "挚爱金戒只能领一枚哦" };
    this.state.freeRingClaimed = true;
    this.state.inventory.gold_ring = (this.state.inventory.gold_ring ?? 0) + 1;
    return { ok: true, message: "教堂小天使送了你一枚挚爱金戒!" };
  }

  buyRing(ringId: string, now: number): ActionResult {
    const dead = this.guardAlive();
    if (dead) return dead;
    const ring = this.config.marriage.rings.find((r) => r.id === ringId);
    if (!ring) return { ok: false, message: "珠宝店没有这款戒指" };
    if (ring.price === 0) return { ok: false, message: "挚爱金戒要找教堂小天使免费领" };
    const price = this.shopPrice(ring.price, now);
    if (!this.spend(price)) return { ok: false, message: `${ring.name}要 ${price} 元宝,钱不够` };
    this.state.inventory[ringId] = (this.state.inventory[ringId] ?? 0) + 1;
    return { ok: true, message: `买下了${ring.name},祝有情${this.species}终成眷属~` };
  }

  propose(npcId: string, ringId: string): ActionResult {
    const dead = this.guardAlive();
    if (dead) return dead;
    const m = this.config.marriage;
    if (this.state.marriage) return { ok: false, message: "宝贝已经结婚啦" };
    if (this.level < m.minLevel) return { ok: false, message: `${m.minLevel} 级才能结婚` };
    const npc = m.npcs.find((n) => n.id === npcId);
    if (!npc) return { ok: false, message: `没有这只${this.species}` };
    if (npc.gender === this.state.gender) return { ok: false, message: "王国的婚姻法规定要一只QGG和一只QMM哦" };
    const ring = m.rings.find((r) => r.id === ringId);
    if (!ring || (this.state.inventory[ringId] ?? 0) < 1)
      return { ok: false, message: "你还没有这枚戒指,先去珠宝店买(或教堂领)" };
    this.state.inventory[ringId]--;
    if (this.rng() > ring.acceptRate) {
      return { ok: false, message: `${npc.name}害羞地拒绝了……戒指也被收下了(下次买贵一点的吧)` };
    }
    this.state.marriage = {
      spouseId: npcId,
      ringId,
      ringLove: ring.love,
      marriedMinutes: 0,
      growthAtMarriage: this.state.growth,
      eggsBorn: 0,
      minutesSinceLastEgg: 0,
    };
    return { ok: true, message: `神父宣布:你和${npc.name}结为夫妻!爱情值 ${ring.love} 起步,好好经营哦` };
  }

  loveValue(): number {
    const mg = this.state.marriage;
    if (!mg) return 0;
    return Math.round(mg.ringLove + (this.state.growth - mg.growthAtMarriage) * 10);
  }

  layEgg(): ActionResult {
    const dead = this.guardAlive();
    if (dead) return dead;
    const mg = this.state.marriage;
    const m = this.config.marriage;
    if (!mg) return { ok: false, message: "要先结婚才能培育宠物蛋哦" };
    if (mg.eggsBorn >= m.maxEggs) return { ok: false, message: "一生最多只能培育 10 只宠物蛋" };
    if (mg.minutesSinceLastEgg < m.eggIntervalMinutes) {
      const remain = Math.ceil((m.eggIntervalMinutes - mg.minutesSinceLastEgg) / 60);
      return { ok: false, message: `感情还需要积累,还差约 ${remain} 小时才能培育下一只蛋` };
    }
    mg.eggsBorn++;
    mg.minutesSinceLastEgg = 0;
    this.state.inventory.egg = (this.state.inventory.egg ?? 0) + 1;
    return { ok: true, message: `神父特里斯坦主持培育仪式,你们得到了一只宠物蛋!(第 ${mg.eggsBorn}/10 只)` };
  }

  /** 孵化二代:返回新宠物初始参数,由调用方替换存档 */
  hatchInfo(): { ok: boolean; message: string; bonusGrowth: number; parents: { father: string; mother: string } | null } {
    if ((this.state.inventory.egg ?? 0) < 1)
      return { ok: false, message: "还没有宠物蛋", bonusGrowth: 0, parents: null };
    const love = this.loveValue();
    const bonus = Math.min(Math.round(love / 40), 50);
    const spouse = this.config.marriage.npcs.find((n) => n.id === this.state.marriage?.spouseId);
    const father = this.state.gender === "QGG" ? this.state.name : spouse?.name ?? "?";
    const mother = this.state.gender === "QMM" ? this.state.name : spouse?.name ?? "?";
    return { ok: true, message: "", bonusGrowth: bonus, parents: { father, mother } };
  }

  divorce(): ActionResult {
    const dead = this.guardAlive();
    if (dead) return dead;
    if (!this.state.marriage) return { ok: false, message: "宝贝还是单身呢" };
    this.state.marriage = null;
    this.state.stats.mei = Math.round(this.state.stats.mei * (1 - this.config.marriage.divorcePenaltyMeiPct / 100));
    return { ok: true, message: "神父宣布婚姻解除。爱情值清零,魅力受损,戒指也没有了……" };
  }

  // ---------- 小游戏 ----------
  castleCanPlay(now: number): { ok: boolean; message: string } {
    const limit = this.isPink(now) ? this.config.games.castle.pinkDailyLimit : this.config.games.castle.dailyLimit;
    if (this.state.daily.castlePlays >= limit) return { ok: false, message: "今天的古堡战记次数用完啦" };
    if (this.state.dead || this.state.sickness) return { ok: false, message: "宝贝现在没法去古堡冒险" };
    if (this.state.activity.type !== "none") return { ok: false, message: "宝贝正忙着呢" };
    return { ok: true, message: "" };
  }

  castleStart(now: number): ActionResult {
    const can = this.castleCanPlay(now);
    if (!can.ok) return { ok: false, message: can.message };
    this.state.daily.castlePlays++;
    return { ok: true, message: "进入古堡!" };
  }

  castleFinish(bossesDefeated: number): ActionResult {
    const c = this.config.games.castle;
    let reward = c.normalReward;
    for (let i = 0; i < bossesDefeated && i < c.bosses.length; i++) reward += c.bosses[i].reward;
    this.state.yuanbao += reward;
    this.addMood(this.config.moodGain.game);
    return { ok: true, message: `古堡战记结束,击败 ${bossesDefeated} 个 Boss,获得 ${reward} 元宝!` };
  }

  mazeStart(): ActionResult {
    if (this.state.daily.mazePlays >= this.config.games.maze.dailyLimit)
      return { ok: false, message: "今天的密室探险次数用完啦" };
    if (this.state.dead || this.state.sickness) return { ok: false, message: "宝贝现在没法去密室" };
    if (this.state.activity.type !== "none") return { ok: false, message: "宝贝正忙着呢" };
    this.state.daily.mazePlays++;
    return { ok: true, message: "进入密室!" };
  }

  mazeFinish(escaped: boolean): ActionResult {
    if (!escaped) return { ok: true, message: "没能逃出密室……明天再来挑战" };
    for (const itemId of this.config.games.maze.rewardItems) {
      this.state.inventory[itemId] = (this.state.inventory[itemId] ?? 0) + 1;
    }
    this.addMood(this.config.moodGain.game);
    return { ok: true, message: "成功逃出密室!奖励:毛巾×1、香瓜果冻×1(已放进背包)" };
  }

  // ---------- 装扮 / 粉钻 ----------
  buyOutfit(outfitId: string, now: number): ActionResult {
    const dead = this.guardAlive();
    if (dead) return dead;
    const o = this.config.outfits.find((x) => x.id === outfitId);
    if (!o) return { ok: false, message: "名品城没有这件装扮" };
    if (this.state.ownedOutfits.includes(outfitId)) return { ok: false, message: "已经拥有这件装扮了" };
    const price = this.shopPrice(o.price, now);
    if (!this.spend(price)) return { ok: false, message: `${o.name}要 ${price} 元宝,钱不够` };
    this.state.ownedOutfits.push(outfitId);
    this.state.stats.mei += o.mei;
    return { ok: true, message: `买下了${o.name}!魅力+${o.mei}` };
  }

  equipOutfit(outfitId: string | null, slot: "hat" | "scene"): ActionResult {
    if (outfitId === null) {
      this.state.outfit[slot] = null;
      return { ok: true, message: "脱下了装扮" };
    }
    if (!this.state.ownedOutfits.includes(outfitId)) return { ok: false, message: "还没有买这件装扮" };
    const o = this.config.outfits.find((x) => x.id === outfitId);
    if (!o || o.slot !== slot) return { ok: false, message: "槽位不对" };
    this.state.outfit[slot] = outfitId;
    return { ok: true, message: `穿上了${o.name},美美哒~` };
  }

  rename(newName: string): ActionResult {
    const dead = this.guardAlive();
    if (dead) return dead;
    const name = newName.trim();
    if (!name || name.length > 8) return { ok: false, message: "名字要 1~8 个字" };
    // renameCardPrice 为 0 表示免费改名(默认),>0 时才扣元宝
    const price = this.config.renameCardPrice ?? 0;
    if (price > 0 && !this.spend(price))
      return { ok: false, message: `改名要 ${price} 元宝` };
    this.state.name = name;
    return { ok: true, message: `改名成功!以后就叫「${name}」啦` };
  }

  buyPink(now: number): ActionResult {
    const dead = this.guardAlive();
    if (dead) return dead;
    const p = this.config.pinkDiamond;
    if (!this.spend(p.price)) return { ok: false, message: `开通粉钻要 ${p.price} 元宝` };
    const base = Math.max(this.state.pinkUntil, now);
    this.state.pinkUntil = base + p.days * 24 * 60 * 60 * 1000;
    return { ok: true, message: `粉钻贵族开通成功!有效期 ${p.days} 天(可叠加)` };
  }

  // ---------- 快照 ----------
  snapshot(now: number): StatusSnapshot {
    const lv = this.level;
    const rate = this.growthRate(this.state.mood);
    const st = this.sicknessStage();
    const act = this.state.activity;
    let activityLabel = "";
    if (act.type === "work") {
      const job = this.config.work.jobs.find((j) => j.id === act.refId);
      activityLabel = `打工中:${job?.name}(${Math.round(act.minutes)} 分钟)`;
    } else if (act.type === "school") {
      const info = this.courseInfo(act.refId);
      const done = this.state.currentCourse?.minutesDone ?? 0;
      activityLabel = `上学中:${info?.stage.name}${info?.subject.name}(${Math.round(done)}/${(info?.stage.hours ?? 0) * 60} 分钟)`;
    } else if (act.type === "travel") {
      activityLabel = `旅游中(${Math.round(act.plannedMinutes - act.minutes)} 分钟后回来)`;
    } else if (act.type === "visiting") {
      // 剩余时间按墙上时钟算,与结束判定一致
      const remainMs = (act.startedAtMs ?? 0) + act.plannedMinutes * 60_000 - now;
      const remain = Math.max(0, Math.ceil(remainMs / 60_000));
      activityLabel = `在「${act.refName || "邻居"}」家串门(${remain} 分钟后回来)`;
    }
    return {
      state: JSON.parse(JSON.stringify(this.state)),
      level: lv,
      hungerMax: this.attrMax,
      cleanMax: this.attrMax,
      hungerFull: Math.round(this.hungerFull),
      cleanFull: Math.round(this.cleanFull),
      hungerLabel: this.bandLabel(this.state.hunger, this.config.hungerStates),
      cleanLabel: this.bandLabel(this.state.clean, this.config.cleanStates),
      moodLabel: rate.label,
      moodColor: rate.color,
      growthPerHour: rate.perHour,
      levelBase: this.config.levelGrowth[lv - 1] ?? 0,
      nextLevelGrowth: this.config.levelGrowth[lv] ?? null,
      sicknessInfo: st
        ? {
            chainName: this.config.sickness.chains[this.state.sickness!.chain].name,
            disease: this.state.sickness!.diagnosed ? st.disease : "??(要去医院诊断)",
            quote: st.quote,
            medicinePrice: st.price,
          }
        : null,
      isPink: this.isPink(now),
      activityLabel,
    };
  }

  private bandLabel(value: number, bands: { label: string; pct: number }[]): string {
    const max = this.attrMax;
    for (const b of bands) {
      if (value >= max * b.pct && b.pct > 0) return b.label;
    }
    return bands[bands.length - 1].label;
  }
}
