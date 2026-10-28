import assert from "node:assert/strict";
import { test } from "node:test";
import { blankMemory, followPlayback, type FollowMemory } from "./stateFollow.ts";
import type { DevicePlaybackState } from "../player/types.ts";

function memory(patch: Partial<FollowMemory> = {}): FollowMemory {
  return {
    ...blankMemory(),
    generation: 1,
    expectedUri: "spotify:track:a",
    windowUris: ["spotify:track:a", "spotify:track:b", "spotify:track:a"],
    windowIndices: [0, 1, 2],
    seen: true,
    suppressZeroEnd: false,
    ...patch,
  };
}

function state(patch: Partial<DevicePlaybackState> & { uri?: string | null }): DevicePlaybackState {
  return {
    paused: patch.paused ?? false,
    position: patch.position ?? 0,
    duration: patch.duration ?? 30_000,
    timestamp: patch.timestamp ?? 1,
    shuffle: patch.shuffle,
    track_window: patch.track_window ?? {
      current_track: { uri: patch.uri === undefined ? "spotify:track:a" : patch.uri },
      previous_tracks: [],
    },
  };
}

test("pausing near the end does not end the track", () => {
  const result = followPlayback(state({ paused: true, position: 29_000, duration: 30_000 }), memory());
  assert.equal(result.kind, "progress");
  assert.equal(result.playing, false);
  assert.equal(result.memory.sawNearEnd, true);
});

test("paused at 0 after a near-end sample ends the track", () => {
  const armed = followPlayback(state({ paused: true, position: 29_000, duration: 30_000 }), memory());
  const ended = followPlayback(state({ paused: true, position: 0, duration: 30_000 }), armed.memory);
  assert.equal(ended.kind, "ended");
});

test("paused at 0 on our uri when previous_tracks contains it ends", () => {
  const result = followPlayback(
    state({
      paused: true,
      position: 0,
      track_window: {
        current_track: { uri: "spotify:track:a" },
        previous_tracks: [{ uri: "spotify:track:a" }],
      },
    }),
    memory({ sawNearEnd: false }),
  );
  assert.equal(result.kind, "ended");
});

test("a uri change advances to the later duplicate, not the earlier one", () => {
  const toB = followPlayback(state({ uri: "spotify:track:b", position: 0 }), memory());
  assert.equal(toB.kind, "advance");
  assert.equal(toB.queueIndex, 1);
  assert.equal(toB.memory.windowPos, 1);
  const toA = followPlayback(state({ uri: "spotify:track:a", position: 20 }), toB.memory);
  assert.equal(toA.kind, "advance");
  assert.equal(toA.queueIndex, 2);
  assert.equal(toA.memory.windowPos, 2);
});

test("a stale uri from before this generation is observed is ignored", () => {
  const result = followPlayback(
    state({ uri: "spotify:track:old", paused: true, position: 0 }),
    memory({ seen: false, expectedUri: "spotify:track:b" }),
  );
  assert.equal(result.kind, "ignore");
});

test("a null state pauses and does not end", () => {
  const result = followPlayback(null, memory({ sawNearEnd: true, lastPositionMs: 29_000 }));
  assert.equal(result.kind, "displaced");
  assert.equal(result.playing, false);
});

test("duration 0 is unknown and cannot end the track", () => {
  const near = followPlayback(state({ paused: true, position: 500, duration: 0 }), memory());
  assert.equal(near.kind, "progress");
  assert.equal(near.memory.sawNearEnd, false);
  const ended = followPlayback(state({ paused: true, position: 0, duration: 0 }), near.memory);
  assert.equal(ended.kind, "progress");
});
