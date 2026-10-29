import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { disposeSpotifyPlayer, SpotifySdkEngine, warmSpotifyPlayer } from "./runtime.ts";
import type { SpotifyPlayerOptions, SpotifySdk } from "./sdkTypes.ts";

class FakePlayer {
  static instances: FakePlayer[] = [];
  connects = 0;
  disconnected = false;
  options: SpotifyPlayerOptions;
  private listeners = new Map<string, ((event?: unknown) => void)[]>();
  private release: ((ok: boolean) => void) | null = null;

  constructor(options: SpotifyPlayerOptions) {
    this.options = options;
    FakePlayer.instances.push(this);
  }

  connect() {
    this.connects += 1;
    this.disconnected = false;
    return new Promise<boolean>((resolve) => {
      this.release = resolve;
    });
  }

  finish(ok = true) {
    this.release?.(ok);
  }

  disconnect() {
    this.disconnected = true;
  }

  addListener(name: string, callback: (event?: unknown) => void) {
    const list = this.listeners.get(name) ?? [];
    list.push(callback);
    this.listeners.set(name, list);
  }

  emit(name: string, event?: unknown) {
    for (const callback of this.listeners.get(name) ?? []) callback(event);
  }

  activateElement() {
    return Promise.resolve();
  }

  getCurrentState() {
    return Promise.resolve(null);
  }

  setVolume() {
    return Promise.resolve();
  }

  pause() {
    return Promise.resolve();
  }

  resume() {
    return Promise.resolve();
  }

  seek() {
    return Promise.resolve();
  }
}

const listeners = new Map<string, Set<(event: Event) => void>>();

function installDom() {
  FakePlayer.instances = [];
  listeners.clear();
  const sdk = { Player: FakePlayer as unknown as SpotifySdk["Player"] };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      Spotify: sdk,
      isSecureContext: true,
      setTimeout,
      clearTimeout,
      addEventListener(type: string, handler: (event: Event) => void) {
        const set = listeners.get(type) ?? new Set();
        set.add(handler);
        listeners.set(type, set);
      },
      removeEventListener(type: string, handler: (event: Event) => void) {
        listeners.get(type)?.delete(handler);
      },
      dispatchEvent(event: Event) {
        for (const handler of listeners.get(event.type) ?? []) handler(event);
        return true;
      },
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { visibilityState: "visible" },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0",
      maxTouchPoints: 0,
      requestMediaKeySystemAccess: () => Promise.resolve({}),
    },
  });
}

async function until(ready: () => boolean) {
  for (let attempt = 0; attempt < 30 && !ready(); attempt += 1) await Promise.resolve();
  assert.equal(ready(), true);
}

afterEach(() => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("pagehide"));
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "document");
  Reflect.deleteProperty(globalThis, "navigator");
});

test("disconnect and engine teardown reuse one Spotify player", async () => {
  installDom();
  warmSpotifyPlayer();
  await until(() => FakePlayer.instances.length === 1);
  const instance = FakePlayer.instances[0]!;
  instance.emit("ready", { device_id: "device-1" });
  instance.finish(true);
  await Promise.resolve();
  disposeSpotifyPlayer();
  assert.equal(instance.disconnected, true);
  assert.equal(FakePlayer.instances.length, 1);

  const engine = new SpotifySdkEngine();
  warmSpotifyPlayer();
  await until(() => instance.connects === 2);
  assert.equal(FakePlayer.instances.length, 1);
  instance.emit("ready", { device_id: "device-1" });
  instance.finish(true);
  engine.destroy();
  await Promise.resolve();
  assert.equal(instance.disconnected, true);
  assert.equal(FakePlayer.instances.length, 1);
  warmSpotifyPlayer();
  await until(() => instance.connects === 3);
  assert.equal(FakePlayer.instances.length, 1);
});
