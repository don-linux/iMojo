import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { SpotifySdkPlayer, type SdkPlayerError } from "./sdkPlayer.ts";
import type { SdkTimer, SpotifyPlayerOptions, SpotifySdk } from "./sdkTypes.ts";

class FakePlayer {
  static instances: FakePlayer[] = [];
  static onConstruct: (() => void) | null = null;
  connected = false;
  disconnected = false;
  activations = 0;
  connects = 0;
  options: SpotifyPlayerOptions;
  private listeners = new Map<string, ((event?: unknown) => void)[]>();
  private release: ((ok: boolean) => void) | null = null;

  constructor(options: SpotifyPlayerOptions) {
    this.options = options;
    FakePlayer.instances.push(this);
    FakePlayer.onConstruct?.();
  }

  connect() {
    this.connects += 1;
    this.connected = true;
    return new Promise<boolean>((resolve) => {
      this.release = resolve;
    });
  }

  finish(ok = true) {
    this.release?.(ok);
  }

  disconnect() {
    this.disconnected = true;
    this.connected = false;
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
    this.activations += 1;
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

function timer(): SdkTimer & { pending: { cb: () => void; ms: number }[] } {
  const pending: { cb: () => void; ms: number }[] = [];
  return {
    pending,
    setTimeout(cb, ms) {
      const handle = { cb, ms };
      pending.push(handle);
      return handle;
    },
    clearTimeout(handle) {
      const index = pending.indexOf(handle as (typeof pending)[number]);
      if (index >= 0) pending.splice(index, 1);
    },
  };
}

const sdk = { Player: FakePlayer as unknown as SpotifySdk["Player"] };

function create(extra: {
  getAccessToken?: (options?: { force?: boolean }) => Promise<string>;
  readSdk?: () => SpotifySdk | undefined;
  loadSdk?: () => Promise<void>;
} = {}) {
  const clock = timer();
  const player = new SpotifySdkPlayer({
    sdk: extra.readSdk ? undefined : sdk,
    readSdk: extra.readSdk,
    loadSdk: extra.loadSdk ?? (async () => {}),
    getAccessToken: extra.getAccessToken ?? (async () => "token"),
    timer: clock,
  });
  return { player, clock };
}

async function until(ready: () => boolean) {
  for (let attempt = 0; attempt < 20 && !ready(); attempt += 1) await Promise.resolve();
  assert.equal(ready(), true);
}

beforeEach(() => {
  FakePlayer.instances = [];
  FakePlayer.onConstruct = null;
});

test("dispose during connect leaves no connected player", async () => {
  const { player } = create();
  const pending = player.connect();
  const shared = player.whenReady();
  await until(() => FakePlayer.instances[0]?.connected === true);
  assert.equal(FakePlayer.instances.length, 1);
  player.dispose();
  FakePlayer.instances[0]?.finish(true);
  await assert.rejects(pending, (reason: unknown) => reason instanceof Error && reason.name === "AbortError");
  await assert.rejects(shared);
  assert.equal(
    FakePlayer.instances.some((item) => item.connected && !item.disconnected),
    false,
  );
  await assert.rejects(player.whenReady());
  assert.equal(FakePlayer.instances.length, 1);
  assert.equal(player.disposed, true);
});

test("disconnects a player constructed after dispose", async () => {
  let player!: SpotifySdkPlayer;
  FakePlayer.onConstruct = () => player.dispose();
  ({ player } = create());
  await assert.rejects(player.whenReady());
  assert.equal(FakePlayer.instances.length, 1);
  assert.equal(FakePlayer.instances[0]?.disconnected, true);
  assert.equal(FakePlayer.instances[0]?.connected, false);
});

test("does not hand an empty token to the SDK", async () => {
  const { player } = create({ getAccessToken: async () => "" });
  const errors: SdkPlayerError[] = [];
  player.on("error", (error) => errors.push(error));
  const pending = player.whenReady();
  await until(() => Boolean(FakePlayer.instances[0]));
  let called = false;
  FakePlayer.instances[0]?.options.getOAuthToken(() => {
    called = true;
  });
  await assert.rejects(pending, /Spotify session expired/);
  assert.equal(called, false);
  assert.equal(errors[0]?.kind, "session");
  assert.equal(errors[0]?.recoverable, false);
});

test("initialization_error rejects ready without waiting out the timeout", async () => {
  const { player, clock } = create();
  const errors: SdkPlayerError[] = [];
  player.on("error", (error) => errors.push(error));
  const pending = player.whenReady();
  await until(() => Boolean(FakePlayer.instances[0]));
  assert.equal(clock.pending.some((item) => item.ms === 15_000), true);
  FakePlayer.instances[0]?.emit("initialization_error", { message: "Unsupported browser" });
  await assert.rejects(pending, /not supported in this browser/);
  assert.equal(clock.pending.length, 0);
  assert.equal(errors[0]?.kind, "initialization");
  await assert.rejects(player.whenReady(), /not supported in this browser/);
  assert.equal(FakePlayer.instances.length, 1);
});

test("not_ready clears the device id so the next connect reuses the player", async () => {
  const { player } = create();
  const pending = player.whenReady();
  await until(() => FakePlayer.instances[0]?.connected === true);
  const instance = FakePlayer.instances[0];
  instance?.emit("ready", { device_id: "sdk-1" });
  instance?.finish(true);
  assert.equal(await pending, "sdk-1");
  instance?.emit("not_ready", { device_id: "sdk-1" });
  assert.equal(player.deviceId, "");
  const again = player.whenReady();
  await until(() => instance?.connects === 2);
  instance?.emit("ready", { device_id: "sdk-2" });
  instance?.finish(true);
  assert.equal(await again, "sdk-2");
  assert.equal(FakePlayer.instances.length, 1);
});

test("activateElement runs synchronously when the SDK is already loaded", () => {
  const { player } = create();
  const errors: SdkPlayerError[] = [];
  player.on("error", (error) => errors.push(error));
  player.activate();
  assert.equal(FakePlayer.instances[0]?.activations, 1);
  FakePlayer.instances[0]?.emit("autoplay_failed");
  assert.deepEqual(errors[0], {
    kind: "autoplay",
    message: "Press play to start playback",
    recoverable: true,
  });
});

test("a gesture before the SDK loads asks for another press", async () => {
  let visible = false;
  const { player } = create({
    readSdk: () => (visible ? sdk : undefined),
    loadSdk: async () => {
      visible = true;
    },
  });
  const errors: SdkPlayerError[] = [];
  player.on("error", (error) => errors.push(error));
  player.activate();
  assert.equal(FakePlayer.instances.length, 0);
  const pending = player.whenReady();
  await until(() => FakePlayer.instances.length === 1);
  FakePlayer.instances[0]?.emit("autoplay_failed");
  assert.equal(errors[0]?.message, "Press play again");
  assert.equal(errors[0]?.recoverable, true);
  FakePlayer.instances[0]?.emit("ready", { device_id: "later" });
  FakePlayer.instances[0]?.finish(true);
  assert.equal(await pending, "later");
});

test("account errors mention premium only when the SDK says so", async () => {
  const { player } = create();
  const errors: SdkPlayerError[] = [];
  player.on("error", (error) => errors.push(error));
  const pending = player.whenReady();
  await until(() => Boolean(FakePlayer.instances[0]));
  FakePlayer.instances[0]?.emit("account_error", { message: "Premium required" });
  FakePlayer.instances[0]?.emit("account_error", { message: "No active device" });
  FakePlayer.instances[0]?.emit("playback_error", { message: "The track is unavailable" });
  await assert.rejects(pending, /Premium is required/);
  assert.equal(errors[0]?.message, "Spotify Premium is required to play");
  assert.equal(errors[0]?.recoverable, false);
  assert.equal(errors[1]?.message, "No active device");
  assert.equal(errors[1]?.kind, "account");
  assert.equal(errors[2]?.message, "The track is unavailable");
  assert.equal(errors[2]?.kind, "playback");
  assert.equal(errors[2]?.recoverable, true);
});

test("authentication failure refreshes once, then ends the session", async () => {
  let forces = 0;
  const { player } = create({
    getAccessToken: async () => {
      forces += 1;
      throw new Error("refresh failed");
    },
  });
  const errors: SdkPlayerError[] = [];
  player.on("error", (error) => errors.push(error));
  const pending = player.whenReady();
  await until(() => Boolean(FakePlayer.instances[0]));
  FakePlayer.instances[0]?.emit("authentication_error", { message: "bad token" });
  await assert.rejects(pending, /Spotify session expired/);
  assert.equal(forces, 1);
  assert.equal(player.disposed, true);
  assert.equal(errors.some((error) => error.message === "Spotify session expired"), true);
  FakePlayer.instances[0]?.emit("authentication_error", { message: "bad token" });
  assert.equal(forces, 1);
});
