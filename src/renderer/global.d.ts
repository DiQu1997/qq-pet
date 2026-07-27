/** preload 暴露的桥接 API(ambient 声明,所有渲染窗口共用) */
interface QQPetBridge {
  onSnapshot(cb: (snap: any) => void): void;
  onBubble(cb: (text: string) => void): void;
  onAnim(cb: (name: string) => void): void;
  onGotoTab(cb: (tab: string) => void): void;
  petClick(): void;
  petDoubleClick(): void;
  petMenu(): void;
  dragStart(ox: number, oy: number): void;
  dragEnd(): void;
  action(kind: string, id?: string, extra?: string): Promise<{ ok: boolean; message: string }>;
  requestSnapshot(): Promise<any>;
  requestConfig(): Promise<any>;
  requestSkin(): Promise<any>;
  closeWindow(): void;
  openGame(page: string): void;
}

interface Window {
  qqpet: QQPetBridge;
}
