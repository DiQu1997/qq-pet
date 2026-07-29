/**
 * 局域网邻居发现与点对点通信。零新依赖:只用 Node 内置的 dgram / http。
 *
 * 发现:UDP 组播。每 BEACON_MS 往组播地址发一个很小的"名片"包,
 *       同网段的实例互相收到即认识。TTL=1 保证只在本网段内,不会外泄。
 * 通信:每个实例起一个 HTTP 服务监听随机端口,端口号写在名片包里告诉对方。
 *
 * 已知限制(见 README):
 *   - 部分公司/校园网络会拦截 UDP 组播,那种环境下发现不到邻居;
 *   - macOS 首次监听端口会弹防火墙授权框;
 *   - 状态是客户端权威的,双方都能改自己的存档 —— 这是给朋友之间玩的,不做反作弊。
 */
import dgram from "node:dgram";
import http from "node:http";
import { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";

const GROUP = "239.255.42.99";
const DISCOVERY_PORT = 41999;
const BEACON_MS = 5000;
/** 房间心跳更密:成员进出要快速反映到画面上 */
const ROOM_BEACON_MS = 1200;
const ROOM_TTL_MS = 4000;
/** 超过这个时间没再听到心跳,就认为对方下线了 */
export const PEER_TTL_MS = 16000;
const PROTOCOL = 1;

/** 名片:随心跳广播的最小信息,够渲染一张邻居卡片 */
export interface PeerCard {
  v: number;
  id: string;
  name: string;
  level: number;
  skinId: string;
  gender: "QGG" | "QMM";
  /** 对方 HTTP 服务端口 */
  port: number;
}

export interface Peer extends PeerCard {
  host: string;
  lastSeen: number;
}

/** 房间成员:进了共享房间(如健身房)的宠物,每 ROOM_BEACON_MS 广播一次 */
export interface RoomMember {
  id: string;
  room: string;
  name: string;
  level: number;
  skinId: string;
  gender: "QGG" | "QMM";
  outfit: { hat: string | null; scene: string | null };
  lastSeen: number;
}

export interface LanOptions {
  /** 本机稳定标识,换名字也不变 */
  selfId: string;
  /** 取当前自己的名片(每次心跳都重新取,保证等级/名字是新的) */
  getCard: () => Omit<PeerCard, "v" | "id" | "port">;
  /** 邻居列表变化时回调 */
  onPeersChanged: (peers: Peer[]) => void;
  /** 收到串门请求;返回是否接受与说明 */
  onVisitRequest?: (from: Peer, payload: any) => { ok: boolean; message: string };
  /** 客人提前告辞 */
  onVisitEnd?: (peerId: string) => void;
  /** 取自己在房间里的展示信息(名字/等级/皮肤/装扮) */
  getRoomCard?: () => Omit<RoomMember, "id" | "room" | "lastSeen">;
  /** 房间人员变化 */
  onRoomChanged?: (room: string, members: RoomMember[]) => void;
  log: (msg: string) => void;
}

/** 挑一块真正连着局域网的网卡。多网卡(VPN/utun/虚拟机)时不指定会走错口 → EHOSTUNREACH */
function primaryIPv4(): string | null {
  const ifs = networkInterfaces();
  // 优先常见的物理网卡名,其次任意非内部 IPv4
  const prefer = ["en0", "en1", "eth0", "wlan0"];
  for (const name of [...prefer, ...Object.keys(ifs)]) {
    for (const a of ifs[name] ?? []) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return null;
}

export interface LanDiag {
  running: boolean;
  selfId: string;
  httpPort: number;
  localIp: string | null;
  beaconsSent: number;
  lastBeaconError: string | null;
  peerCount: number;
}

export class LanNode {
  private sock: dgram.Socket | null = null;
  private server: http.Server | null = null;
  private beacon: NodeJS.Timeout | null = null;
  private sweeper: NodeJS.Timeout | null = null;
  private peers = new Map<string, Peer>();
  private httpPort = 0;
  private started = false;
  private localIp: string | null = null;
  private beaconsSent = 0;
  private lastBeaconError: string | null = null;
  /** 当前所在共享房间(null = 不在任何房间) */
  private room: string | null = null;
  private roomBeacon: NodeJS.Timeout | null = null;
  private roomMembers = new Map<string, RoomMember>();

  constructor(private opts: LanOptions) {}

  get isRunning(): boolean {
    return this.started;
  }
  get port(): number {
    return this.httpPort;
  }
  list(): Peer[] {
    const now = Date.now();
    return [...this.peers.values()]
      .filter((p) => now - p.lastSeen < PEER_TTL_MS)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  find(id: string): Peer | undefined {
    return this.list().find((p) => p.id === id);
  }

  // ---------- 共享房间 ----------
  /**
   * 进入共享房间。房间是**全分布式**的:没有房主,每个成员每秒广播一次
   * "我在哪个房间 + 我长什么样",所有人各自维护同一份名单。
   * 任何人退出都不影响别人,也不需要选主。
   */
  joinRoom(room: string): void {
    if (this.room === room) return;
    this.room = room;
    this.roomMembers.clear();
    this.sendRoomBeacon();
    if (this.roomBeacon) clearInterval(this.roomBeacon);
    this.roomBeacon = setInterval(() => this.sendRoomBeacon(), ROOM_BEACON_MS);
    this.opts.log(`进入房间:${room}`);
    this.opts.onRoomChanged?.(room, this.roster());
  }

  leaveRoom(): void {
    if (!this.room) return;
    const was = this.room;
    this.room = null;
    if (this.roomBeacon) clearInterval(this.roomBeacon), (this.roomBeacon = null);
    this.roomMembers.clear();
    this.opts.log(`离开房间:${was}`);
    this.opts.onRoomChanged?.(was, []);
  }

  get currentRoom(): string | null {
    return this.room;
  }

  /**
   * 房间名单(含自己),按 id 排序。
   * 排序是关键:每台机器都用同一份有序名单算工位,布局天然一致,不用协商。
   */
  roster(): RoomMember[] {
    if (!this.room) return [];
    const now = Date.now();
    const self: RoomMember | null = this.opts.getRoomCard
      ? { id: this.opts.selfId, room: this.room, lastSeen: now, ...this.opts.getRoomCard() }
      : null;
    const others = [...this.roomMembers.values()].filter(
      (m) => m.room === this.room && now - m.lastSeen < ROOM_TTL_MS,
    );
    return [...(self ? [self] : []), ...others].sort((a, b) => a.id.localeCompare(b.id));
  }

  private sendRoomBeacon(): void {
    if (!this.sock || !this.room || !this.opts.getRoomCard) return;
    const msg = {
      v: PROTOCOL,
      k: "room",
      id: this.opts.selfId,
      room: this.room,
      ...this.opts.getRoomCard(),
    };
    const buf = Buffer.from(JSON.stringify(msg));
    this.sock.send(buf, 0, buf.length, DISCOVERY_PORT, GROUP, () => {
      /* 房间心跳失败不单独报错,名片心跳已经在报了 */
    });
    // 顺手清理过期成员
    const now = Date.now();
    let changed = false;
    for (const [id, m] of this.roomMembers) {
      if (now - m.lastSeen >= ROOM_TTL_MS) {
        this.roomMembers.delete(id);
        changed = true;
        this.opts.log(`房间成员离开:${m.name}`);
      }
    }
    if (changed) this.opts.onRoomChanged?.(this.room, this.roster());
  }

  /** 诊断信息,给界面显示,方便自查"为什么看不到邻居" */
  diag(): LanDiag {
    return {
      running: this.started,
      selfId: this.opts.selfId,
      httpPort: this.httpPort,
      localIp: this.localIp,
      beaconsSent: this.beaconsSent,
      lastBeaconError: this.lastBeaconError,
      peerCount: this.list().length,
    };
  }

  async start(): Promise<void> {
    if (this.started) return;
    try {
      await this.startHttp();
      this.startDiscovery();
      this.started = true;
      this.opts.log(`LAN 已启动,HTTP 端口 ${this.httpPort}`);
    } catch (e) {
      this.opts.log(`LAN 启动失败: ${e}`);
      await this.stop();
      throw e;
    }
  }

  async stop(): Promise<void> {
    if (this.beacon) clearInterval(this.beacon), (this.beacon = null);
    if (this.sweeper) clearInterval(this.sweeper), (this.sweeper = null);
    if (this.roomBeacon) clearInterval(this.roomBeacon), (this.roomBeacon = null);
    this.room = null;
    this.roomMembers.clear();
    try {
      this.sock?.close();
    } catch {
      /* 已关闭 */
    }
    this.sock = null;
    await new Promise<void>((res) => {
      if (!this.server) return res();
      this.server.close(() => res());
      this.server = null;
    });
    this.peers.clear();
    this.started = false;
    this.opts.onPeersChanged([]);
    this.opts.log("LAN 已停止");
  }

  // ---------- HTTP ----------
  private startHttp(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handle(req, res));
      this.server.on("error", reject);
      // 端口 0 = 让系统分配空闲端口,避免和别的程序抢
      this.server.listen(0, () => {
        this.httpPort = (this.server!.address() as AddressInfo).port;
        resolve();
      });
    });
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const send = (code: number, body: unknown) => {
      const json = JSON.stringify(body);
      res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
      res.end(json);
    };
    const url = (req.url ?? "/").split("?")[0];

    if (req.method === "GET" && url === "/card") {
      return send(200, { v: PROTOCOL, id: this.opts.selfId, ...this.opts.getCard() });
    }

    if (req.method === "POST" && url === "/visit") {
      let raw = "";
      req.on("data", (c) => {
        raw += c;
        if (raw.length > 64 * 1024) req.destroy(); // 防止超大请求
      });
      req.on("end", () => {
        let payload: any = {};
        try {
          payload = JSON.parse(raw || "{}");
        } catch {
          return send(400, { ok: false, message: "请求格式不对" });
        }
        const from = this.peers.get(payload?.from?.id);
        if (!from) return send(403, { ok: false, message: "不认识你,先让双方互相发现" });
        const r = this.opts.onVisitRequest?.(from, payload) ?? {
          ok: false,
          message: "对方没有开启串门",
        };
        send(r.ok ? 200 : 409, r);
      });
      return;
    }

    if (req.method === "POST" && url === "/visit/end") {
      let raw = "";
      req.on("data", (c) => {
        raw += c;
        if (raw.length > 8 * 1024) req.destroy();
      });
      req.on("end", () => {
        let payload: any = {};
        try {
          payload = JSON.parse(raw || "{}");
        } catch {
          return send(400, { ok: false, message: "请求格式不对" });
        }
        this.opts.onVisitEnd?.(payload?.id);
        send(200, { ok: true, message: "收到" });
      });
      return;
    }

    send(404, { ok: false, message: "没有这个接口" });
  }

  // ---------- 组播发现 ----------
  private startDiscovery(): void {
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    this.sock = sock;

    sock.on("error", (e) => this.opts.log(`LAN 组播出错: ${e.message}`));

    sock.on("message", (buf, rinfo) => {
      let card: PeerCard;
      try {
        card = JSON.parse(buf.toString());
      } catch {
        return;
      }
      if (card?.v !== PROTOCOL || !card.id) return;
      if (card.id === this.opts.selfId) return; // 自己的心跳(开了 loopback 会收到)

      // 房间心跳走另一条路径:只在自己也在同一个房间时才关心
      if ((card as any).k === "room") {
        const m = card as unknown as RoomMember;
        if (!this.room || m.room !== this.room) return;
        const isNew = !this.roomMembers.has(m.id);
        this.roomMembers.set(m.id, { ...m, lastSeen: Date.now() });
        if (isNew) {
          this.opts.log(`房间来人:${m.name}(${m.room})`);
          this.opts.onRoomChanged?.(this.room, this.roster());
        }
        return;
      }
      const before = this.peers.has(card.id);
      this.peers.set(card.id, { ...card, host: rinfo.address, lastSeen: Date.now() });
      if (!before) {
        this.opts.log(`发现邻居:${card.name}(${rinfo.address}:${card.port})`);
        this.opts.onPeersChanged(this.list());
      }
    });

    sock.bind(DISCOVERY_PORT, () => {
      try {
        this.localIp = primaryIPv4();
        if (this.localIp) {
          // 显式指定出口网卡:装了 VPN/虚拟机的机器上,不指定会挑到 utun 之类
          // 的口,发不出去(EHOSTUNREACH),表现为"对方看不到我"
          sock.setMulticastInterface(this.localIp);
          sock.addMembership(GROUP, this.localIp);
        } else {
          sock.addMembership(GROUP);
        }
        sock.setMulticastTTL(1); // 只在本网段,不跨路由
        sock.setMulticastLoopback(true); // 同一台机器上的两个实例也能互相看见
        this.opts.log(`组播出口网卡: ${this.localIp ?? "(系统默认)"}`);
      } catch (e) {
        this.opts.log(`加入组播组失败(网络可能禁用了组播): ${e}`);
      }
      this.sendBeacon();
      this.beacon = setInterval(() => this.sendBeacon(), BEACON_MS);
    });

    // 定期清理过期邻居
    this.sweeper = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, p] of this.peers) {
        if (now - p.lastSeen >= PEER_TTL_MS) {
          this.peers.delete(id);
          changed = true;
          this.opts.log(`邻居下线:${p.name}`);
        }
      }
      if (changed) this.opts.onPeersChanged(this.list());
    }, BEACON_MS);
  }

  private sendBeacon(): void {
    if (!this.sock) return;
    const card: PeerCard = {
      v: PROTOCOL,
      id: this.opts.selfId,
      port: this.httpPort,
      ...this.opts.getCard(),
    };
    const buf = Buffer.from(JSON.stringify(card));
    this.sock.send(buf, 0, buf.length, DISCOVERY_PORT, GROUP, (err) => {
      if (err) {
        // 只在错误变化时记日志,否则每 5 秒刷屏
        if (this.lastBeaconError !== err.message) {
          this.opts.log(`心跳发送失败: ${err.message}`);
        }
        this.lastBeaconError = err.message;
      } else {
        this.beaconsSent++;
        if (this.lastBeaconError) {
          this.opts.log("心跳恢复正常");
          this.lastBeaconError = null;
        }
      }
    });
  }

  // ---------- 主动请求对方 ----------
  /** 拉取对方完整名片。对方不在线时抛错,由调用方转成「对方不在家」 */
  fetchCard(peer: Peer, timeoutMs = 3000): Promise<any> {
    return this.request(peer, "GET", "/card", undefined, timeoutMs);
  }

  requestVisit(peer: Peer, payload: unknown, timeoutMs = 4000): Promise<any> {
    return this.request(peer, "POST", "/visit", payload, timeoutMs);
  }

  /** 告诉主人家「我回去了」,让对方及时收起客人窗口(尽力而为,失败也不影响自己) */
  requestVisitEnd(peer: Peer, payload: unknown, timeoutMs = 2000): Promise<any> {
    return this.request(peer, "POST", "/visit/end", payload, timeoutMs);
  }

  endVisit(peer: Peer, selfId: string): Promise<any> {
    return this.request(peer, "POST", "/visit/end", { id: selfId }, 2000);
  }

  private request(
    peer: Peer,
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = 3000,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      const req = http.request(
        {
          host: peer.host,
          port: peer.port,
          path,
          method,
          timeout: timeoutMs,
          headers: data
            ? { "Content-Type": "application/json", "Content-Length": data.length }
            : undefined,
        },
        (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () => {
            try {
              resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw || "{}") });
            } catch {
              reject(new Error("对方返回的内容看不懂"));
            }
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error("超时")));
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  }
}
