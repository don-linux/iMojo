import assert from "node:assert/strict";
import { afterEach, before, beforeEach, test } from "node:test";
import { writeClientId, writeProfile, writeTokens } from "./storage.ts";
import { SpotifyTransport, playRequestBody } from "./transport.ts";
import type { SpotifySdkPlayer } from "./sdkPlayer.ts";

test("play requests address duplicates by window position", () => {
  assert.deepEqual(
    playRequestBody({
      uris: ["spotify:track:a", "spotify:track:a"],
      queueIndices: [0, 2],
      offset: 1,
      positionMs: 0,
    }),
    { uris: ["spotify:track:a", "spotify:track:a"], offset: { position: 1 } },
  );
});

const CLIENT_ID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function installStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, String(value));
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() {
        return values.size;
      },
    },
  });
}

function installDesktop() {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { isSecureContext: true },
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

before(() => {
  installStorage();
});

beforeEach(() => {
  localStorage.clear();
  installDesktop();
  writeClientId(CLIENT_ID);
  writeTokens({ accessToken: "token", refreshToken: "refresh", expiresAt: Date.now() + 3_600_000 });
  writeProfile({ id: "user", name: "User", product: "premium" });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "navigator");
});

test("player state turns shuffle and repeat off again after align", async () => {
  const urls: string[] = [];
  const held: Array<() => void> = [];
  globalThis.fetch = (input) => {
    const url = String(input);
    urls.push(url);
    const shuffleHits = urls.filter((item) => item.includes("/shuffle")).length;
    const repeatHits = urls.filter((item) => item.includes("/repeat?state=off")).length;
    if ((url.includes("/shuffle") && shuffleHits > 1) || (url.includes("/repeat?state=off") && repeatHits > 1)) {
      return new Promise((resolve) => {
        held.push(() => resolve(new Response(null, { status: 204 })));
      });
    }
    if (url.includes("/devices")) {
      return Promise.resolve(json({ devices: [{ id: "device-1", name: "iPod", is_restricted: false }] }));
    }
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  const player = {
    deviceId: "device-1",
    whenReady: async () => "device-1",
    pause: async () => {},
    resume: async () => {},
    seek: async () => {},
    setVolume: () => {},
    getCurrentState: async () => null,
  };
  const transport = new SpotifyTransport(() => player as unknown as SpotifySdkPlayer);
  await transport.playWindow(
    { uris: ["spotify:track:a"], queueIndices: [0], offset: 0 },
    new AbortController().signal,
  );
  const shuffleCount = () => urls.filter((url) => url.includes("/me/player/shuffle?state=false")).length;
  const repeatCount = () => urls.filter((url) => url.includes("/me/player/repeat?state=off")).length;
  assert.equal(shuffleCount(), 1);
  assert.equal(repeatCount(), 1);

  transport.observeState({
    paused: false,
    position: 1_000,
    duration: 30_000,
    timestamp: 1,
    shuffle: true,
    repeat_mode: 2,
    track_window: { current_track: { uri: "spotify:track:a" } },
  });
  await Promise.resolve();
  assert.equal(shuffleCount(), 2);
  assert.equal(repeatCount(), 2);

  transport.observeState({
    paused: false,
    position: 1_100,
    duration: 30_000,
    timestamp: 2,
    shuffle: true,
    repeat_mode: 1,
    track_window: { current_track: { uri: "spotify:track:a" } },
  });
  await Promise.resolve();
  assert.equal(shuffleCount(), 2);
  assert.equal(repeatCount(), 2);

  for (const release of held) release();
  for (let step = 0; step < 6; step += 1) await Promise.resolve();
  transport.observeState({
    paused: true,
    position: 1_200,
    duration: 30_000,
    timestamp: 3,
    shuffle: true,
    repeat_mode: 0,
    track_window: { current_track: { uri: "spotify:track:a" } },
  });
  await Promise.resolve();
  assert.equal(shuffleCount(), 3);
  assert.equal(repeatCount(), 2);
});
