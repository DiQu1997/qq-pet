import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("qqpet", {
  onSnapshot: (cb: (snap: unknown) => void) =>
    ipcRenderer.on("snapshot", (_e, snap) => cb(snap)),
  onBubble: (cb: (text: string) => void) =>
    ipcRenderer.on("bubble", (_e, text) => cb(text)),
  onAnim: (cb: (name: string) => void) =>
    ipcRenderer.on("anim", (_e, name) => cb(name)),
  onGotoTab: (cb: (tab: string) => void) =>
    ipcRenderer.on("goto-tab", (_e, tab) => cb(tab)),
  petClick: () => ipcRenderer.send("pet-click"),
  petDoubleClick: () => ipcRenderer.send("pet-double-click"),
  petMenu: () => ipcRenderer.send("pet-menu"),
  dragStart: (offsetX: number, offsetY: number) =>
    ipcRenderer.send("drag-start", offsetX, offsetY),
  dragEnd: () => ipcRenderer.send("drag-end"),
  setInteractive: (on: boolean) => ipcRenderer.send("set-interactive", on),
  action: (kind: string, id?: string, extra?: string) =>
    ipcRenderer.invoke("action", kind, id, extra),
  requestSnapshot: () => ipcRenderer.invoke("get-snapshot"),
  requestConfig: () => ipcRenderer.invoke("get-config"),
  requestSkin: () => ipcRenderer.invoke("get-skin"),
  closeWindow: () => ipcRenderer.send("close-window"),
  openGame: (page: string) => ipcRenderer.send("open-game", page),
});
