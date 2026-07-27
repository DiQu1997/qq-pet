import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PetEngine } from "../src/core/engine";
import type { GameConfig } from "../src/core/types";

const config: GameConfig = JSON.parse(
  readFileSync(join(__dirname, "..", "config.json"), "utf-8"),
);

const NOW = new Date("2026-07-27T10:00:00").getTime(); // 周一
const WEEKEND = new Date("2026-07-25T10:00:00").getTime(); // 周六

function fresh(rng: () => number = () => 0.99) {
  return new PetEngine(config, PetEngine.newPet(config, "测试", "QGG", NOW), rng);
}

describe("等级与属性上限", () => {
  it("新宠物 1 级,上限 3000+100", () => {
    const e = fresh();
    expect(e.level).toBe(1);
    expect(e.attrMax).toBe(3100);
  });

  it("成长值对照表:106→10级,2393→30级,5575→40级;30级后上限封顶6000", () => {
    const e = fresh();
    e.state.growth = 106;
    expect(e.level).toBe(10);
    e.state.growth = 2393;
    expect(e.level).toBe(30);
    e.state.growth = 5575;
    expect(e.level).toBe(40);
    expect(e.attrMax).toBe(6000);
  });
});

describe("衰减 tick", () => {
  it("平时每分钟饥饿/清洁各 -2", () => {
    const e = fresh();
    const h0 = e.state.hunger;
    e.tick(60, NOW);
    expect(e.state.hunger).toBe(h0 - 120);
  });

  it("饥饿状态下心情额外 -15/分钟", () => {
    const e = fresh();
    e.state.hunger = 0;
    e.state.mood = 1000;
    e.tick(10, NOW);
    expect(e.state.mood).toBe(1000 - 17 * 10);
  });

  it("免打扰时不衰减不成长", () => {
    const e = fresh();
    e.toggleDnd(true);
    const before = { ...e.state };
    e.tick(120, NOW);
    expect(e.state.hunger).toBe(before.hunger);
    expect(e.state.growth).toBe(before.growth);
  });

  it("满心情逐分钟挂机 1 小时 ≈ +2 成长", () => {
    const e = fresh();
    e.state.mood = 1000;
    e.state.hunger = e.attrMax;
    e.state.clean = e.attrMax;
    const g0 = e.state.growth;
    for (let i = 0; i < 60; i++) e.tick(1, NOW);
    expect(e.state.growth - g0).toBeCloseTo(2.0, 1);
  });
});

describe("喂食与洗澡", () => {
  it("喂小饼干:扣 20 元宝,+360 饥饿,+150 心情", () => {
    const e = fresh();
    e.state.hunger = 500;
    e.state.mood = 500;
    const r = e.feed("biscuit", NOW);
    expect(r.ok).toBe(true);
    expect(e.state.yuanbao).toBe(280);
    expect(e.state.hunger).toBe(860);
    expect(e.state.mood).toBe(650);
  });

  it("吃撑拒喂、没钱拒卖、不溢出", () => {
    const e = fresh();
    e.state.hunger = e.attrMax * 0.7;
    expect(e.feed("biscuit", NOW).ok).toBe(false);
    e.state.hunger = 100;
    e.state.yuanbao = 5;
    expect(e.feed("biscuit", NOW).ok).toBe(false);
    e.state.yuanbao = 300;
    e.state.hunger = e.attrMax * 0.59;
    e.feed("feast", NOW);
    expect(e.state.hunger).toBeLessThanOrEqual(e.attrMax);
  });

  it("背包里的沐浴球免费用", () => {
    const e = fresh();
    e.state.clean = 100;
    e.state.inventory.bath_ball = 1;
    const y0 = e.state.yuanbao;
    expect(e.wash("bath_ball", NOW).ok).toBe(true);
    expect(e.state.yuanbao).toBe(y0);
    expect(e.state.inventory.bath_ball).toBe(0);
  });
});

describe("M1 疾病与死亡", () => {
  it("又饿又脏时会生病(rng=0 必中),中断打工", () => {
    const e = fresh(() => 0);
    e.state.hunger = 0;
    e.state.clean = 0;
    const events = e.tick(1, NOW);
    expect(e.state.sickness).not.toBeNull();
    expect(e.state.health).toBe(4);
    expect(events.some((x) => x.includes("生病"))).toBe(true);
  });

  it("病情 12 小时不治加重一级,4 期再拖 12 小时死亡", () => {
    const e = fresh(() => 0.99);
    e.state.sickness = { chain: "cold", stage: 1, minutes: 0, diagnosed: true };
    e.state.health = 4;
    e.state.hunger = e.attrMax;
    e.state.clean = e.attrMax;
    for (let stage = 2; stage <= 4; stage++) {
      e.tick(720, NOW);
      expect(e.state.sickness!.stage).toBe(stage);
      expect(e.state.health).toBe(5 - stage);
      expect(e.state.sickness!.diagnosed).toBe(false);
    }
    const events = e.tick(720, NOW);
    expect(e.state.dead).toBe(true);
    expect(e.state.health).toBe(0);
    expect(events).toContain("__DEAD__");
  });

  it("看病开处方 50 元宝 → 按处方买药痊愈,未诊断不能买药", () => {
    const e = fresh();
    e.state.sickness = { chain: "stomach", stage: 2, minutes: 0, diagnosed: false };
    e.state.health = 3;
    expect(e.buyMedicine(NOW).ok).toBe(false);
    const y0 = e.state.yuanbao;
    const r = e.consult(NOW);
    expect(r.ok).toBe(true);
    expect(r.message).toContain("胃炎");
    expect(e.state.yuanbao).toBe(y0 - 50);
    const r2 = e.buyMedicine(NOW);
    expect(r2.ok).toBe(true);
    expect(e.state.sickness).toBeNull();
    expect(e.state.health).toBe(5);
    expect(e.state.yuanbao).toBe(y0 - 50 - 80);
  });

  it("死亡后还魂丹复活保留成长;初始送一颗", () => {
    const e = fresh();
    e.state.growth = 500;
    e.state.dead = true;
    e.state.health = 0;
    expect(e.state.inventory.revive_pill).toBe(1);
    const r = e.revive(NOW);
    expect(r.ok).toBe(true);
    expect(e.state.dead).toBe(false);
    expect(e.state.growth).toBe(500);
    expect(e.state.inventory.revive_pill).toBe(0);
    // 再死一次要花 400 元宝
    e.state.dead = true;
    e.state.yuanbao = 400;
    expect(e.revive(NOW).ok).toBe(true);
    expect(e.state.yuanbao).toBe(0);
  });
});

describe("M2 打工", () => {
  it("无学历工作 0 级可做;时薪按分钟结算", () => {
    const e = fresh();
    expect(e.startWork("banzhuan").ok).toBe(true);
    e.tick(60, NOW);
    const r = e.stopWork();
    expect(r.ok).toBe(true);
    expect(r.message).toContain("20 元宝");
  });

  it("学历不够拒绝;修完课程后可上岗", () => {
    const e = fresh();
    e.state.growth = 28; // 6级
    expect(e.startWork("huajiang").ok).toBe(false);
    e.state.completedCourses = ["p_liyi"];
    expect(e.startWork("huajiang").ok).toBe(true);
  });

  it("打工时心情封顶 600,消耗按等级档", () => {
    const e = fresh();
    e.state.mood = 1000;
    e.startWork("banzhuan");
    expect(e.state.mood).toBe(600);
    const h0 = e.state.hunger;
    e.tick(10, NOW);
    expect(h0 - e.state.hunger).toBeCloseTo(32, 5); // 0-5级 3.2/分
  });

  it("每天打满 8 小时自动罢工结算", () => {
    const e = fresh();
    e.state.yuanbao = 10000;
    e.startWork("banzhuan");
    const events = e.tick(480, NOW);
    expect(e.state.activity.type).toBe("none");
    expect(events.some((x) => x.includes("罢工"))).toBe(true);
    expect(e.startWork("banzhuan").ok).toBe(false);
  });
});

describe("M2 学习", () => {
  it("小学 6 小时结课:奖学金 20 + 属性 +5,发文凭", () => {
    const e = fresh();
    e.state.growth = 28; // 6级
    const r = e.startCourse("p_liyi");
    expect(r.ok).toBe(true);
    const y0 = e.state.yuanbao;
    const events = e.tick(360, NOW);
    expect(e.state.completedCourses).toContain("p_liyi");
    expect(e.state.stats.mei).toBe(5);
    expect(e.state.yuanbao).toBe(y0 + 20);
    expect(events.some((x) => x.includes("毕业"))).toBe(true);
  });

  it("中学课程要求先修完同系小学全部三门", () => {
    const e = fresh();
    e.state.growth = 174; // 12级
    expect(e.courseAvailable("m_yuwen").ok).toBe(false);
    e.state.completedCourses = ["p_zhengzhi", "p_shuxue", "p_yuwen"];
    expect(e.courseAvailable("m_yuwen").ok).toBe(true);
  });

  it("中途放学保留进度", () => {
    const e = fresh();
    e.state.growth = 28;
    e.startCourse("p_wushu");
    e.tick(100, NOW);
    e.stopSchool();
    expect(e.state.currentCourse?.minutesDone).toBe(100);
    e.startCourse("p_wushu");
    e.tick(260, NOW);
    expect(e.state.completedCourses).toContain("p_wushu");
  });
});

describe("M4 结婚生蛋", () => {
  function married(rng: () => number = () => 0) {
    const e = fresh(rng);
    e.state.growth = 325; // 15级
    e.state.freeRingClaimed = false;
    e.state.growth = 390; // 16级,12级以上可领戒指
    e.claimFreeRing();
    e.propose("npc_lili", "gold_ring");
    return e;
  }

  it("15 级 + 戒指才能求婚;同性拒绝", () => {
    const e = fresh(() => 0);
    e.state.growth = 390;
    e.claimFreeRing();
    expect(e.propose("npc_taotao", "gold_ring").ok).toBe(false); // QGG×QGG
    const r = e.propose("npc_lili", "gold_ring");
    expect(r.ok).toBe(true);
    expect(e.state.marriage?.spouseId).toBe("npc_lili");
    expect(e.state.inventory.gold_ring).toBe(0);
  });

  it("婚后 200 小时生蛋,一生限 10 只;爱情值=戒指+婚后成长×10", () => {
    const e = married();
    expect(e.layEgg().ok).toBe(false);
    e.state.marriage!.minutesSinceLastEgg = 12000;
    expect(e.layEgg().ok).toBe(true);
    expect(e.state.inventory.egg).toBe(1);
    e.state.marriage!.eggsBorn = 10;
    e.state.marriage!.minutesSinceLastEgg = 12000;
    expect(e.layEgg().ok).toBe(false);
    e.state.growth += 50;
    expect(e.loveValue()).toBe(100 + 500);
  });

  it("孵化信息带成长加成与父母;离婚魅力 -5%", () => {
    const e = married();
    e.state.marriage!.minutesSinceLastEgg = 12000;
    e.layEgg();
    e.state.growth += 100; // 爱情 100+1000=1100 → bonus 27
    const h = e.hatchInfo();
    expect(h.ok).toBe(true);
    expect(h.bonusGrowth).toBe(Math.min(Math.round(1100 / 40), 50));
    expect(h.parents?.mother).toBe("莉莉");
    e.state.stats.mei = 100;
    e.divorce();
    expect(e.state.marriage).toBeNull();
    expect(e.state.stats.mei).toBe(95);
  });
});

describe("M5 旅游与福利", () => {
  it("5 级才能旅游;扣路费;到点回家心情加成", () => {
    const e = fresh();
    expect(e.startTravel("visit").ok).toBe(false);
    e.state.growth = 18; // 5级
    const y0 = e.state.yuanbao;
    expect(e.startTravel("visit").ok).toBe(true);
    expect(e.state.yuanbao).toBe(y0 - 20);
    e.state.mood = 500;
    const events = e.tick(30, NOW);
    expect(e.state.activity.type).toBe("none");
    expect(events.some((x) => x.includes("旅游回来"))).toBe(true);
    expect(e.state.mood).toBeGreaterThan(500);
  });

  it("神秘之旅梦想奖励递增(rng=0 必中)", () => {
    const e = fresh(() => 0);
    e.state.growth = 18;
    e.state.yuanbao = 1000;
    e.startTravel("mystery");
    const events = e.tick(120, NOW);
    expect(events.some((x) => x.includes("梦想奖励") && x.includes("380"))).toBe(true);
    expect(e.state.dreamRewardCount).toBe(1);
  });

  it("签到/捕鼠夹/许愿树每日限一次,许愿树仅周末", () => {
    const e = fresh(() => 0.5);
    expect(e.signin().ok).toBe(true);
    expect(e.signin().ok).toBe(false);
    e.state.growth = 28; // 6级
    expect(e.mousetrap(NOW).ok).toBe(true);
    expect(e.mousetrap(NOW).ok).toBe(false);
    expect(e.wishTree(NOW).ok).toBe(false); // 周一
    expect(e.wishTree(WEEKEND).ok).toBe(true);
  });

  it("跨天自动重置每日状态", () => {
    const e = fresh();
    e.signin();
    expect(e.state.daily.signedIn).toBe(true);
    e.tick(1, NOW + 24 * 60 * 60 * 1000);
    expect(e.state.daily.signedIn).toBe(false);
  });
});

describe("M6 小游戏结算", () => {
  it("古堡战记每日 3 次;全 Boss 通关 = 15+100+120+150", () => {
    const e = fresh();
    for (let i = 0; i < 3; i++) expect(e.castleStart(NOW).ok).toBe(true);
    expect(e.castleStart(NOW).ok).toBe(false);
    const y0 = e.state.yuanbao;
    e.castleFinish(3);
    expect(e.state.yuanbao).toBe(y0 + 385);
  });

  it("密室逃脱成功发道具进背包", () => {
    const e = fresh();
    expect(e.mazeStart().ok).toBe(true);
    e.mazeFinish(true);
    expect(e.state.inventory.towel).toBe(1);
    expect(e.state.inventory.melon_jelly).toBe(1);
  });
});

describe("M7 装扮与粉钻", () => {
  it("买装扮加魅力,穿戴校验槽位", () => {
    const e = fresh();
    e.state.yuanbao = 500;
    expect(e.buyOutfit("hat_top", NOW).ok).toBe(true);
    expect(e.state.stats.mei).toBe(5);
    expect(e.equipOutfit("hat_top", "scene").ok).toBe(false);
    expect(e.equipOutfit("hat_top", "hat").ok).toBe(true);
    expect(e.state.outfit.hat).toBe("hat_top");
  });

  it("粉钻:购物 8 折、免病、每日免费用餐", () => {
    const e = fresh(() => 0);
    e.state.yuanbao = 1100;
    expect(e.buyPink(NOW).ok).toBe(true);
    expect(e.isPink(NOW)).toBe(true);
    // 免费用餐一次
    e.state.hunger = 100;
    const y0 = e.state.yuanbao;
    expect(e.feed("biscuit", NOW).ok).toBe(true);
    expect(e.state.yuanbao).toBe(y0);
    // 第二次 8 折
    e.state.hunger = 100;
    e.feed("biscuit", NOW);
    expect(e.state.yuanbao).toBe(y0 - 16);
    // 免病
    e.state.hunger = 0;
    e.state.clean = 0;
    e.tick(1, NOW);
    expect(e.state.sickness).toBeNull();
  });

  it("改名默认免费,可反复改", () => {
    const e = fresh();
    const y0 = e.state.yuanbao;
    expect(e.rename("小企鹅").ok).toBe(true);
    expect(e.state.name).toBe("小企鹅");
    expect(e.rename("大企鹅").ok).toBe(true);
    expect(e.state.name).toBe("大企鹅");
    expect(e.state.yuanbao).toBe(y0);           // 一分钱不花
  });

  it("名字长度校验 1~8 字,空名字拒绝", () => {
    const e = fresh();
    expect(e.rename("   ").ok).toBe(false);
    expect(e.rename("一二三四五六七八九").ok).toBe(false);
    expect(e.state.name).toBe("测试");
  });

  it("renameCardPrice > 0 时仍会扣钱(配置保留)", () => {
    const paid = new PetEngine(
      { ...config, renameCardPrice: 100 },
      PetEngine.newPet(config, "测试", "QGG", NOW),
    );
    const y0 = paid.state.yuanbao;
    expect(paid.rename("阿花").ok).toBe(true);
    expect(paid.state.yuanbao).toBe(y0 - 100);
  });
});
