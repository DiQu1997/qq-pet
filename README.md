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

## 运行

```bash
npm install
npm start
```

测试 / 类型检查:

```bash
npm test
npm run typecheck
```

桌宠命中判定回归测试(在真实 Electron 里派发鼠标事件,验证单击/双击/右键/拖拽):

```bash
npm run hittest
```

## 已知问题 · macOS 启动失败(Electron 被内核 SIGKILL)

**症状**:`npm start` 或直接跑 Electron 立刻退出,报
`Electron exited with signal SIGKILL`,连 `Electron --version` 都是 exit 137;
`codesign --verify` 报 `resource fork, Finder information, or similar detritus not allowed`。

**原因**:项目放在 **iCloud 同步范围内的目录**(`~/Desktop`、`~/Documents` 默认都在),
iCloud 会持续给文件写扩展属性(`com.apple.FinderInfo`、`com.apple.provenance` 等),
破坏 `Electron.app` 的 ad-hoc 签名 → macOS 内核直接杀进程。
在原地 `xattr -c` + 重新签名**无效**,因为 iCloud 会立刻再写回去。

**解法**:把 Electron 运行时复制到不受同步影响的目录、剥掉扩展属性、重新 ad-hoc 签名,
之后从那个副本启动(项目源码留在原地不用动):

```bash
RT="$HOME/Library/Application Support/qq-pet-runtime" && rm -rf "$RT" && mkdir -p "$RT" && ditto --noextattr --norsrc node_modules/electron/dist/Electron.app "$RT/Electron.app" && codesign --force --deep --sign - "$RT/Electron.app" && codesign --verify --deep --strict "$RT/Electron.app" && echo OK
```

之后的启动命令(替代 `npm start`):

```bash
npm run build && open -n "$HOME/Library/Application Support/qq-pet-runtime/Electron.app" --args "$PWD"
```

每次 `npm install` 重装 Electron 后需要重跑一次上面的复制+签名。
**根治办法**:把项目移出 iCloud 同步目录(例如 `~/dev/qq-pet`),或给 `node_modules`
加 `.nosync` 后缀排除同步 —— 之后 `npm start` 就能正常用了。

排障日志在 `~/Library/Application Support/qq-pet/main.log`(记录启动、未捕获异常、存档失败)。

## 换角色(皮肤系统)

改 `config.json` 里一行就能换主角:

```json
{ "skin": "penguin" }   // 或 "snorlax"
```

| 皮肤 | 渲染后端 | 说明 |
|---|---|---|
| `penguin` | `sheet` 逐帧 | QQ 企鹅原版,55 帧精灵图,9 种动画 |
| `snorlax` | `rig` 骨骼 | 卡比兽,矢量图切 6 部件做关节动画 + 16 种情绪立绘 |

### skins/&lt;id&gt;/skin.json 结构

- `renderer` — `sheet`(精灵图逐帧)或 `rig`(骨骼动画)
- `terms` — 术语表:物种名、地名、性别称呼、社区标题。全项目的文案都读这里,换皮肤连「企鹅岛/红围巾GG」都会跟着变
- `npcs` — 相亲对象名单(教堂里的可求婚对象)
- `sheet` — 精灵图:帧宽高 + 每个动画在第几行、几帧、帧率
- `rig` — 骨骼:SVG 文件、各部件枢轴点、子骨骼列表
- `portraits` — 情绪立绘(可选),按心情/病/死/活动自动切换,显示在气泡和社区 HUD 里

### 骨骼动画的关键约束

`src/renderer/rig.ts` 里所有形变遵守三条规则,否则角色会散架:

1. **父子层级** — body 是父骨骼,head/双臂/双脚是子骨骼。父骨骼缩放时,子骨骼必须按 `(自身枢轴 - 父枢轴) × (缩放-1)` 补偿位移,否则非等比缩放会让头和身体脱节
2. **体积守恒** — 纵向压 `sy` 时横向必须 `1/sy`
3. **幅度上限 10%** — 超过就从「有弹性」变成「坏掉」

平移/旋转/镜像是刚体变换,数学上零失真,可以放心用。

## 架构

- `config.json` — 全部游戏数值(衰减、成长表、等级表、商品、气泡台词)+ `skin` 选择,改数值不用碰代码
- `src/core/` — 纯逻辑引擎(不依赖 Electron,vitest 可测):属性衰减、心情→成长、等级、喂食洗澡、经济
- `src/main/` — Electron 主进程:桌宠窗口、行为状态机(散步/拖拽/坠落/贴边躲藏)、托盘、右键菜单、存档
- `src/renderer/` — 四个窗口:桌宠精灵动画+气泡(`renderer.ts`)、企鹅岛社区(`community.ts`,11 个标签页)、古堡战记(`battle.ts`)、密室探险(`maze.ts`)
- `skins/<id>/` — 皮肤包:skin.json(术语表/NPC/精灵图或骨骼定义/情绪立绘)+ 素材文件
- `src/renderer/rig.ts` — 骨骼动画引擎(父子层级 + 体积守恒),rig 类皮肤共用
- 存档:`~/Library/Application Support/qq-pet/save.json`;退出期间不成长也不会死(与原版一致)

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

**M7 装扮 + 粉钻**
- 帽子/场景泡泡装扮(覆盖层渲染,两种后端通用)、名品城魅力加成、改名卡
- 粉钻贵族(1000 元宝/30 天):购物 8 折、免病、免挂号、每日免费用餐清洗、还魂丹 8 折、游戏次数翻倍

**M8 皮肤系统**
- skin.json 抽象:渲染后端(sheet/rig)、术语表、NPC、素材;`config.json` 改一行换角色
- 骨骼动画引擎:SVG 切 6 部件、父子层级补偿、体积守恒挤压拉伸,矢量渲染零采样损失
- 16 种情绪立绘按心情/病/死/活动自动切换,显示在气泡与社区 HUD

## 后续可做

- [ ] 音效(原版提示音)、更多动画状态利用
- [ ] 卡比兽手臂被肚子遮挡,挥手动作看不见 —— 换一张手臂外露的姿势图可解
- [ ] 完整食物/装扮货架(从怀旧服 v1.2.4 客户端解包)
- [ ] 密室探险奖励钥匙宝箱化、古堡战记技能系统
- [ ] 开机自启(登录项)
