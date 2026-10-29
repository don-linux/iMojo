import { createClickPlayer } from "./clickSession.ts";
import {
  createByteLoader,
  type ClickContextCtor,
  type ClickListenable,
  type ClickPlayer,
} from "./clickTypes.ts";

export { createClickPlayer };

async function readInlineWav(): Promise<ArrayBuffer | null> {
  const asset = await import("../ipod/assets/click.wav?inline");
  const response = await fetch(asset.default);
  if (!response.ok) return null;
  return response.arrayBuffer();
}

function audioConstructor(): ClickContextCtor | null {
  const scoped = window as unknown as {
    AudioContext?: ClickContextCtor;
    webkitAudioContext?: ClickContextCtor;
  };
  return scoped.AudioContext ?? scoped.webkitAudioContext ?? null;
}

function browserActivated(): boolean {
  // Engines without User Activation (Safari before 16.4) cannot tell, so keep the eager unlock.
  const activation = navigator.userActivation;
  return activation ? activation.isActive : true;
}

const loadClickBytes = createByteLoader(readInlineWav);
let browserPlayer: ClickPlayer | null = null;

if (typeof window !== "undefined") {
  void loadClickBytes();
  browserPlayer = createClickPlayer({
    getConstructor: audioConstructor,
    doc: document as unknown as ClickListenable,
    win: window as unknown as ClickListenable,
    now: () => Date.now(),
    loadBytes: loadClickBytes,
    isActivated: browserActivated,
  });
}

export function playClick(): void {
  browserPlayer?.playClick();
}

export function unlockClick(): void {
  browserPlayer?.unlockClick();
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    browserPlayer?.dispose();
  });
}
