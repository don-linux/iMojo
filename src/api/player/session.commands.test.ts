import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlayerSession } from "./session.ts";
import { deviceState, fakeTransport, track, until } from "./sessionKit.ts";
import { PlaybackFailure } from "./types.ts";

test("a superseded play cannot change the current track when it completes late", async () => {
  const fake = fakeTransport();
  const gate: { release: (() => void) | null } = { release: null };
  fake.setPlay((_window, signal) => {
    if (fake.plays.length === 1) {
      return new Promise((resolve) => {
        gate.release = () => resolve();
        signal.addEventListener("abort", () => {}, { once: true });
      });
    }
    return Promise.resolve();
  });
  const session = createPlayerSession({ transport: fake.transport });
  session.playQueue([track("a"), track("b")], 0);
  await until(() => fake.plays.length === 1);
  session.playQueue([track("a"), track("b")], 1);
  assert.equal(fake.plays[0]?.signal.aborted, true);
  assert.equal(session.getSnapshot().index, 1);
  gate.release?.();
  await session.idle();
  assert.equal(session.getSnapshot().index, 1);
  assert.equal(fake.plays.at(-1)?.uris[0], "spotify:track:b");
  session.ingest(deviceState("spotify:track:a", { paused: true, position: 0 }));
  assert.equal(session.getSnapshot().index, 1);
  assert.equal(session.getSnapshot().finished, false);
});

test("stale end state and a null device state do not steal playback", async () => {
  const fake = fakeTransport();
  const gate: { release: (() => void) | null } = { release: null };
  fake.setPlay(() => new Promise((resolve) => {
    gate.release = () => resolve();
  }));
  const session = createPlayerSession({ transport: fake.transport });
  session.playQueue([track("a"), track("b")], 0);
  await until(() => fake.plays.length === 1);
  gate.release?.();
  await session.idle();
  session.ingest(deviceState("spotify:track:a", { position: 1000 }));
  fake.setPlay(() => new Promise((resolve) => {
    gate.release = () => resolve();
  }));
  session.next();
  await until(() => fake.plays.length === 2);
  session.ingest(deviceState("spotify:track:a", { paused: true, position: 0 }));
  assert.equal(session.getSnapshot().index, 1);
  assert.equal(session.getSnapshot().finished, false);
  gate.release?.();
  await session.idle();
  session.ingest(deviceState("spotify:track:b", { position: 500 }));
  const plays = fake.plays.length;
  session.ingest(null);
  assert.equal(session.getSnapshot().playing, false);
  assert.equal(fake.plays.length, plays);
  assert.equal(fake.resumes.length, 0);
});

test("browser support fails before loading and auth failure stops", async () => {
  const blocked = fakeTransport();
  blocked.setSupport("Spotify playback needs DRM support");
  const denied = createPlayerSession({ transport: blocked.transport });
  denied.playQueue([track("a")], 0);
  await denied.idle();
  assert.equal(denied.getSnapshot().error, "Spotify playback needs DRM support");
  assert.equal(denied.getSnapshot().loading, false);
  assert.equal(blocked.plays.length, 0);

  const expired = fakeTransport();
  expired.setPlay(async () => {
    throw new PlaybackFailure("Spotify session expired", "stop");
  });
  const session = createPlayerSession({ transport: expired.transport });
  session.playQueue([track("a")], 0);
  await session.idle();
  assert.equal(session.getSnapshot().error, "Spotify session expired");
  assert.equal(session.getSnapshot().playing, false);
  assert.equal(session.getSnapshot().queue.length, 1);
});

test("an aborted play does not surface a rate-limit error", async () => {
  const fake = fakeTransport();
  fake.setPlay((_window, signal) => {
    if (fake.plays.length > 1) return Promise.resolve();
    return new Promise((_resolve, reject) => {
      const abort = () => {
        const error = new Error("Spotify is rate limiting requests. Wait a moment and try again.");
        error.name = "AbortError";
        reject(error);
      };
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
  });
  const session = createPlayerSession({ transport: fake.transport });
  session.playQueue([track("a"), track("b")], 0);
  await until(() => fake.plays.length === 1);
  session.playQueue([track("a"), track("b")], 1);
  await session.idle();
  assert.equal(session.getSnapshot().error, null);
  assert.equal(session.getSnapshot().index, 1);
});

test("sdk account and session errors are shown without dropping the track", async () => {
  const fake = fakeTransport();
  const session = createPlayerSession({ transport: fake.transport });
  session.playQueue([track("a")], 0);
  await session.idle();
  session.reportSdkError("account", "Spotify Premium is required to play");
  assert.equal(session.getSnapshot().error, "Spotify Premium is required to play");
  assert.equal(session.getSnapshot().queue.length, 1);
  session.reportSdkError("authentication", "Spotify session expired");
  assert.equal(session.getSnapshot().error, "Spotify session expired");
  assert.equal(session.getSnapshot().playing, false);
  assert.equal(session.getSnapshot().queue[0]?.id, "a");
});

test("unavailable tracks use the renamed error copy", async () => {
  const fake = fakeTransport();
  const session = createPlayerSession({ transport: fake.transport });
  session.configure({
    shuffle: false,
    repeat: "off",
    resolve: async () => null,
  });
  session.playQueue([track("a")], 0);
  await session.idle();
  assert.equal(session.getSnapshot().error, "This track is unavailable");
  assert.equal(session.getSnapshot().loading, false);
});
