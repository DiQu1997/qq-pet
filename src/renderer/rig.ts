/**
 * 骨骼动画引擎(2D cutout / bone hierarchy)
 *
 * 核心是父子层级:body 是父骨骼,head/armL/armR/footL/footR 是子骨骼。
 * 父骨骼做非等比缩放时,子骨骼必须跟着位移到自己枢轴的新位置,否则会散架
 * (v1 原型就是因为没有这层补偿,压扁时头和身体脱节)。
 * 所有缩放体积守恒(scaleX = 1/scaleY),幅度控制在 10% 以内。
 */

export interface RigSpec {
  file: string;
  width: number;
  height: number;
  headFollow: number;
  pivots: Record<string, [number, number]>;
  children: string[];
}

/** 单个部件在某一帧的局部变换 */
interface Local {
  rot?: number;
  tx?: number;
  ty?: number;
}
/** 父骨骼(body)的变换,sy 驱动体积守恒缩放 */
interface Body extends Local {
  sy?: number;
}
type Pose = { body?: Body } & Record<string, Local | Body | undefined>;

const sin = (t: number, period: number, phase = 0) =>
  Math.sin((t / period + phase) * Math.PI * 2);
const cl01 = (v: number) => Math.max(0, Math.min(1, v));

/** 各状态:时间(秒) → 姿态。幅度上限见文件头说明 */
export const RIG_STATES: Record<string, (t: number) => Pose> = {
  idle: (t) => ({
    body: { sy: 1 + 0.025 * sin(t, 2.8) },
    head: { ty: -1.5 * sin(t, 2.8), rot: 1.2 * sin(t, 5.6) },
    armL: { rot: 2.2 * sin(t, 2.8, 0.15) },
    armR: { rot: -2.2 * sin(t, 2.8, 0.15) },
  }),

  walk: (t) => {
    const p = 0.62;
    const b = Math.abs(sin(t, p / 2));
    return {
      body: { sy: 1 + 0.012 * sin(t, p / 2), ty: -4 * b },
      head: { ty: -1.5 * b, rot: 2.5 * sin(t, p) },
      armL: { rot: 9 * sin(t, p) },
      armR: { rot: 9 * sin(t, p, 0.5) },
      footL: { rot: 11 * sin(t, p), ty: -5 * cl01(sin(t, p)) },
      footR: { rot: 11 * sin(t, p, 0.5), ty: -5 * cl01(sin(t, p, 0.5)) },
    };
  },

  sleep: (t) => ({
    body: { sy: 1 + 0.045 * sin(t, 4.2), ty: 5 },
    head: { ty: 2 - 2 * sin(t, 4.2), rot: -7 },
    armL: { rot: 6 },
    armR: { rot: -6 },
  }),

  happy: (t) => {
    const p = 0.9;
    const ph = (t % p) / p;
    const up = Math.sin(ph * Math.PI);
    const land = ph > 0.86 ? (ph - 0.86) / 0.14 : 0;
    return {
      body: { sy: 1 - 0.1 * Math.sin(land * Math.PI), ty: -26 * up },
      head: { ty: -4 * up, rot: 5 * sin(t, p / 2) },
      armL: { rot: -30 * up - 4, ty: -3 * up },
      armR: { rot: 30 * up + 4, ty: -3 * up },
      footL: { rot: -12 * up },
      footR: { rot: 12 * up },
    };
  },

  struggle: (t) => {
    const p = 0.45;
    return {
      body: { rot: 6 * sin(t, p) },
      head: { rot: 4 * sin(t, p, 0.1) },
      armL: { rot: -26 * sin(t, p * 0.7) - 8 },
      armR: { rot: 26 * sin(t, p * 0.7, 0.3) + 8 },
      footL: { rot: -18 * sin(t, p * 0.6) },
      footR: { rot: 18 * sin(t, p * 0.6, 0.4) },
    };
  },

  /** 落地翻滚:一次性,0.9 秒转一圈后压一下 */
  tumble: (t) => {
    const d = 0.9;
    const ph = cl01(t / d);
    const land = ph > 0.8 ? (ph - 0.8) / 0.2 : 0;
    return {
      body: { rot: 360 * ph, sy: 1 - 0.12 * Math.sin(land * Math.PI) },
      armL: { rot: -20 * (1 - ph) },
      armR: { rot: 20 * (1 - ph) },
    };
  },

  eat: (t) => {
    const p = 0.55;
    const ch = Math.abs(sin(t, p));
    return {
      body: { sy: 1 - 0.03 * ch },
      head: { ty: 2 * ch, rot: 3 * sin(t, p) },
      armL: { rot: -14 - 6 * ch },
      armR: { rot: 14 + 6 * ch },
    };
  },

  sick: (t) => {
    const sh = 0.8 * sin(t, 0.14);
    return {
      body: { sy: 1 + 0.012 * sin(t, 3.6), ty: 4, tx: sh },
      head: { ty: 2, rot: 4 + 1.5 * sin(t, 3.6) },
      armL: { rot: 9 },
      armR: { rot: -9 },
    };
  },

  /** 上学:低头看书,偶尔点头 */
  study: (t) => ({
    body: { sy: 1 + 0.015 * sin(t, 3.2) },
    head: { ty: 4 + 2 * Math.abs(sin(t, 2.1)), rot: 2 * sin(t, 4.2) },
    armL: { rot: -18 },
    armR: { rot: 18 },
  }),
};

/** 主进程发来的动画名 → 骨骼状态 */
export const ANIM_TO_RIG: Record<string, string> = {
  idle: "idle",
  walkLeft: "walk",
  walkRight: "walk",
  sing: "happy",
  dance: "happy",
  struggle: "struggle",
  tumble: "tumble",
  tumble_hold: "sick",
  sleep: "sleep",
  mail: "study",
  eat: "eat",
  dead: "idle",
};

export class RigRenderer {
  private el: Record<string, SVGGElement> = {};
  private svg!: SVGSVGElement;
  private state = "idle";
  private stateStart = 0;
  private flip = false;

  constructor(
    private spec: RigSpec,
    private scale: number,
  ) {}

  async mount(container: HTMLElement, svgText: string): Promise<void> {
    container.innerHTML = svgText;
    this.svg = container.querySelector("svg")!;
    this.svg.setAttribute("width", String(this.spec.width * this.scale));
    this.svg.setAttribute("height", String(this.spec.height * this.scale));
    this.svg.style.overflow = "visible";
    for (const k of Object.keys(this.spec.pivots)) {
      const g = container.querySelector<SVGGElement>(`#${k}`);
      if (!g) continue;
      g.style.transformBox = "view-box";
      g.style.transformOrigin = `${this.spec.pivots[k][0]}px ${this.spec.pivots[k][1]}px`;
      this.el[k] = g;
    }
  }

  get size() {
    return { w: this.spec.width * this.scale, h: this.spec.height * this.scale };
  }

  setAnim(name: string, nowMs: number): void {
    const rig = ANIM_TO_RIG[name] ?? "idle";
    this.flip = name === "walkLeft";
    if (rig === this.state) return;
    this.state = rig;
    this.stateStart = nowMs;
  }

  /** 每帧调用 */
  draw(nowMs: number): void {
    const t = (nowMs - this.stateStart) / 1000;
    const pose = (RIG_STATES[this.state] ?? RIG_STATES.idle)(t);
    const bodyPiv = this.spec.pivots.body;
    const b: Required<Body> = { sy: 1, tx: 0, ty: 0, rot: 0, ...(pose.body ?? {}) };
    const bsy = b.sy;
    const bsx = 1 / bsy; // 体积守恒

    if (this.el.body) {
      this.el.body.style.transform =
        `translate(${b.tx}px,${b.ty}px) rotate(${b.rot}deg) scaleX(${bsx}) scaleY(${bsy})`;
    }

    const rad = (b.rot * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sn = Math.sin(rad);

    for (const k of this.spec.children) {
      const g = this.el[k];
      if (!g) continue;
      const c: Required<Local> = { rot: 0, tx: 0, ty: 0, ...((pose[k] as Local) ?? {}) };
      const ox = this.spec.pivots[k][0] - bodyPiv[0];
      const oy = this.spec.pivots[k][1] - bodyPiv[1];
      // ★ 父骨骼形变在本部件枢轴处产生的位移 —— 层级的关键
      let dx = ox * (bsx - 1);
      let dy = oy * (bsy - 1);
      if (b.rot) {
        dx += ox * cos - oy * sn - ox;
        dy += ox * sn + oy * cos - oy;
      }
      const s = k === "head" ? 1 + (bsy - 1) * this.spec.headFollow : 1;
      g.style.transform =
        `translate(${(b.tx + dx + c.tx).toFixed(2)}px,${(b.ty + dy + c.ty).toFixed(2)}px) ` +
        `rotate(${(b.rot + c.rot).toFixed(2)}deg)` +
        (s !== 1 ? ` scale(${s.toFixed(4)})` : "");
    }

    this.svg.style.transform = this.flip ? "scaleX(-1)" : "";
  }
}
