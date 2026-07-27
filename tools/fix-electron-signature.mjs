/**
 * postinstall:修复 macOS 上 Electron 的 ad-hoc 签名。
 *
 * 背景:npm 分发的 Electron 二进制是 **ad-hoc 签名、未经公证** 的
 * (codesign 显示 Signature=adhoc、TeamIdentifier=not set、无 stapled ticket)。
 * arm64 上二进制必须至少 ad-hoc 签名,而签名之后任何字节改动都会让它失效,
 * 内核会直接 SIGKILL。最常见的"改动"是文件系统给 bundle 加扩展属性:
 * iCloud 同步目录会持续写入 com.apple.fileprovider / com.apple.FinderInfo 等。
 *
 * 所以这里先剥属性再重签。若重签后校验仍不过,几乎可以确定项目在 iCloud
 * 同步范围内 —— 那种情况下原地重签是徒劳的(刚签完属性又被写回来),
 * 必须把运行时复制到同步范围外。此时打印指引,而不是静默放过。
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") process.exit(0);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appPath = join(root, "node_modules", "electron", "dist", "Electron.app");

if (!existsSync(appPath)) {
  // Electron 没装(比如 --omit=dev),不是错误
  process.exit(0);
}

const run = (cmd, args) => {
  try {
    execFileSync(cmd, args, { stdio: "pipe" });
    return { ok: true, err: "" };
  } catch (e) {
    return { ok: false, err: (e.stderr?.toString() || e.message || "").trim() };
  }
};

run("xattr", ["-cr", appPath]);
run("codesign", ["--force", "--deep", "--sign", "-", appPath]);
const verify = run("codesign", ["--verify", "--deep", "--strict", appPath]);

if (verify.ok) {
  console.log("✓ Electron 签名已修复,可以 npm start");
  process.exit(0);
}

console.warn(`
⚠ Electron 重签后校验仍未通过:
  ${verify.err}

  这几乎可以确定是项目位于 iCloud 同步目录(~/Desktop、~/Documents 默认都是)。
  iCloud 会不断给文件写扩展属性,原地重签会被立刻破坏,启动时内核 SIGKILL。

  两个办法(任选其一):

  1) 一劳永逸 —— 把项目移出同步目录:
       mv "${root}" ~/dev/qq-pet

  2) 变通 —— 把运行时复制到同步范围外并重签,从副本启动:
       RT="$HOME/Library/Application Support/qq-pet-runtime"
       rm -rf "$RT" && mkdir -p "$RT"
       ditto --noextattr --norsrc node_modules/electron/dist/Electron.app "$RT/Electron.app"
       codesign --force --deep --sign - "$RT/Electron.app"
       npm run build && open -n "$RT/Electron.app" --args "$PWD"

  详见 README「已知问题 · macOS 启动失败」。
`);
// 不阻断安装:构建和测试不依赖 Electron 能启动
process.exit(0);
