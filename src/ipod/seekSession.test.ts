import assert from "node:assert/strict";
import test from "node:test";
import { createManualSchedule } from "./idleLatch.ts";
import { SEEK_COMMIT_MS } from "./playbackTiming.ts";
import { createSeekSession, type SeekTrack } from "./seekSession.ts";

type Deferred = { resolve: () => void; reject: (reason: unknown) => void };

function setup(options?: { hang?: boolean; currentTime?: number; duration?: number }) {
  const clock = createManualSchedule();
  const sends: number[] = [];
  const pending: Deferred[] = [];
  let time = options?.currentTime ?? 12;
  let duration = options?.duration ?? 100;
  let track: SeekTrack = { id: "a", index: 0, queue: ["a"], hasLoaded: true };
  const session = createSeekSession({
    schedule: clock.schedule,
    getClock: () => ({ currentTime: time, duration }),
    getTrack: () => track,
    seekTo: (seconds) => {
      sends.push(seconds);
      if (!options?.hang) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        pending.push({ resolve, reject });
      });
    },
  });
  return {
    clock,
    sends,
    pending,
    session,
    setTrack(next: SeekTrack) {
      track = next;
    },
    setClock(nextTime: number, nextDuration = duration) {
      time = nextTime;
      duration = nextDuration;
    },
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

test("wheel scrub commits the latest target once, a second later", async () => {
  const { clock, session, sends } = setup();
  session.toggle();
  assert.equal(session.seekTo(10), true);
  clock.advance(SEEK_COMMIT_MS - 100);
  session.seekTo(20);
  session.seekTo(30);
  clock.advance(SEEK_COMMIT_MS - 1);
  assert.deepEqual(sends, []);
  clock.advance(1);
  assert.deepEqual(sends, [30]);
  clock.advance(SEEK_COMMIT_MS);
  assert.deepEqual(sends, [30]);
  await flush();
  assert.equal(session.view().preview, undefined);
});

test("a range commit sends immediately and cancels the debounce", () => {
  const { clock, session, sends } = setup();
  session.toggle();
  session.seekTo(15);
  session.commit();
  assert.deepEqual(sends, [15]);
  clock.advance(SEEK_COMMIT_MS);
  assert.deepEqual(sends, [15]);
});

test("a held wheel blocks the commit until it is released", () => {
  const { clock, session, sends } = setup();
  session.toggle();
  session.seekTo(10);
  clock.advance(400);
  session.dragStart();
  clock.advance(SEEK_COMMIT_MS);
  session.seekTo(18);
  session.seekTo(21);
  clock.advance(SEEK_COMMIT_MS + 500);
  assert.deepEqual(sends, []);
  session.dragEnd();
  clock.advance(SEEK_COMMIT_MS - 1);
  assert.deepEqual(sends, []);
  clock.advance(1);
  assert.deepEqual(sends, [21]);
});

test("a resolved seek is ignored once a newer target exists", async () => {
  const { clock, session, pending } = setup({ hang: true });
  session.toggle();
  session.seekTo(10);
  clock.advance(SEEK_COMMIT_MS);
  session.seekTo(25);
  assert.equal(session.view().preview, 25);
  pending[0]?.resolve();
  await flush();
  assert.equal(session.view().preview, 25);
  assert.equal(session.isSeeking(), true);
});

test("rejection snaps the preview back to the clock", async () => {
  const { clock, session, pending, setClock } = setup({ hang: true, currentTime: 12 });
  session.toggle();
  assert.equal(session.seekTo(40), true);
  clock.advance(SEEK_COMMIT_MS);
  setClock(9);
  const request = pending[0];
  assert.ok(request);
  request.reject(new Error("fail"));
  await flush();
  assert.equal(session.view().preview, 9);
  assert.equal(session.isSeeking(), true);
});

test("track changes drop the pending scrub and ignore an in-flight result", async () => {
  const dropped = setup();
  dropped.session.toggle();
  dropped.session.seekTo(22);
  dropped.setTrack({ id: "b", index: 1, queue: ["b"], hasLoaded: true });
  dropped.session.syncTrack();
  assert.equal(dropped.session.isSeeking(), false);
  assert.equal(dropped.session.view().preview, undefined);
  assert.deepEqual(dropped.sends, []);

  const flight = setup({ hang: true, currentTime: 4 });
  flight.session.keepOpen();
  flight.session.seekTo(40);
  flight.clock.advance(SEEK_COMMIT_MS);
  flight.setTrack({ id: "b", index: 1, queue: ["b"], hasLoaded: true });
  flight.session.syncTrack();
  assert.equal(flight.session.isSeeking(), true);
  assert.equal(flight.session.view().preview, undefined);
  flight.session.seekTo(5);
  flight.pending[0]?.resolve();
  await flush();
  assert.equal(flight.session.view().preview, 5);

  const failed = setup({ hang: true, currentTime: 4 });
  failed.session.keepOpen();
  failed.session.seekTo(40);
  failed.clock.advance(SEEK_COMMIT_MS);
  failed.setTrack({ id: "c", index: 2, queue: ["c"], hasLoaded: false });
  failed.session.syncTrack();
  failed.pending[0]?.reject(new Error("fail"));
  await flush();
  assert.equal(failed.session.isSeeking(), false);
  assert.equal(failed.session.view().preview, undefined);
});

test("non-finite targets and unknown durations do not seek", () => {
  const { session, sends, setClock } = setup();
  session.toggle();
  assert.equal(session.seekTo(Number.NaN), false);
  assert.equal(session.seekBy(Number.POSITIVE_INFINITY), false);
  setClock(12, 0);
  assert.equal(session.seekTo(8), false);
  setClock(12, Number.NaN);
  assert.equal(session.seekTo(8), false);
  setClock(12, Number.POSITIVE_INFINITY);
  assert.equal(session.seekTo(8), false);
  assert.equal(session.view().preview, undefined);
  assert.deepEqual(sends, []);
  setClock(12.8, 90);
  assert.equal(session.seekBy(3), true);
  assert.equal(session.view().preview, 15);
  assert.equal(session.seekTo(120), true);
  assert.equal(session.view().preview, 90);
});
