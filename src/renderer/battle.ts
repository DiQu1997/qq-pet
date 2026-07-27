const $b = (id: string) => document.getElementById(id)!;

const BOSS_EMOJI = ["👹", "🧟", "🐺"];

let cfg: any = null;
let bosses: any[] = [];
let bossIdx = 0;
let bossHp = 0;
let meHp = 0;
let meMaxHp = 0;
let myAtk = 0;
let defeated = 0;
let over = false;

function log(text: string) {
  const el = $b("log");
  el.innerHTML += `<div>${text}</div>`;
  el.scrollTop = el.scrollHeight;
}

function refresh() {
  ($b("meHp") as HTMLElement).style.width = `${Math.max(0, (meHp / meMaxHp) * 100)}%`;
  const boss = bosses[bossIdx];
  ($b("bossHp") as HTMLElement).style.width = boss ? `${Math.max(0, (bossHp / boss.hp) * 100)}%` : "0%";
  $b("bossName").textContent = boss ? `${boss.name}(${Math.max(0, Math.ceil(bossHp))}/${boss.hp})` : "";
  $b("bossSprite").childNodes.forEach(() => {});
  const sprite = $b("bossSprite");
  if (boss) sprite.textContent = BOSS_EMOJI[bossIdx] ?? "👹";
}

function flash(id: string) {
  const el = $b(id);
  el.classList.add("hit");
  setTimeout(() => el.classList.remove("hit"), 180);
}

async function finish(msg: string) {
  if (over) return;
  over = true;
  ($b("atk") as HTMLButtonElement).disabled = true;
  ($b("heavy") as HTMLButtonElement).disabled = true;
  ($b("flee") as HTMLButtonElement).disabled = true;
  const res = await window.qqpet.action("castle.finish", String(defeated));
  log(`<b>${msg}</b>`);
  log(`<b>${res.message}</b>`);
  log("3 秒后自动关闭……");
  setTimeout(() => window.qqpet.closeWindow(), 3200);
}

function bossTurn() {
  if (over) return;
  const boss = bosses[bossIdx];
  if (!boss) return;
  const dmg = Math.round(boss.atk * (0.7 + Math.random() * 0.6));
  meHp -= dmg;
  flash("meSprite");
  log(`${boss.name}反击,你受到 ${dmg} 点伤害`);
  refresh();
  if (meHp <= 0) finish("你被打倒了……冒险结束");
}

function attack(heavy: boolean) {
  if (over) return;
  const boss = bosses[bossIdx];
  if (!boss) return;
  if (heavy && Math.random() < 0.35) {
    log("奋力一击挥空了!");
  } else {
    const mult = heavy ? 1.9 : 1;
    const dmg = Math.round(myAtk * mult * (0.8 + Math.random() * 0.4));
    bossHp -= dmg;
    flash("bossSprite");
    log(`你${heavy ? "奋力一击" : "攻击"}${boss.name},造成 ${dmg} 点伤害`);
  }
  refresh();
  if (bossHp <= 0) {
    defeated++;
    log(`<b>击败了${boss.name}!</b>`);
    bossIdx++;
    if (bossIdx >= bosses.length) {
      finish("三大 Boss 全部击败,古堡恢复了和平!");
      return;
    }
    bossHp = bosses[bossIdx].hp;
    meHp = Math.min(meMaxHp, meHp + 25);
    log(`喝了口药水(HP+25),下一个对手:${bosses[bossIdx].name}`);
    refresh();
    return;
  }
  setTimeout(bossTurn, 450);
}

(async () => {
  cfg = await window.qqpet.requestConfig();
  const snap = await window.qqpet.requestSnapshot();
  const img = document.getElementById("penguin-img") as HTMLImageElement;
  img.src = "assets/spritesheet.png";
  img.style.objectFit = "none";
  img.style.objectPosition = "0 0";
  img.style.width = "192px";
  img.style.height = "208px";
  img.style.transform = "scale(0.45)";
  img.style.transformOrigin = "top left";
  (img.parentElement as HTMLElement).style.height = "96px";
  (img.parentElement as HTMLElement).style.overflow = "hidden";

  const start = await window.qqpet.action("castle.start");
  if (!start.ok) {
    log(`<b>${start.message}</b>`);
    ($b("atk") as HTMLButtonElement).disabled = true;
    ($b("heavy") as HTMLButtonElement).disabled = true;
    $b("flee").textContent = "关闭";
    $b("flee").onclick = () => window.qqpet.closeWindow();
    over = true;
    return;
  }

  bosses = cfg.games.castle.bosses;
  const wu = snap.state.stats.wu ?? 0;
  meMaxHp = 100 + wu * 2;
  meHp = meMaxHp;
  myAtk = 12 + Math.round(wu / 2);
  bossHp = bosses[0].hp;
  $b("meName").textContent = `${snap.state.name}(武力${wu})`;
  log(`古堡的大门缓缓打开……第一个对手:${bosses[0].name}!`);
  log(`你的 HP ${meMaxHp},攻击力 ${myAtk}(武力值加成)`);
  refresh();

  $b("atk").onclick = () => attack(false);
  $b("heavy").onclick = () => attack(true);
  $b("flee").onclick = () => finish("你带着战利品撤出了古堡");
})();

$b("close").onclick = () => window.qqpet.closeWindow();

export {};
