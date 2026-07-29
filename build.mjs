import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

// 主进程 / preload:CommonJS(Electron 要求)
await esbuild.build({
  entryPoints: ["src/main/main.ts", "src/main/preload.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});

// 渲染进程:浏览器环境
await esbuild.build({
  entryPoints: [
    "src/renderer/renderer.ts",
    "src/renderer/community.ts",
    "src/renderer/battle.ts",
    "src/renderer/maze.ts",
    "src/renderer/gym.ts",
  ],
  outdir: "dist",
  bundle: true,
  platform: "browser",
  format: "iife",
});

cpSync("src/renderer/index.html", "dist/index.html");
cpSync("src/renderer/community.html", "dist/community.html");
cpSync("src/renderer/battle.html", "dist/battle.html");
cpSync("src/renderer/maze.html", "dist/maze.html");
cpSync("src/renderer/gym.html", "dist/gym.html");
cpSync("skins", "dist/skins", { recursive: true });
cpSync("config.json", "dist/config.json");
console.log("build ok");
