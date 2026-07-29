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
  onUiPrefs: (cb: (p: any) => void) =>
    ipcRenderer.on("ui-prefs", (_e, p) => cb(p)),
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
  requestPeers: () => ipcRenderer.invoke("get-peers"),
  peerCard: (id: string) => ipcRenderer.invoke("peer-card", id),
  visitStart: (id: string, minutes: number) => ipcRenderer.invoke("visit-start", id, minutes),
  onPeers: (cb: (peers: any[]) => void) =>
    ipcRenderer.on("peers", (_e, peers) => cb(peers)),
  closeWindow: () => ipcRenderer.send("close-window"),
  openGame: (page: string) => ipcRenderer.send("open-game", page),
  openGym: () => ipcRenderer.send("open-gym"),
  gymJoin: () => ipcRenderer.invoke("gym-join"),
  gymRoster: () => ipcRenderer.invoke("gym-roster"),
  gymLeave: () => ipcRenderer.send("gym-leave"),
  onRoom: (cb: (members: any[]) => void) =>
    ipcRenderer.on("room", (_e, members) => cb(members)),
});
