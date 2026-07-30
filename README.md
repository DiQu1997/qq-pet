# qq-pet — QQ宠物单机复刻

腾讯 QQ 宠物(2005–2018)的单机桌面复刻,**个人学习与怀旧用途,严禁商用、严禁分发**。
数值考证见 [docs/qq宠物1比1复刻功能规格.md](docs/qq宠物1比1复刻功能规格.md),
行为对照参考 [qqpet_automation](https://github.com/xuemian168/qqpet_automation)(怀旧服 v1.2.4 逆向)。

支持换角色:内置 **QQ企鹅** 与 **卡比兽** 两套皮肤,`config.json` 改一行即可切换。

### 素材来源与署名

| 皮肤 | 素材 | 来源 | 版权 |
|---|---|---|---|
| penguin | 企鹅精灵图 | [QQpet-codex](https://github.com/chenboos5/QQpet-codex)(官方 QGG SWF 转 PNG) | 腾讯 |
| snorlax | 卡比兽矢量图 | [PokeAPI/sprites](https://github.com/PokeAPI/sprites) Dream World | 任天堂 / Game Freak |
| snorlax | 16 张情绪立绘 | [PMDCollab/SpriteCollab](https://github.com/PMDCollab/SpriteCollab) · **CC BY-NC 4.0** · 原作 CHUNSOFT | 任天堂 / Game Freak |

以上素材均为各自权利人所有,本项目未获授权,仅作个人学习与技术研究之用。
PMDCollab 部分依 CC BY-NC 4.0 署名如上,不得商用。

## 环境要求

| 项 | 要求 | 说明 |
|---|---|---|
| **Node.js** | **≥ 18**,推荐 **20 LTS** | 最严格的约束来自 vitest(`^18 \|\| >=20`)和 esbuild(`>=18`)。仓库带 `.nvmrc`,用 nvm 的话 `nvm use` 即可 |
| **npm** | ≥ 9 | 随 Node 18+ 自带 |
| **操作系统** | **仅在 macOS 上验证过** | Electron 本身跨平台,但桌宠的窗口穿透、托盘、坐标逻辑没在 Windows/Linux 上测过 |
| 磁盘 | ~300 MB | 其中 Electron 二进制约 290 MB |

首次 `npm install` 会下载 Electron 二进制(约 90 MB),网络慢时需要几分钟。

## 运行

```bash
nvm use          # 可选,若用 nvm
npm install
npm start
```

测试 / 类型检查:

```bash
npm test
npm run typecheck
```

桌宠交互回归测试(在真实 Electron 里派发鼠标事件,验证单击/双击/右键/拖拽/鼠标穿透):

```bash
npm run hittest
```

## 安装踩坑速查

按报错关键字对号入座:

### `EACCES` / `EEXIST` 指向 `~/.npm/_cacache`

npm 缓存目录权限损坏(常见于曾经用过 `sudo npm install`)。报错长这样:

```
npm error code EEXIST
npm error path /Users/xxx/.npm/_cacache/tmp/xxxxxx
npm error Invalid response body while trying to fetch ...: EACCES: permission denied, rename ...
```

三选一:

```bash
sudo chown -R $(id -u):$(id -g) ~/.npm    # 首选:把缓存目录还给当前用户
npm cache clean --force                    # 或者清掉缓存重来
npm install --cache /tmp/npm-cache         # 或者临时换个缓存目录绕开
```

### Electron 下载卡住 / `RequestError` / 超时

`postinstall` 阶段要从 GitHub 下载 Electron 二进制,国内网络容易失败。换镜像:

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

想长期生效就写进 `~/.npmrc`:

```
electron_mirror=https://npmmirror.com/mirrors/electron/
```

### `Unsupported engine` 或 vitest / esbuild 起不来

Node 版本低于 18。查版本并升级:

```bash
node -v                  # 低于 v18 就要升
nvm install 20 && nvm use 20
```

### `npm start` 后 Electron 立刻退出(仅 macOS)

见下方「已知问题 · macOS 启动失败」一节,是 Electron 的 ad-hoc 签名失效导致的,与 npm 本身无关。

## 已知问题 · macOS 启动失败(Electron 被内核 SIGKILL)

**症状**:`npm start` 或直接跑 Electron 立刻退出,报
`Electron exited with signal SIGKILL`,连 `Electron --version` 都是 exit 137;
`codesign --verify` 报 `resource fork, Finder information, or similar detritus not allowed`。
个别环境下 `Electron.app` 甚至会在启动后消失。

**机制**:npm 分发的 Electron 二进制是 **ad-hoc 签名、从未经过 Apple 公证**的
—— 可以自己验证:

```bash
codesign -dvvv node_modules/electron/dist/Electron.app   # → Signature=adhoc, TeamIdentifier=not set
xcrun stapler validate node_modules/electron/dist/Electron.app  # → does not have a ticket stapled
```

所以这**不是**"公证票据被吊销"(没有票据可吊销),`spctl` 报 `rejected` 也属正常
(任何 ad-hoc 签名的 app 都会被 Gatekeeper 拒绝)。真正的机制是:arm64 上二进制
必须至少有 ad-hoc 签名,而**签名之后任何字节改动都会让签名失效,内核直接 SIGKILL**。
最常见的"改动"来源是文件系统给 bundle 写扩展属性。

**修复**:`npm install` 会自动跑 `tools/fix-electron-signature.mjs`
(剥扩展属性 → 重新 ad-hoc 签名 → 校验),多数情况到此为止,会看到
`✓ Electron 签名已修复`。

**如果脚本提示校验仍未通过**,说明项目在 **iCloud 同步目录**里
(`~/Desktop`、`~/Documents` 默认都是)。iCloud 会持续写入
`com.apple.fileprovider.fpfs#P` 等属性,原地重签刚签完就被破坏,徒劳。
两个办法:

**办法一(推荐,一劳永逸)** —— 把项目移出同步目录:

```bash
mv ~/Desktop/workspace/qq-pet ~/dev/qq-pet
```

**办法二(变通)** —— 把运行时复制到同步范围外、剥属性、重签,之后从副本启动
(项目源码留在原地不用动):

```bash
RT="$HOME/Library/Application Support/qq-pet-runtime" && rm -rf "$RT" && mkdir -p "$RT" && ditto --noextattr --norsrc node_modules/electron/dist/Electron.app "$RT/Electron.app" && codesign --force --deep --sign - "$RT/Electron.app" && codesign --verify --deep --strict "$RT/Electron.app" && echo OK
```

之后的启动命令(替代 `npm start`):

```bash
npm run build && open -n "$HOME/Library/Application Support/qq-pet-runtime/Electron.app" --args "$PWD"
```

每次 `npm install` 重装 Electron 后需要重跑一次上面的复制+签名。

排障日志在 `~/Library/Application Support/qq-pet/main.log`(记录启动、未捕获异常、存档失败)。

## 换角色(皮肤系统)

**右键桌宠(或右键托盘图标)→「切换皮肤」**,选一个即可,立即生效、不用重启、不动存档。
选择记在 `~/Library/Application Support/qq-pet/prefs.json`,重启后保持。

也可以改 `config.json` 的 `skin` 字段设默认皮肤(优先级:prefs.json > config.json > penguin):

```json
{ "skin": "penguin" }   // 或 "snorlax"
```

| 皮肤 | 渲染后端 | 说明 |
|---|---|---|
| `penguin` | `sheet` 逐帧 | QQ 企鹅原版,55 帧精灵图,9 种动画 |
| `snorlax` | `rig` 骨骼 | 卡比兽,矢量图切 6 部件做关节动画 + 16 种情绪立绘 |
| `hitmonchan` | `rig` 骨骼 | 快拳郎,**四肢完全外露**,健身房动作最全(出拳/跳绳/闪避) |

### skins/&lt;id&gt;/skin.json 结构

- `renderer` — `sheet`(精灵图逐帧)或 `rig`(骨骼动画)
- `terms` — 术语表:物种名、地名、性别称呼、社区标题。全项目的文案都读这里,换皮肤连「企鹅岛/红围巾GG」都会跟着变
- `npcs` — 相亲对象名单(教堂里的可求婚对象)
- `sheet` — 精灵图:帧宽高 + 每个动画在第几行、几帧、帧率
- `rig` — 骨骼:SVG 文件、各部件枢轴点、子骨骼列表
- `portraits` — 情绪立绘(可选),按心情/病/死/活动自动切换,显示在气泡和社区 HUD 里
- `nameplateOffset` — 头顶名牌相对宠物顶端的偏移(精灵图上方常有透明留白,需负值上提)

### 骨骼动画的关键约束

`src/renderer/rig.ts` 里所有形变遵守三条规则,否则角色会散架:

1. **父子层级** — body 是父骨骼,head/双臂/双脚是子骨骼。父骨骼缩放时,子骨骼必须按 `(自身枢轴 - 父枢轴) × (缩放-1)` 补偿位移,否则非等比缩放会让头和身体脱节
2. **体积守恒** — 纵向压 `sy` 时横向必须 `1/sy`
3. **幅度上限 10%** — 超过就从「有弹性」变成「坏掉」

平移/旋转/镜像是刚体变换,数学上零失真,可以放心用。

## 局域网邻居(实验中)

同一个 Wi-Fi 下的多台机器可以互相看到对方的宝贝。**默认关闭**,需要在
**右键桌宠 →「局域网邻居」** 里主动开启,两台都开才能互相发现。
开启后进社区窗口的 **📡 局域网邻居** 标签页查看。

- **发现**:UDP 组播(`239.255.42.99:41999`),每 5 秒广播一次名片
  (名字、等级、皮肤、HTTP 端口)。TTL=1,只在本网段,不出路由器
- **通信**:每个实例监听一个系统分配的随机端口,提供 `GET /card`
- **零新依赖**:只用 Node 内置的 `dgram` 与 `http`

**串门**:在邻居卡片上点「去串门」,自家宝贝会**离开自己的桌面**(和旅游一样),
以完整形象出现在**对方的桌面上**(带名牌和装扮),10 分钟后自己回来,带一份伴手礼。
主人家的宝贝因为来了客人心情 +100。

- 客人用**它自己的皮肤**渲染 —— 你是卡比兽、对方是企鹅,你桌面上出现的就是企鹅
- 客人窗口是只读的:不能喂、不能拖,点它只会打个招呼
- 一次只招待一位客人,已有客人时会回「家里已经有客人「XX」了」
- 对方不在线 / 连不上,一律回「对方不在家」

**局域网健身房(实验中)**:社区窗口 → 🎮 游乐场 → 「去健身房」。
同一个 Wi-Fi 下进了健身房的宝贝会**同屏出现**,各自在跑步机/举铁区/瑜伽垫上活动。

- **全分布式,没有房主**:每个成员每 1.2 秒组播一次"我在哪个房间 + 长什么样",
  各机自行维护名单。任何人退出都不影响别人,不需要选主
- **布局无需协商**:名单按 id 排序,序号即工位 —— 每台机器拿到同一份有序名单,
  算出的画面天然一致,不用同步坐标
- **骨骼皮肤有真正的健身动作**:`gymRun`(双脚交替蹬地+手臂反相摆)、`gymLift`(深蹲→起身)、
  `gymJump`(开合跳)、`gymStretch`(侧倾拉伸)、`gymBox`(左右交替出直拳)、
  `gymRope`(跳绳)、`gymDodge`(晃身闪避)。八个工位各配一种。
  **动作能不能看出来,取决于素材四肢是否外露** —— 卡比兽手臂藏在肚子后面,
  出拳类动作在它身上等于白做;快拳郎四肢完全外露,同样的动作就清清楚楚。
  精灵图皮肤(企鹅)没有健身帧,退回到语义最近的现有动画
- 再叠器械动画(履带滚动、杠铃起落、车轮转)与汗滴特效。
  只有器械动、宠物站着不动是不够的 —— 那看起来就是在发呆
- 场景是一整张手绘 SVG(窗户/吊灯/招牌/海报/器械架/木地板),
  上面叠光柱(mix-blend)、浮尘、暗角三层氛围;**零渲染库**。
  健身房窗口是**固定尺寸**(1160×680):场景按这个宽高比手绘,
  宠物又是固定像素,窗口可缩放会让二者比例失调(小窗口里宠物大过房间)
- 目前只做**渲染验证**,还没有健身奖励数值
- 最多同屏 6 位,超出只显示前 6

**已知限制**

- 首次开启 macOS 会弹防火墙授权框,要选允许
- 部分公司/校园网络会拦截 UDP 组播,那种环境发现不到邻居;手机热点、家用路由器一般没问题
- 对方不在线时一律提示「对方不在家」,不做离线排队
- 客人离开由**双方各自的定时器**兜底:主人家到点自动收起客人窗口,
  访客到点自己回家并尽力通知对方 —— 任一方中途退出都不会留下"卡住的客人"
- 状态是客户端权威的,双方都能改自己的存档 —— 这是给朋友之间玩的,**不做反作弊,也不要开放给陌生人**

**本机双开测试**:单实例锁是按 userData 路径判定的,换个目录就能开第二个实例:

```bash
QQPET_USER_DATA=/tmp/qqpet-B npm start          # 换存档目录 = 绕过单实例锁
QQPET_USER_DATA=/tmp/qqpet-B QQPET_AUTO_GYM=1 npm start   # 启动后自动进健身房
```

## 架构

- **属性条按「实际可达上限」算百分比**:`attrMax` 是理论容量,但喂到
  `feedCapPct`(60%)就拒绝再喂、洗到 `washCapPct`(90%)就拒绝再洗。
  拿理论容量当分母会出现「42% 却显示吃得很饱」这种自相矛盾 ——
  快照里的 `hungerFull` / `cleanFull` 才是界面该用的分母。
- `config.json` — 全部游戏数值(衰减、成长表、等级表、商品、气泡台词)+ `skin` 选择,改数值不用碰代码
- `src/core/` — 纯逻辑引擎(不依赖 Electron,vitest 可测):属性衰减、心情→成长、等级、喂食洗澡、经济
- `src/main/` — Electron 主进程:桌宠窗口、行为状态机(散步/拖拽/坠落/贴边躲藏)、托盘、右键菜单、存档
- `src/renderer/` — 四个窗口:桌宠精灵动画+气泡(`renderer.ts`)、企鹅岛社区(`community.ts`,11 个标签页)、古堡战记(`battle.ts`)、密室探险(`maze.ts`)
- `skins/<id>/` — 皮肤包:skin.json(术语表/NPC/精灵图或骨骼定义/情绪立绘)+ 素材文件
- `src/renderer/rig.ts` — 骨骼动画引擎(父子层级 + 体积守恒),rig 类皮肤共用
- 鼠标穿透:桌宠窗口(220×300)比宠物本身大,默认 `setIgnoreMouseEvents(true, {forward:true})`
  让透明区不挡下层应用;渲染层靠 mousemove 判断光标是否压在宠物上,再通知主进程临时恢复可交互
- `src/main/lan.ts` — 局域网:UDP 组播发现 + HTTP 点对点 + 共享房间(零新依赖)
- `src/renderer/pet-sprite.ts` — 可实例化的宠物精灵(sheet/rig 两种后端),
  健身房靠它同屏画 N 只、每只用自己的皮肤
- 单实例:`app.requestSingleInstanceLock()`。重复 `npm start` 时第二个实例直接退出,
  否则两个实例会同时 tick 并每 15 秒抢写同一个 `save.json`,后写的覆盖先写的 → 进度丢失
- 存档:`~/Library/Application Support/qq-pet/save.json`;退出期间不成长也不会死(与原版一致)
- 偏好:同目录 `prefs.json`(当前皮肤等本机设置,与项目默认值 `config.json` 分开)

## 已实现(M0~M7 全部落地)

**M0 核心养成 + 桌面灵魂**
- 四属性 + 上限公式 3000+等级×100(30 级封顶)、心情→成长十档表(2006 官方数值)、1~40 级成长值表
- 挂机成长、喂食/洗澡经济、点击逗玩、随机散步、拖拽物理(挣扎/落体/翻滚/贴边躲猫猫)、气泡、托盘、免打扰

**M1 医疗与死亡**
- 三条疾病链(感冒/咳嗽/肠胃 × 4 级恶化),各级专属台词与药品药价(20/80/120/200)
- 又饿又脏/心情低易生病;12 小时不治加重;医院挂号 50 开处方,未诊断不给药
- 死亡 → 桌面坟墓(R.I.P);还魂丹复活(初始送 1 颗,之后 400 元宝一颗)保留全部资料;埋葬清档重新领养

**M2 打工 + 学习**
- 23 个工种(等级+学历双门槛,时薪 20~42),按等级档位加大消耗,心情封顶 600,每日 8 小时自动罢工结算
- 三系九课三学段,课时/奖学金/三围加成照抄考证数值,中学要求先修完同系小学全部三门,中途放学保留进度

**M3 社区窗口**:11 个标签页(状态/商城/医院/学校/打工街/教堂/旅游/福利站/游乐场/名品城/粉钻)

**M4 结婚生蛋(单机化)**
- 4 只 NPC 配偶池(跟随皮肤)、三档戒指(12 级免费领挚爱金戒)、爱情值 = 戒指 + 婚后成长×10
- 婚后 200 小时培育宠物蛋(一生 10 次),孵化二代继承成长加成、名片记父母;离婚魅力 -5%

**M5 旅游 + 福利**
- 三条线路,旅游期间宠物离开桌面、心情+5/分,回来汇报;梦想奖励 380→5000 递增、宝箱钥匙、带回小客人
- 每日签到、捕鼠夹(6 级)、周末许愿树/寻宝、嘉年华牛翔赛跑,跨天自动重置

**M6 小游戏**:古堡战记(回合制打长毛怪/科学怪人/狼人,武力值加成,日限 3 次)、密室探险(限时迷宫,方向键,奖道具)

**改名与名牌**
- 改名免费、可反复改(`config.json` 的 `renameCardPrice` 设为 >0 可改回收费)
- 桌宠头顶显示「名字 + 等级」名牌,多台机器上一眼分清谁是谁;右键菜单可关闭

**M7 装扮 + 粉钻**
- 帽子/场景泡泡装扮(覆盖层渲染,两种后端通用)、名品城魅力加成、改名卡
- 粉钻贵族(1000 元宝/30 天):购物 8 折、免病、免挂号、每日免费用餐清洗、还魂丹 8 折、游戏次数翻倍

**M8 皮肤系统**
- skin.json 抽象:渲染后端(sheet/rig)、术语表、NPC、素材;`config.json` 改一行换角色
- 骨骼动画引擎:SVG 切 6 部件、父子层级补偿、体积守恒挤压拉伸,矢量渲染零采样损失
- 16 种情绪立绘按心情/病/死/活动自动切换,显示在气泡与社区 HUD
- 托盘/右键菜单内置皮肤切换器(扫 `skins/` 目录),运行时热切换,选择存 prefs.json

## 后续可做

- [ ] 音效(原版提示音)、更多动画状态利用
- [ ] 卡比兽手臂被肚子遮挡,挥手动作看不见 —— 换一张手臂外露的姿势图可解
- [ ] 完整食物/装扮货架(从怀旧服 v1.2.4 客户端解包)
- [ ] 密室探险奖励钥匙宝箱化、古堡战记技能系统
- [ ] 开机自启(登录项)
