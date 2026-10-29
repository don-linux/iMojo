import assert from "node:assert/strict";
import test from "node:test";
import {
  loadSpotifySdk,
  type SdkLoaderDeps,
  type SdkLoaderWindow,
  type SdkScript,
} from "./sdkLoader.ts";
import { SDK_LOAD_TIMEOUT_MS, SDK_SCRIPT_SELECTOR, SDK_SCRIPT_URL } from "./sdkTypes.ts";

type FakeScript = SdkScript & { removed: boolean };

function harness() {
  const scripts: FakeScript[] = [];
  const pending: { cb: () => void; ms: number }[] = [];
  const win: SdkLoaderWindow = {};
  const doc: SdkLoaderDeps["doc"] = {
    querySelector(selector) {
      if (selector !== SDK_SCRIPT_SELECTOR) return null;
      return scripts.find((script) => script.dataset.spotifySdk === "true") ?? null;
    },
    createElement() {
      const script: FakeScript = {
        src: "",
        async: false,
        dataset: {},
        onerror: null,
        removed: false,
        remove() {
          this.removed = true;
          const index = scripts.indexOf(this);
          if (index >= 0) scripts.splice(index, 1);
        },
      };
      return script;
    },
    body: {
      appendChild(node) {
        scripts.push(node as FakeScript);
      },
    },
  };
  const deps: SdkLoaderDeps = {
    doc,
    win,
    timer: {
      setTimeout(cb, ms) {
        const handle = { cb, ms };
        pending.push(handle);
        return handle;
      },
      clearTimeout(handle) {
        const index = pending.indexOf(handle as (typeof pending)[number]);
        if (index >= 0) pending.splice(index, 1);
      },
    },
  };
  return { scripts, pending, win, deps };
}

function sdk() {
  return { Player: class {} as never };
}

test("resolves immediately when the SDK is already on the window", async () => {
  const env = harness();
  env.win.Spotify = sdk();
  await loadSpotifySdk(undefined, env.deps);
  assert.equal(env.scripts.length, 0);
  assert.equal(env.pending.length, 0);
});

test("rejects on script error, removes the tag, and retries with a new tag", async () => {
  const env = harness();
  let chained = 0;
  env.win.onSpotifyWebPlaybackSDKReady = () => {
    chained += 1;
  };
  const first = loadSpotifySdk(undefined, env.deps);
  assert.equal(env.scripts.length, 1);
  assert.equal(env.scripts[0]?.src, SDK_SCRIPT_URL);
  assert.equal(env.scripts[0]?.async, true);
  assert.equal(env.pending[0]?.ms, SDK_LOAD_TIMEOUT_MS);
  env.scripts[0]?.onerror?.();
  await assert.rejects(first, /did not load/);
  assert.equal(env.scripts.length, 0);
  assert.equal(env.pending.length, 0);

  const second = loadSpotifySdk(undefined, env.deps);
  assert.equal(env.scripts.length, 1);
  env.win.Spotify = sdk();
  env.win.onSpotifyWebPlaybackSDKReady?.();
  await second;
  assert.equal(chained, 1);
});

test("rejects when the script does not become ready within 10 seconds", async () => {
  const env = harness();
  const pending = loadSpotifySdk(undefined, env.deps);
  const script = env.scripts[0];
  assert.equal(env.pending[0]?.ms, 10_000);
  env.pending[0]?.cb();
  await assert.rejects(pending, /did not load/);
  assert.equal(script?.removed, true);
  assert.equal(env.scripts.length, 0);
});

test("injects the script once while a load is already in flight", async () => {
  const env = harness();
  const first = loadSpotifySdk(undefined, env.deps);
  const second = loadSpotifySdk(undefined, env.deps);
  assert.equal(env.scripts.length, 1);
  env.win.Spotify = sdk();
  env.win.onSpotifyWebPlaybackSDKReady?.();
  await Promise.all([first, second]);
});

test("still resolves when a previously installed ready hook throws", async () => {
  const env = harness();
  env.win.onSpotifyWebPlaybackSDKReady = () => {
    throw new Error("older hook");
  };
  const pending = loadSpotifySdk(undefined, env.deps);
  env.win.Spotify = sdk();
  env.win.onSpotifyWebPlaybackSDKReady?.();
  await pending;
});
