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

const GROUP = "239.255.42.99";
const DISCOVERY_PORT = 41999;
const BEACON_MS = 5000;
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

export interface LanOptions {
  /** 本机稳定标识,换名字也不变 */
  selfId: string;
  /** 取当前自己的名片(每次心跳都重新取,保证等级/名字是新的) */
  getCard: () => Omit<PeerCard, "v" | "id" | "port">;
  /** 邻居列表变化时回调 */
  onPeersChanged: (peers: Peer[]) => void;
  /** 收到串门请求;返回是否接受与说明 */
  onVisitRequest?: (from: Peer, payload: any) => { ok: boolean; message: string };
  log: (msg: string) => void;
}

export class LanNode {
  private sock: dgram.Socket | null = null;
  private server: http.Server | null = null;
  private beacon: NodeJS.Timeout | null = null;
  private sweeper: NodeJS.Timeout | null = null;
  private peers = new Map<string, Peer>();
  private httpPort = 0;
  private started = false;

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
      const before = this.peers.has(card.id);
      this.peers.set(card.id, { ...card, host: rinfo.address, lastSeen: Date.now() });
      if (!before) {
        this.opts.log(`发现邻居:${card.name}(${rinfo.address}:${card.port})`);
        this.opts.onPeersChanged(this.list());
      }
    });

    sock.bind(DISCOVERY_PORT, () => {
      try {
        sock.addMembership(GROUP);
        sock.setMulticastTTL(1); // 只在本网段,不跨路由
        sock.setMulticastLoopback(true); // 同一台机器上的两个实例也能互相看见
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
      if (err) this.opts.log(`心跳发送失败: ${err.message}`);
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
