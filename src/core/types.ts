export interface StateBand {
  label: string;
  pct: number;
}

export interface GrowthBand {
  min: number;
  perHour: number;
  label: string;
  color: string;
}

export interface ShopItem {
  id: string;
  name: string;
  price: number;
  hunger?: number;
  clean?: number;
}

export interface DiseaseStage {
  disease: string;
  medicine: string;
  price: number;
  quote: string;
}

export interface Job {
  id: string;
  name: string;
  place: string;
  minLevel: number;
  wage: number;
  /** 需要的文凭 course id 列表;["ALL"] = 全部课程 */
  diplomas: string[];
}

export interface SchoolStage {
  prefix: string;
  name: string;
  minLevel: number;
  hours: number;
  scholarship: number;
  attrGain: number;
}

export interface Subject {
  key: string;
  name: string;
  system: "wu" | "zhi" | "mei";
}

export interface Ring {
  id: string;
  name: string;
  price: number;
  love: number;
  acceptRate: number;
  note?: string;
}

export interface Npc {
  id: string;
  name: string;
  gender: "QGG" | "QMM";
  level: number;
  personality: string;
}

export interface TravelMode {
  id: string;
  name: string;
  minutes: number;
  fare: number;
}

export interface Outfit {
  id: string;
  name: string;
  slot: "hat" | "scene";
  price: number;
  emoji?: string;
  color?: string;
  mei: number;
}

export interface GameConfig {
  timeScale: number;
  decay: {
    hungerPerMin: number;
    cleanPerMin: number;
    moodPerMin: number;
    moodPenaltyPerMin: number;
    moodSickPerMin: number;
  };
  attr: {
    baseMax: number;
    perLevelMax: number;
    maxLevelForAttr: number;
    moodMax: number;
    moodCapWork: number;
    moodCapSchool: number;
    /** 到这个比例就拒绝喂食/洗澡 —— 也就是玩家实际能填到的上限 */
    feedCapPct: number;
    washCapPct: number;
  };
  hungerStates: StateBand[];
  cleanStates: StateBand[];
  moodGain: {
    click: number;
    clickCooldownSec: number;
    feedWash: number;
    toy: number;
    game: number;
    travelPerMin: number;
  };
  growthByMood: GrowthBand[];
  levelGrowth: number[];
  economy: { initialYuanbao: number; initialRevivePills: number };
  foods: ShopItem[];
  washes: ShopItem[];
  sickness: {
    consultFee: number;
    riskPerMinHungry: number;
    riskPerMinDirty: number;
    riskPerMinSadUnder500: number;
    stageAdvanceMinutes: number;
    deathAfterFinalStageMinutes: number;
    medicineBonusHunger: number;
    medicineBonusClean: number;
    revivePillPrice: number;
    chains: Record<string, { name: string; stages: DiseaseStage[] }>;
  };
  work: {
    dailyLimitMinutes: number;
    decayByLevel: { minLevel: number; hungerPerMin: number; cleanPerMin: number }[];
    jobs: Job[];
  };
  school: {
    stages: SchoolStage[];
    subjects: Subject[];
    systemNames: Record<string, string>;
  };
  marriage: {
    minLevel: number;
    freeRingLevel: number;
    eggIntervalMinutes: number;
    maxEggs: number;
    divorcePenaltyMeiPct: number;
    rings: Ring[];
    npcs: Npc[];
  };
  travel: {
    minLevel: number;
    modes: TravelMode[];
    dreamRewardBase: number;
    dreamRewardStep: number;
    dreamRewardMax: number;
    dreamRewardChance: number;
    chestChance: number;
    guestChance: number;
  };
  welfare: {
    signin: { min: number; max: number };
    mousetrap: { minLevel: number; max: number };
    wishTree: { weekendOnly: boolean; rewards: number[] };
    treasureHunt: { minLevel: number; weekendOnly: boolean; min: number; max: number };
    race: { minLevel: number; winRate: number; prizeItem: string };
  };
  games: {
    castle: {
      name: string;
      dailyLimit: number;
      pinkDailyLimit: number;
      normalReward: number;
      bosses: { name: string; hp: number; atk: number; reward: number }[];
    };
    maze: {
      name: string;
      dailyLimit: number;
      timeLimitSec: number;
      rewardItems: string[];
    };
  };
  outfits: Outfit[];
  renameCardPrice: number;
  pinkDiamond: {
    price: number;
    days: number;
    shopDiscount: number;
    reviveDiscount: number;
    freeMealPerDay: number;
    freeWashPerDay: number;
    immuneSickness: boolean;
    freeConsult: boolean;
  };
  bubbles: Record<string, string[]>;
  /** 皮肤注入的术语表(物种名、地名、性别称呼等) */
  terms?: Record<string, string>;
}

export interface Sickness {
  chain: string;
  /** 1~4,对应 chains[chain].stages[stage-1] */
  stage: number;
  /** 当前病情已持续分钟 */
  minutes: number;
  /** 是否已看病(已知病名与处方) */
  diagnosed: boolean;
}

export type ActivityType = "none" | "work" | "school" | "travel" | "visiting";

export interface Activity {
  type: ActivityType;
  /** work: jobId / school: courseId / travel: modeId / visiting: peerId */
  refId: string;
  /** visiting: 主人家宝贝的名字,用于回来时的汇报 */
  refName?: string;
  minutes: number;
  /** travel 用:计划总分钟数 */
  plannedMinutes: number;
  /**
   * visiting 用:出发时的墙上时间。串门必须按墙上时钟结束 ——
   * 主人家的客人窗口是 setTimeout(墙上时钟),访客若按"在线分钟"计时,
   * app 一重启进度就冻结,会出现"对方家客人早走了,自己却永远在串门"。
   */
  startedAtMs?: number;
  /** work 用:未结算的工资分钟数 */
  unpaidMinutes: number;
}

export interface MarriageState {
  spouseId: string;
  ringId: string;
  ringLove: number;
  marriedMinutes: number;
  /** 结婚时的成长值(算婚后成长) */
  growthAtMarriage: number;
  eggsBorn: number;
  minutesSinceLastEgg: number;
}

export interface DailyState {
  date: string;
  workMinutes: number;
  signedIn: boolean;
  mousetrapUsed: number;
  wishTreeUsed: boolean;
  treasureUsed: boolean;
  raceUsed: boolean;
  castlePlays: number;
  mazePlays: number;
  freeMealsUsed: number;
  freeWashesUsed: number;
}

export interface PetState {
  name: string;
  gender: "QGG" | "QMM";
  generation: number;
  parents: { father: string; mother: string } | null;
  adoptedAt: number;
  hunger: number;
  clean: number;
  mood: number;
  /** 5=健康,4~1=病情逐级加重,0=死亡 */
  health: number;
  growth: number;
  yuanbao: number;
  dnd: boolean;
  lastClickGainAt: number;
  onlineMinutes: number;
  sickness: Sickness | null;
  dead: boolean;
  inventory: Record<string, number>;
  activity: Activity;
  /** 已修完课程 id(如 p_wushu / m_yuwen / u_meishu) */
  completedCourses: string[];
  currentCourse: { courseId: string; minutesDone: number } | null;
  /** 三围 */
  stats: { wu: number; zhi: number; mei: number };
  marriage: MarriageState | null;
  /** 曾领过免费金戒 */
  freeRingClaimed: boolean;
  daily: DailyState;
  /** 梦想奖励累计领取次数(旅游) */
  dreamRewardCount: number;
  outfit: { hat: string | null; scene: string | null };
  ownedOutfits: string[];
  /** 粉钻到期时间戳(0=未开通) */
  pinkUntil: number;
}

export interface StatusSnapshot {
  state: PetState;
  level: number;
  hungerMax: number;
  cleanMax: number;
  /**
   * 实际可达上限(喂食/洗澡被拒绝的那条线)。
   * 界面必须按这个算百分比:hungerMax 是理论容量,但喂到 60% 就喂不进去了,
   * 拿理论容量当分母会出现"42% 却显示吃得很饱"这种自相矛盾。
   */
  hungerFull: number;
  cleanFull: number;
  hungerLabel: string;
  cleanLabel: string;
  moodLabel: string;
  moodColor: string;
  growthPerHour: number;
  levelBase: number;
  nextLevelGrowth: number | null;
  sicknessInfo: { chainName: string; disease: string; quote: string; medicinePrice: number } | null;
  isPink: boolean;
  activityLabel: string;
}

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };
