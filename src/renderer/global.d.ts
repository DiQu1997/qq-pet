/** preload 暴露的桥接 API(ambient 声明,所有渲染窗口共用) */
interface QQPetBridge {
  onSnapshot(cb: (snap: any) => void): void;
  onBubble(cb: (text: string) => void): void;
  onAnim(cb: (name: string) => void): void;
  onGotoTab(cb: (tab: string) => void): void;
  onUiPrefs(cb: (p: any) => void): void;
  petClick(): void;
  petDoubleClick(): void;
  petMenu(): void;
  dragStart(ox: number, oy: number): void;
  dragEnd(): void;
  setInteractive(on: boolean): void;
  action(kind: string, id?: string, extra?: string): Promise<{ ok: boolean; message: string }>;
  requestSnapshot(): Promise<any>;
  requestConfig(): Promise<any>;
  requestSkin(): Promise<any>;
  requestPeers(): Promise<{ enabled: boolean; running: boolean; peers: any[] }>;
  peerCard(id: string): Promise<any>;
  visitStart(id: string, minutes: number): Promise<{ ok: boolean; message: string }>;
  onPeers(cb: (peers: any[]) => void): void;
  closeWindow(): void;
  openGame(page: string): void;
}

interface Window {
  qqpet: QQPetBridge;
}
