import { createClickPlayer } from "./clickSession.ts";
import {
  createByteLoader,
  type ClickActivation,
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

export type IosWebKitEnv = {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
};

// iPadOS desktop mode reports a Mac UA. Touch points keep it distinct from a Mac.
export function isIosWebKit(env: IosWebKitEnv): boolean {
  const ua = env.userAgent ?? "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  if ((env.maxTouchPoints ?? 0) <= 1) return false;
  return env.platform === "MacIntel" || /Macintosh/.test(ua);
}

function readActivation(): ClickActivation {
  const activation = navigator.userActivation;
  return {
    active: activation?.isActive === true,
    sticky: activation?.hasBeenActive === true,
  };
}

function claimPlayback(): void {
  const session = (navigator as Navigator & { audioSession?: { type?: string } }).audioSession;
  if (!session || session.type === "playback") return;
  session.type = "playback";
}

const loadClickBytes = createByteLoader(readInlineWav);
let browserPlayer: ClickPlayer | null = null;
let iosDevice = false;
// With the clicker off the page never opens an AudioContext.
let clickerOn = true;

export function setClickEnabled(enabled: boolean): void {
  clickerOn = enabled;
}

if (typeof window !== "undefined") {
  iosDevice = isIosWebKit({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  });
  void loadClickBytes();
  browserPlayer = createClickPlayer({
    getConstructor: audioConstructor,
    doc: document as unknown as ClickListenable,
    win: window as unknown as ClickListenable,
    now: () => Date.now(),
    loadBytes: loadClickBytes,
    isActivated: browserActivated,
    isEnabled: () => clickerOn,
    isIos: iosDevice,
    activation: readActivation,
    claimPlayback,
  });
}

export function playClick(): void {
  if (clickerOn) browserPlayer?.playClick();
}

export function unlockClick(): void {
  if (clickerOn) browserPlayer?.unlockClick();
}

export function unlockDragEnd(): void {
  if (clickerOn && iosDevice) browserPlayer?.unlockDragEnd();
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    browserPlayer?.dispose();
  });
}
