# qq-pet — QQ宠物单机复刻

腾讯 QQ 宠物(2005–2018)的单机桌面复刻,个人学习与怀旧用途,严禁商用。
企鹅素材来自 [QQpet-codex](https://github.com/chenboos5/QQpet-codex)(官方 QGG SWF 转 PNG),
数值考证见 [docs/qq宠物1比1复刻功能规格.md](docs/qq宠物1比1复刻功能规格.md),
行为对照参考 [qqpet_automation](https://github.com/xuemian168/qqpet_automation)(怀旧服 v1.2.4 逆向)。

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

## 架构

- `config.json` — 全部游戏数值(衰减、成长表、等级表、商品、气泡台词),改数值不用碰代码
- `src/core/` — 纯逻辑引擎(不依赖 Electron,vitest 可测):属性衰减、心情→成长、等级、喂食洗澡、经济
- `src/main/` — Electron 主进程:桌宠窗口、行为状态机(散步/拖拽/坠落/贴边躲藏)、托盘、右键菜单、存档
- `src/renderer/` — 四个窗口:桌宠精灵动画+气泡(`renderer.ts`)、企鹅岛社区(`community.ts`,11 个标签页)、古堡战记(`battle.ts`)、密室探险(`maze.ts`)
- `assets/sprites.json` — 精灵图动画表(行号/帧数/帧率/是否循环),换素材只改这里
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

**M3 社区窗口**:企鹅岛 11 个标签页(状态/商城/医院/学校/打工街/教堂/旅游/福利站/游乐场/名品城/粉钻)

**M4 结婚生蛋(单机化)**
- 4 只 NPC 企鹅配偶池、三档戒指(12 级免费领挚爱金戒)、爱情值 = 戒指 + 婚后成长×10
- 婚后 200 小时培育宠物蛋(一生 10 次),孵化二代继承成长加成、名片记父母;离婚魅力 -5%

**M5 旅游 + 福利**
- 三条线路,旅游期间宠物离开桌面、心情+5/分,回来汇报;梦想奖励 380→5000 递增、宝箱钥匙、带回小客人
- 每日签到、捕鼠夹(6 级)、周末许愿树/寻宝、嘉年华牛翔赛跑,跨天自动重置

**M6 小游戏**:古堡战记(回合制打长毛怪/科学怪人/狼人,武力值加成,日限 3 次)、密室探险(限时迷宫,方向键,奖道具)

**M7 装扮 + 粉钻**
- 帽子/场景泡泡装扮(画布叠加渲染)、名品城魅力加成、改名卡
- 粉钻贵族(1000 元宝/30 天):购物 8 折、免病、免挂号、每日免费用餐清洗、还魂丹 8 折、游戏次数翻倍

## 后续可做

- [ ] 音效(原版提示音)、更多动画状态利用
- [ ] 完整食物/装扮货架(从怀旧服 v1.2.4 客户端解包)
- [ ] 密室探险奖励钥匙宝箱化、古堡战记技能系统
- [ ] 开机自启(登录项)
