import assert from "node:assert/strict";
import test from "node:test";
import {
  displayIndex,
  initialNavState,
  navigationReducer,
  playPosition,
  playingRowIndex,
  resolveIndex,
  type NavState,
} from "./navigationReducer.ts";

const play = (id: string) => ({ id, action: "play" as const });

test("resolveIndex keeps a hinted row, including a later duplicate", () => {
  const rows = [play("a"), play("b"), play("a")];
  assert.equal(resolveIndex(rows, { index: 2, rowId: "a" }), 2);
  assert.equal(resolveIndex(rows, { index: 0, rowId: "a" }), 0);
});

test("resolveIndex uses the first match when the hint moved", () => {
  const rows = [play("a"), play("b"), play("a")];
  assert.equal(resolveIndex(rows, { index: 1, rowId: "a" }), 0);
  assert.equal(resolveIndex([play("c")], { index: 0, rowId: "c" }), 0);
});

test("resolveIndex follows an insert, a reorder, and a deleted row", () => {
  assert.equal(
    resolveIndex([play("x"), play("a"), play("b"), play("c")], { index: 2, rowId: "c" }),
    3,
  );
  assert.equal(resolveIndex([play("c"), play("a"), play("b")], { index: 2, rowId: "c" }), 0);
  assert.equal(resolveIndex([play("a"), play("b")], { index: 2, rowId: "c" }), 0);
  assert.equal(resolveIndex([play("a"), play("b")], { index: 1 }), 0);
});

test("resolveIndex keeps a pending playlist row until the tracks load", () => {
  const pending = { index: 4, rowId: "track-9" };
  const loading = [{ id: "loading", action: "info" }];
  assert.equal(resolveIndex(loading, pending, { playlistLoaded: false }), 4);
  const loaded = [play("track-1"), play("track-9"), play("track-9")];
  assert.equal(resolveIndex(loaded, pending, { playlistLoaded: true }), 1);
  assert.equal(resolveIndex(loading, pending, { playlistLoaded: true }), 0);
});

test("playing row and play position use the row position when ids repeat", () => {
  const rows = [play("a"), play("b"), play("a")];
  const queue = [{ id: "a" }, { id: "b" }, { id: "a" }];
  assert.equal(playingRowIndex(rows, queue, 2, false), 2);
  assert.equal(playingRowIndex(rows, queue, 0, false), 0);
  assert.equal(playingRowIndex(rows, [{ id: "a" }], 0, false), -1);
  assert.equal(playingRowIndex(rows, queue, 2, true), -1);
  assert.equal(playPosition(rows, 2), 2);
  assert.equal(playPosition([{ action: "info" }, play("a"), play("a")], 2), 1);
  assert.equal(playPosition(rows, 3), -1);
  const playback = { queue, index: 2, finished: false };
  assert.equal(displayIndex(rows, { index: 0, rowId: "a", followPlaying: true }, playback), 2);
  assert.equal(displayIndex(rows, { index: 0, rowId: "a", followPlaying: false }, playback), 0);
});

test("pop restores the row id after the list is reordered", () => {
  let state = navigationReducer(initialNavState(), {
    type: "push",
    frame: { id: "playlist", param: "p", index: 2, rowId: "c", followPlaying: true },
    leaving: { index: 0, rowId: "playlists" },
  });
  state = navigationReducer(state, {
    type: "push",
    frame: { id: "now-playing", index: 0, followPlaying: true },
    leaving: { index: 2, rowId: "c" },
  });
  const rows = [play("a"), play("c"), play("b")];
  const buried = state.stack[1];
  assert.equal(buried?.rowId, "c");
  const index = resolveIndex(rows, buried ?? { index: 0 }, { playlistLoaded: true });
  assert.equal(index, 1);
  state = navigationReducer(state, {
    type: "pop",
    leaving: null,
    restored: { index, rowId: rows[index]?.id },
  });
  assert.equal(state.stack.at(-1)?.id, "playlist");
  assert.equal(state.stack.at(-1)?.index, 1);
  assert.equal(state.stack.at(-1)?.rowId, "c");
  assert.equal(state.stack.at(-1)?.followPlaying, true);
  assert.deepEqual(state.remembered.get("playlist:p"), { index: 1, rowId: "c" });
});

test("move clears follow and replace restores it", () => {
  let state = navigationReducer(initialNavState(), { type: "move", index: 2, rowId: "songs" });
  assert.equal(state.stack[0]?.followPlaying, false);
  assert.equal(state.stack[0]?.index, 2);
  assert.equal(state.stack[0]?.rowId, "songs");
  state = navigationReducer(state, { type: "replace", followPlaying: true });
  assert.equal(state.stack[0]?.followPlaying, true);
  assert.equal(state.stack[0]?.index, 2);
  assert.equal(navigationReducer(state, { type: "replace", followPlaying: true }), state);
});

test("queue end clears now-playing memory and parks the main menu", () => {
  const state: NavState = {
    stack: [
      { id: "main", index: 4, rowId: "now-playing", followPlaying: true },
      { id: "now-playing", index: 0, followPlaying: true },
    ],
    remembered: new Map([
      ["main:", { index: 4, rowId: "now-playing" }],
      ["now-playing:", { index: 0, rowId: "x" }],
    ]),
  };
  const next = navigationReducer(state, { type: "queueEnded" });
  assert.equal(next.stack.length, 1);
  assert.equal(next.stack[0]?.id, "main");
  assert.equal(next.stack[0]?.index, 0);
  assert.equal(next.stack[0]?.rowId, undefined);
  assert.equal(next.remembered.has("main:"), false);
  assert.equal(next.remembered.has("now-playing:"), false);
});

test("queue end keeps a buried menu selection that is not now playing", () => {
  let state = navigationReducer(initialNavState(), {
    type: "push",
    frame: { id: "songs", index: 4, rowId: "t", followPlaying: true },
    leaving: { index: 2, rowId: "songs" },
  });
  state = navigationReducer(state, {
    type: "push",
    frame: { id: "now-playing", index: 0, followPlaying: true },
    leaving: { index: 4, rowId: "t" },
  });
  state = {
    ...state,
    remembered: new Map([...state.remembered, ["now-playing:", { index: 0, rowId: "t" }]]),
  };
  const ended = navigationReducer(state, { type: "queueEnded" });
  assert.equal(ended.stack.length, 2);
  assert.equal(ended.stack[0]?.index, 2);
  assert.equal(ended.stack[0]?.rowId, "songs");
  assert.equal(ended.stack[1]?.id, "songs");
  assert.equal(ended.stack[1]?.index, 4);
  assert.equal(ended.stack[1]?.rowId, "t");
  assert.equal(ended.stack[1]?.followPlaying, true);
  assert.equal(ended.remembered.has("now-playing:"), false);
  assert.deepEqual(ended.remembered.get("songs:"), { index: 4, rowId: "t" });
});

test("queue end is a no-op when nothing points at now playing", () => {
  const state = initialNavState();
  assert.equal(navigationReducer(state, { type: "queueEnded" }), state);
  assert.equal(navigationReducer(state, { type: "pop", leaving: null, restored: { index: 0 } }), state);
});
