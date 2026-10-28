import assert from "node:assert/strict";
import test from "node:test";
import { createClickPlayer, playClick, unlockClick } from "./clickPlayer.ts";
import {
  audible,
  armed,
  clickWav,
  createFake,
  createTarget,
  drain,
  GESTURES,
  harness,
  type Fake,
} from "./clickPlayerFixture.test.ts";
import { createByteLoader, type ClickContextCtor } from "./clickTypes.ts";


test("module exports do nothing without a window", () => {
  playClick();
  unlockClick();
});

test("keeps a single context across unlock, interrupt, and hiding the page", () => {
  const box = harness();
  box.doc.dispatch("visibilitychange");
  box.win.dispatch("pageshow");
  assert.equal(box.contexts.length, 0);
  box.player.unlockClick();
  box.player.playClick();
  box.player.unlockClick();
  const ctx = box.contexts[0];
  const resumed = ctx.resumeCalls;
  ctx.setState("interrupted");
  box.doc.visibilityState = "hidden";
  box.doc.dispatch("visibilitychange");
  assert.equal(ctx.resumeCalls, resumed);
  box.doc.visibilityState = "visible";
  box.doc.dispatch("visibilitychange");
  box.win.dispatch("pageshow");
  assert.equal(ctx.resumeCalls, resumed + 2);
  box.player.playClick();
  box.player.unlockClick();
  assert.equal(box.contexts.length, 1);
  assert.equal(ctx.gains.length, 1);
  assert.equal(ctx.gains[0].gain.value, 0.3);
  assert.equal(ctx.options?.latencyHint, "interactive");
});

test("resume and the silent start both happen inside unlock", () => {
  const played = harness();
  played.player.playClick();
  assert.equal(played.contexts[0].resumeCalls, 1);
  assert.equal(played.contexts[0].sources.length, 0);
  const box = harness();
  box.player.unlockClick();
  const ctx = box.contexts[0];
  assert.equal(ctx.state, "suspended");
  assert.equal(ctx.resumeCalls, 1);
  assert.equal(ctx.sources.length, 1);
  assert.equal(ctx.sources[0].buffer?.length, 1);
  assert.equal(ctx.sources[0].started, 0);
  assert.equal(ctx.sources[0].connected, ctx.destination);
  ctx.resumeMode = "throw";
  assert.doesNotThrow(() => box.player.unlockClick());
  ctx.resumeMode = "reject";
  assert.doesNotThrow(() => box.player.unlockClick());
  assert.equal(box.contexts.length, 1);
  assert.equal(ctx.sources.length, 3);
});

test("plays one fresh pending click and drops one that is 200ms old", async () => {
  const fresh = harness();
  fresh.player.playClick();
  await drain();
  assert.equal(fresh.contexts[0].sources.length, 0);
  fresh.at(5_000);
  fresh.player.playClick();
  fresh.at(5_100);
  fresh.contexts[0].setState("running");
  const [click] = audible(fresh.contexts[0]);
  assert.ok(click);
  assert.equal(click.started, 0.08);
  assert.equal(click.buffer?.length, 6);
  assert.equal(click.buffer?.numberOfChannels, 2);
  assert.equal(click.buffer?.sampleRate, 48_000);
  const left = click.buffer?.getChannelData(0)[0];
  const right = click.buffer?.getChannelData(1)[0];
  assert.notEqual(left, right);
  click.onended?.();
  assert.equal(click.disconnects, 1);
  fresh.contexts[0].currentTime = 1;
  fresh.player.playClick();
  assert.equal(fresh.contexts.length, 1);
  assert.equal(audible(fresh.contexts[0]).length, 2);

  let release: (bytes: ArrayBuffer | null) => void = () => {};
  const gate = new Promise<ArrayBuffer | null>((resolve) => { release = resolve; });
  const stale = harness(() => gate);
  stale.player.playClick();
  stale.contexts[0].setState("running");
  stale.at(200);
  release(clickWav());
  await drain();
  assert.equal(audible(stale.contexts[0]).length, 0);
});

test("removes gesture listeners once running and re-arms them after interruption", () => {
  const box = harness();
  assert.equal(armed(box.doc), true);
  assert.equal(box.doc.count("visibilitychange"), 1);
  assert.equal(box.doc.captureCount("visibilitychange"), 0);
  assert.equal(box.win.count("pageshow"), 1);
  box.doc.dispatch("keydown", { key: "Escape", repeat: false });
  box.doc.dispatch("keydown", { key: "a", repeat: true });
  assert.equal(box.contexts.length, 0);
  box.doc.dispatch("keydown", { key: "Enter", repeat: false });
  const ctx = box.contexts[0];
  ctx.setState("running");
  assert.equal(GESTURES.every((type) => box.doc.captureCount(type) === 0), true);
  assert.equal(box.doc.count("visibilitychange"), 1);
  ctx.setState("interrupted");
  assert.equal(armed(box.doc), true);
  const resumed = ctx.resumeCalls;
  box.doc.dispatch("pointerup");
  assert.equal(box.contexts.length, 1);
  assert.equal(ctx.resumeCalls, resumed + 1);
});

test("replaces the context only after it closes", () => {
  const box = harness();
  box.player.unlockClick();
  const first = box.contexts[0];
  first.setState("interrupted");
  box.player.unlockClick();
  assert.equal(box.contexts.length, 1);
  first.setState("closed");
  box.player.unlockClick();
  assert.equal(box.contexts.length, 2);
  assert.notEqual(box.contexts[1], first);
  box.player.dispose();
  assert.equal(first.closeCalls + box.contexts[1].closeCalls, 1);
  assert.equal(GESTURES.every((type) => box.doc.captureCount(type) === 0), true);
  assert.equal(box.doc.count("visibilitychange"), 0);
  assert.equal(box.win.count("pageshow"), 0);
});

test("constructs without options when the latency hint is rejected", () => {
  const contexts: Fake[] = [];
  let rejected = 0;
  const doc = createTarget();
  const player = createClickPlayer({
    getConstructor: () => function Ctor(options?: AudioContextOptions) {
      if (options) {
        rejected += 1;
        throw new Error("options unsupported");
      }
      const ctx = createFake(undefined);
      contexts.push(ctx);
      return ctx;
    } as unknown as ClickContextCtor,
    doc, win: createTarget(), now: () => 0, loadBytes: async () => clickWav(),
  });
  player.unlockClick();
  assert.equal(rejected, 1);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].options, undefined);
  player.dispose();
  assert.equal(doc.count("pointerdown"), 0);
});

test("retries a failed byte load and then caches the buffer", async () => {
  const calls: Array<ArrayBuffer | null | "throw"> = [null, "throw", clickWav()];
  let reads = 0;
  const load = createByteLoader(async () => {
    reads += 1;
    const next = calls.shift();
    if (next === "throw") throw new Error("offline");
    return next ?? null;
  });
  assert.equal(await load(), null);
  assert.equal(await load(), null);
  const bytes = await load();
  assert.equal(bytes?.byteLength, clickWav().byteLength);
  assert.equal(await load(), bytes);
  assert.equal(reads, 3);

  let attempts = 0;
  const box = harness(async () => {
    attempts += 1;
    return attempts === 1 ? null : clickWav();
  });
  box.player.unlockClick();
  await drain();
  assert.equal(box.contexts[0].buffers.some((buffer) => buffer.length > 1), false);
  box.player.unlockClick();
  await drain();
  assert.equal(attempts, 2);
  assert.equal(box.contexts[0].buffers.some((buffer) => buffer.length > 1), true);
  box.player.dispose();
});
