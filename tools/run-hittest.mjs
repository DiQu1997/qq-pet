// 桌宠命中判定回归测试:在真实 Electron 里派发鼠标事件,验证单击/双击/右键/拖拽/空白区
// 起因:事件监听挂在 #stage 但事件从子元素冒泡,用 e.offsetX/Y 会取到相对子元素的坐标,
// 导致命中判定永远为假(右键仍可用,极易漏掉)。必须用 clientX/clientY。
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const local = join(root, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron");
const runtime = join(process.env.HOME, "Library", "Application Support", "qq-pet-runtime",
                     "Electron.app", "Contents", "MacOS", "Electron");
// iCloud 目录下本地 Electron 签名会被破坏,优先用重签过的运行时副本(见 README 已知问题)
const bin = existsSync(runtime) ? runtime : local;

let failed = false;
for (const skin of ["penguin", "snorlax"]) {
  const r = spawnSync(bin, [join(root, "tools", "hittest.js")],
    { env: { ...process.env, SKIN_ID: skin }, encoding: "utf-8" });
  const lines = (r.stdout || "").split("\n").filter((l) => /###|✓|✗/.test(l));
  console.log(lines.join("\n"));
  if (r.status !== 0) failed = true;
}
console.log(failed ? "\n命中测试失败" : "\n命中测试全部通过");
process.exit(failed ? 1 : 0);
