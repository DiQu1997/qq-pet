const { app, BrowserWindow } = require("electron");
const path = require("path");
const ID = process.env.SKIN_ID || "penguin";
let failed = false;
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 220, height: 300, show: false, frame: false,
    webPreferences: { preload: path.join(__dirname, "hittest-preload.js"), sandbox: false } });
  await win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  await new Promise(r => setTimeout(r, 1300));
  const out = await win.webContents.executeJavaScript(`(async () => {
    const fire = (type, x, y, btn = 0) => {
      const el = document.elementFromPoint(x, y) || document.getElementById("stage");
      el.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: btn,
        bubbles: true, cancelable: true }));
    };
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const petW = document.querySelector("#rig svg")
      ? document.querySelector("#rig svg").getBoundingClientRect().width
      : document.getElementById("sheet").getBoundingClientRect().width;
    const petH = document.querySelector("#rig svg")
      ? document.querySelector("#rig svg").getBoundingClientRect().height
      : document.getElementById("sheet").getBoundingClientRect().height;
    const cx = 110, petCY = 300 - petH / 2;      // 宠物身体中心
    const res = {};

    __calls.clear(); fire("click", cx, petCY); await wait(300);
    res["单击宠物→逗它"] = __calls.get().join(",") || "(无反应)";

    __calls.clear(); fire("click", cx, petCY); fire("dblclick", cx, petCY); await wait(400);
    res["双击宠物→开社区"] = __calls.get().join(",") || "(无反应)";

    __calls.clear(); fire("contextmenu", cx, petCY); await wait(200);
    res["右键宠物→菜单"] = __calls.get().join(",") || "(无反应)";

    __calls.clear(); fire("mousedown", cx, petCY);
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: cx + 40, clientY: petCY - 40,
      screenX: 940, screenY: 340, bubbles: true }));
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); await wait(200);
    res["拖拽宠物→抓取偏移"] = __calls.get().join(",") || "(无反应)";

    __calls.clear(); fire("click", cx, 30); await wait(300);
    res["点空白处→应无反应"] = __calls.get().join(",") || "(无反应)";

    return { petW: Math.round(petW), petH: Math.round(petH), res };
  })()`);
  const EXPECT = {
    "单击宠物→逗它": "click",
    "双击宠物→开社区": "dblclick",
    "右键宠物→菜单": "menu",
    "点空白处→应无反应": "(无反应)",
  };
  console.log(`\n### ${ID}  宠物尺寸 ${out.petW}x${out.petH}`);
  for (const [k, v] of Object.entries(out.res)) {
    const want = EXPECT[k];
    const ok = want === undefined ? v.startsWith("drag:") : v === want;
    if (!ok) failed = true;
    console.log(`  ${ok ? "✓" : "✗"} ${k.padEnd(22)} → ${v}${ok ? "" : `  (期望 ${want ?? "drag:*"})`}`);
  }
  app.exit(failed ? 1 : 0);
});
