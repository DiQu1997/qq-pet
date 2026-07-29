/**
 * 可实例化的宠物精灵。
 *
 * 桌宠的 renderer.ts 是单宠物写死的(canvas / rig / 尺寸都是模块级变量),
 * 一个文档只能画一只。要在健身房里同屏画 N 只、而且每只用**自己的皮肤**,
 * 就需要这层抽象:每个实例自带 DOM 子树与素材,外部统一驱动 draw()。
 *
 * 两种后端与桌宠一致:
 *   sheet — 精灵图逐帧(每实例一个 canvas)
 *   rig   — SVG 骨骼动画(每实例一个 RigRenderer)
 */
import { RigRenderer, type RigSpec } from "./rig";

export interface SpriteSkin {
  id: string;
  displayName: string;
  renderer: "sheet" | "rig";
  scale: number;
  nameplateOffset?: number;
  sheet?: {
    file: string;
    frameWidth: number;
    frameHeight: number;
    animations: Record<string, { row: number; frames: number; fps: number; loop: boolean }>;
  };
  rig?: RigSpec;
}

export interface PetInfo {
  name: string;
  level: number;
  outfit?: { hat: string | null; scene: string | null };
}

/** 精灵图按 URL 缓存,同皮肤的多只宠物共用一张图 */
const sheetCache = new Map<string, HTMLImageElement>();
function loadSheet(url: string): HTMLImageElement {
  let img = sheetCache.get(url);
  if (!img) {
    img = new Image();
    img.src = url;
    sheetCache.set(url, img);
  }
  return img;
}

export class PetSprite {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private img: HTMLImageElement | null = null;
  private rig: RigRenderer | null = null;
  private nameEl: HTMLDivElement;
  private hatEl: HTMLDivElement;

  private w = 0;
  private h = 0;
  private anim = "idle";
  private frame = 0;
  private lastFrameAt = 0;
  private outfits: any[];

  constructor(
    private skin: SpriteSkin,
    opts: { scale?: number; outfits?: any[] } = {},
  ) {
    this.outfits = opts.outfits ?? [];
    const scale = opts.scale ?? skin.scale ?? 1;

    this.el = document.createElement("div");
    this.el.className = "pet-sprite";
    this.el.style.position = "relative";
    this.el.style.display = "flex";
    this.el.style.flexDirection = "column";
    this.el.style.alignItems = "center";
    this.el.style.justifyContent = "flex-end";

    this.nameEl = document.createElement("div");
    this.nameEl.className = "ps-name";
    this.el.appendChild(this.nameEl);

    const stage = document.createElement("div");
    stage.style.position = "relative";
    stage.style.lineHeight = "0";
    this.el.appendChild(stage);

    this.hatEl = document.createElement("div");
    this.hatEl.className = "ps-hat";
    this.hatEl.style.position = "absolute";
    this.hatEl.style.left = "50%";
    this.hatEl.style.transform = "translateX(-50%)";
    this.hatEl.style.pointerEvents = "none";
    stage.appendChild(this.hatEl);

    if (skin.renderer === "sheet" && skin.sheet) {
      this.w = Math.round(skin.sheet.frameWidth * scale);
      this.h = Math.round(skin.sheet.frameHeight * scale);
      this.canvas = document.createElement("canvas");
      this.canvas.width = this.w;
      this.canvas.height = this.h;
      this.ctx = this.canvas.getContext("2d");
      stage.appendChild(this.canvas);
      this.img = loadSheet(`skins/${skin.id}/${skin.sheet.file}`);
    } else if (skin.renderer === "rig" && skin.rig) {
      this.w = Math.round(skin.rig.width * scale);
      this.h = Math.round(skin.rig.height * scale);
      const box = document.createElement("div");
      stage.appendChild(box);
      this.rig = new RigRenderer(skin.rig, scale);
      // SVG 内容异步载入,mount() 里完成
      (this.el as any).__rigBox = box;
    }
    this.hatEl.style.fontSize = `${Math.round(this.h * 0.22)}px`;
    this.hatEl.style.bottom = `${this.h + (skin.nameplateOffset ?? 0) * 0.5}px`;
  }

  /** 载入需要异步获取的素材(rig 的 SVG) */
  async mount(): Promise<void> {
    if (!this.rig || !this.skin.rig) return;
    const box = (this.el as any).__rigBox as HTMLDivElement;
    const svg = await fetch(`skins/${this.skin.id}/${this.skin.rig.file}`).then((r) => r.text());
    await this.rig.mount(box, svg);
  }

  get size() {
    return { w: this.w, h: this.h };
  }

  /**
   * 精灵图皮肤没有健身专用帧(企鹅只有官方那 9 组动画),
   * 退回到语义最接近的一组;骨骼皮肤则能真正做出动作。
   */
  private resolveSheetAnim(name: string): string {
    const s = this.skin.sheet;
    if (!s) return name;
    if (s.animations[name]) return name;
    const fallback: Record<string, string> = {
      gymRun: "walkRight",
      gymLift: "dance",
      gymJump: "dance",
      gymStretch: "idle",
    };
    return fallback[name] ?? "idle";
  }

  setAnim(name: string): void {
    if (name === this.anim) return;
    this.anim = name;
    this.frame = 0;
    this.lastFrameAt = 0;
    this.rig?.setAnim(name, performance.now());
  }

  setInfo(info: PetInfo): void {
    this.nameEl.textContent = `${info.name}  Lv.${info.level}`;
    const hat = this.outfits.find((o) => o.id === info.outfit?.hat);
    this.hatEl.textContent = hat?.emoji ?? "";
  }

  /** 由外部统一的 rAF 循环调用 */
  draw(t: number): void {
    if (this.rig) {
      this.rig.draw(t);
      return;
    }
    const s = this.skin.sheet;
    if (!s || !this.ctx || !this.img) return;
    const def = s.animations[this.resolveSheetAnim(this.anim)] ?? s.animations.idle;
    if (!def) return;
    if (!this.lastFrameAt) this.lastFrameAt = t;
    if (t - this.lastFrameAt >= 1000 / def.fps) {
      this.lastFrameAt = t;
      if (this.frame < def.frames - 1) this.frame++;
      else if (def.loop) this.frame = 0;
    }
    this.ctx.clearRect(0, 0, this.w, this.h);
    if (this.img.complete) {
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.drawImage(
        this.img,
        Math.min(this.frame, def.frames - 1) * s.frameWidth,
        def.row * s.frameHeight,
        s.frameWidth,
        s.frameHeight,
        0,
        0,
        this.w,
        this.h,
      );
    }
  }

  destroy(): void {
    this.el.remove();
  }
}
