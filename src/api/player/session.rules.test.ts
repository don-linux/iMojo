import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlayerSession } from "./session.ts";
import { deviceState, fakeTransport, track } from "./sessionKit.ts";

test("previous restarts after 3 seconds and otherwise steps back", async () => {
  const fake = fakeTransport();
  const session = createPlayerSession({ transport: fake.transport });
  session.playQueue([track("a"), track("b")], 1);
  await session.idle();
  session.ingest(deviceState("spotify:track:b", { position: 4000 }));
  session.previous();
  await session.idle();
  assert.equal(session.getSnapshot().index, 1);
  assert.ok(fake.seeks.includes(0));
  assert.equal(fake.plays.length, 1);

  session.ingest(deviceState("spotify:track:b", { position: 1000 }));
  session.previous();
  await session.idle();
  assert.equal(session.getSnapshot().index, 0);
  assert.equal(fake.plays.at(-1)?.uris[0], "spotify:track:a");
});

test("seek lands in the last two seconds without skipping", async () => {
  const fake = fakeTransport();
  const session = createPlayerSession({ transport: fake.transport });
  session.playQueue([track("a", 10_000), track("b", 10_000)], 0);
  await session.idle();
  await session.seekTo(9);
  await session.seekTo(9.5);
  await session.seekTo(Number.NaN);
  assert.deepEqual(fake.seeks, [9000, 9500]);
  assert.equal(fake.plays.length, 1);
  assert.equal(session.getSnapshot().index, 0);
});

test("three rapid seeks send at most two transport calls and keep the last target", async () => {
  const fake = fakeTransport();
  const pending: Array<() => void> = [];
  fake.setSeek((ms) => {
    assert.ok(ms >= 0);
    return new Promise((resolve) => pending.push(resolve));
  });
  const session = createPlayerSession({ transport: fake.transport });
  session.playQueue([track("a")], 0);
  await session.idle();
  const first = session.seekTo(1);
  const second = session.seekTo(2);
  const third = session.seekTo(3);
  assert.deepEqual(fake.seeks, [1000]);
  pending.shift()?.();
  await first;
  await second;
  assert.deepEqual(fake.seeks, [1000, 3000]);
  pending.shift()?.();
  await third;
  assert.equal(session.getSnapshot().index, 0);
});

test("volume changes coalesce to the latest value", async () => {
  const fake = fakeTransport();
  const queued: { fire: (() => void) | null } = { fire: null };
  const session = createPlayerSession({
    transport: fake.transport,
    scheduleVolume: (callback) => {
      queued.fire = callback;
      return () => {
        queued.fire = null;
      };
    },
  });
  session.setVolume(0.2);
  session.setVolume(0.4);
  session.setVolume(Number.NaN);
  session.setVolume(0.9);
  assert.deepEqual(fake.volumes, []);
  assert.equal(session.getVolume(), 0.9);
  queued.fire?.();
  assert.deepEqual(fake.volumes, [0.9]);
});

test("a stale volume completion does not schedule the old value again", async () => {
  const fake = fakeTransport();
  const hanging: Array<() => void> = [];
  fake.setVolumeImpl(() => new Promise((resolve) => hanging.push(resolve)));
  const queued: { fire: (() => void) | null } = { fire: null };
  const session = createPlayerSession({
    transport: fake.transport,
    scheduleVolume: (callback) => {
      queued.fire = callback;
      return () => {
        queued.fire = null;
      };
    },
  });
  session.setVolume(0.2);
  queued.fire?.();
  assert.deepEqual(fake.volumes, [0.2]);
  session.setExternalVolume(0.8);
  assert.deepEqual(fake.volumes, [0.2, 0.8]);
  hanging.shift()?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(fake.volumes, [0.2, 0.8]);
  assert.equal(session.getVolume(), 0.8);
});

test("shuffle keeps the current track first", async () => {
  const fake = fakeTransport();
  const session = createPlayerSession({ transport: fake.transport, random: () => 0 });
  session.setShuffle(true);
  session.playQueue([track("a"), track("b"), track("c"), track("d")], 2);
  await session.idle();
  const snapshot = session.getSnapshot();
  assert.equal(snapshot.index, 2);
  assert.equal(snapshot.orderPos, 0);
  assert.equal(snapshot.displayIndex, 1);
  assert.equal(fake.plays[0]?.uris[0], "spotify:track:c");
  assert.equal(new Set(fake.plays[0]?.uris).size, 4);
});

test("repeat one restarts and repeat all wraps", async () => {
  const one = fakeTransport();
  const repeated = createPlayerSession({ transport: one.transport });
  repeated.setRepeat("one");
  repeated.playQueue([track("a"), track("b")], 0);
  await repeated.idle();
  assert.deepEqual(one.plays[0]?.uris, ["spotify:track:a"]);
  repeated.ingest(deviceState("spotify:track:a", { position: 29_000, paused: true }));
  repeated.ingest(deviceState("spotify:track:a", { position: 0, paused: true }));
  await repeated.idle();
  assert.equal(repeated.getSnapshot().index, 0);
  assert.equal(repeated.getSnapshot().finished, false);
  assert.ok(one.seeks.includes(0));

  const all = fakeTransport();
  let finished = 0;
  const wrapped = createPlayerSession({ transport: all.transport });
  wrapped.configure({
    shuffle: false,
    repeat: "all",
    resolve: async (item) => ({ url: `spotify:track:${item.id}`, kind: "full" }),
    onQueueFinished: () => {
      finished += 1;
    },
  });
  wrapped.playQueue([track("a"), track("b")], 1);
  await wrapped.idle();
  wrapped.ingest(deviceState("spotify:track:b", { position: 29_000, paused: true }));
  wrapped.ingest(deviceState("spotify:track:b", { position: 0, paused: true }));
  await wrapped.idle();
  assert.equal(finished, 0);
  assert.equal(wrapped.getSnapshot().index, 0);
  assert.equal(all.plays.at(-1)?.uris[0], "spotify:track:a");
});

test("the queue finishes once and stop resets the index", async () => {
  const fake = fakeTransport();
  let finished = 0;
  const session = createPlayerSession({ transport: fake.transport });
  session.configure({
    shuffle: false,
    repeat: "off",
    resolve: async (item) => ({ url: `spotify:track:${item.id}`, kind: "full" }),
    onQueueFinished: () => {
      finished += 1;
    },
  });
  session.playQueue([track("a")], 0);
  await session.idle();
  session.ingest(deviceState("spotify:track:a", { position: 29_000, paused: true }));
  session.ingest(deviceState("spotify:track:a", { position: 0, paused: true }));
  session.ingest(deviceState("spotify:track:a", { position: 0, paused: true }));
  assert.equal(finished, 1);
  assert.equal(session.getSnapshot().finished, true);
  assert.equal(session.getSnapshot().index, -1);
  assert.equal(session.playbackSnapshot().index, -1);

  const stopped = createPlayerSession({ transport: fakeTransport().transport });
  stopped.playQueue([track("a"), track("b")], 1);
  await stopped.idle();
  stopped.stop();
  assert.equal(stopped.getSnapshot().index, -1);
  assert.equal(stopped.playbackSnapshot().index, -1);
  assert.equal(stopped.getSnapshot().queue.length, 0);
  assert.equal(stopped.getSnapshot().finished, false);
});

test("device shuffle is corrected from sdk state and toggle uses reconciled playback", async () => {
  const fake = fakeTransport();
  const session = createPlayerSession({ transport: fake.transport });
  session.playQueue([track("a")], 0);
  await session.idle();
  session.ingest(deviceState("spotify:track:a", { position: 1000, shuffle: true }));
  session.ingest(deviceState("spotify:track:a", { position: 1200, shuffle: true }));
  assert.equal(fake.shuffleFixes(), 2);
  session.ingest(deviceState("spotify:track:a", { position: 29_000, paused: true }));
  assert.equal(session.getSnapshot().playing, false);
  session.toggle();
  await session.idle();
  assert.equal(fake.resumes.length, 1);
});
