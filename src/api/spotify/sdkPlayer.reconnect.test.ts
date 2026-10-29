import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { SpotifySdkPlayer, type SdkPlayerError } from "./sdkPlayer.ts";
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

const sdk = { Player: FakePlayer as unknown as SpotifySdk["Player"] };

function create(getAccessToken?: (options?: { force?: boolean }) => Promise<string>) {
  return new SpotifySdkPlayer({
    sdk,
    loadSdk: async () => {},
    getAccessToken: getAccessToken ?? (async () => "token"),
    timer: {
      setTimeout: () => ({}),
      clearTimeout: () => {},
    },
  });
}

async function until(ready: () => boolean) {
  for (let attempt = 0; attempt < 20 && !ready(); attempt += 1) await Promise.resolve();
  assert.equal(ready(), true);
}

beforeEach(() => {
  FakePlayer.instances = [];
});

test("authentication_error reconnects once after a forced refresh", async () => {
  const gate: { resolve: ((token: string) => void) | null } = { resolve: null };
  let reads = 0;
  const player = create((options) => {
    reads += 1;
    assert.equal(options?.force, true);
    return new Promise<string>((resolve) => {
      gate.resolve = resolve;
    });
  });
  const errors: SdkPlayerError[] = [];
  player.on("error", (error) => errors.push(error));
  const pending = player.whenReady();
  await until(() => FakePlayer.instances[0]?.connects === 1);
  const instance = FakePlayer.instances[0]!;
  instance.emit("authentication_error", { message: "expired" });
  instance.emit("authentication_error", { message: "expired again" });
  await Promise.resolve();
  assert.equal(reads, 1);
  assert.equal(player.disposed, false);
  assert.equal(errors.length, 0);
  assert.equal(instance.connects, 1);
  gate.resolve?.("fresh-token");
  await until(() => instance.connects === 2);
  instance.emit("ready", { device_id: "device" });
  instance.finish(true);
  assert.equal(await pending, "device");
  assert.equal(player.disposed, false);
  assert.equal(FakePlayer.instances.length, 1);
});

test("authentication_error after the reconnect expires the session", async () => {
  const player = create(async () => "fresh-token");
  const pending = player.whenReady();
  await until(() => FakePlayer.instances[0]?.connects === 1);
  const instance = FakePlayer.instances[0]!;
  instance.emit("authentication_error", { message: "expired" });
  await until(() => instance.connects === 2);
  instance.emit("authentication_error", { message: "still bad" });
  await assert.rejects(pending, /Spotify session expired/);
  assert.equal(player.disposed, true);
});

test("disconnect keeps one player and ignores a stale ready event", async () => {
  const player = create();
  const pending = player.whenReady();
  await until(() => FakePlayer.instances[0]?.connects === 1);
  const instance = FakePlayer.instances[0]!;
  instance.emit("ready", { device_id: "sdk-1" });
  instance.finish(true);
  assert.equal(await pending, "sdk-1");
  player.disconnect();
  assert.equal(player.disposed, false);
  assert.equal(player.deviceId, "");
  assert.equal(instance.disconnected, true);
  instance.emit("ready", { device_id: "stale" });
  assert.equal(player.deviceId, "");
  const again = player.whenReady();
  await until(() => instance.connects === 2);
  assert.equal(FakePlayer.instances.length, 1);
  instance.emit("ready", { device_id: "sdk-2" });
  instance.finish(true);
  assert.equal(await again, "sdk-2");
});
