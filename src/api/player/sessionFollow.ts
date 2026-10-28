import { adjacentQueueIndex, orderPosition } from "./order.ts";
import { startPlay } from "./sessionPlay.ts";
import { assign, playingOf, trackAt, type SessionCore } from "./sessionHost.ts";
import { blankMemory, followPlayback } from "../spotify/stateFollow.ts";
import { isAbortError, PlaybackFailure, type DevicePlaybackState } from "./types.ts";

const UNAVAILABLE = "This track is unavailable";

export function ingest(core: SessionCore, state: DevicePlaybackState | null) {
  if (core.state.finished) return;
  if (!core.accepting) return;
  const result = followPlayback(state, core.memory);
  if (result.shuffle) core.transport.disableDeviceShuffle?.();
  if (result.kind === "ignore") return;
  if (result.kind === "displaced") {
    core.memory = result.memory;
    displace(core);
    return;
  }
  core.memory = result.memory;
  if (result.kind === "ended") {
    core.optimistic = null;
    core.sdkPlaying = false;
    core.clock.setPaused(true);
    assign(core, {});
    handleEnded(core);
    return;
  }
  core.optimistic = null;
  core.sdkPlaying = result.playing;
  const durationMs =
    result.durationMs > 0 ? result.durationMs : (trackAt(core, result.queueIndex)?.durationMs ?? 0);
  core.clock.note({
    positionMs: result.positionMs,
    timestamp: result.timestamp,
    durationMs,
    paused: !result.playing,
    generation: core.loadedEpoch,
  });
  if (result.queueIndex !== core.state.index) {
    assign(core, {
      index: result.queueIndex,
      orderPos: orderPosition(core.order, result.queueIndex),
      hasLoaded: true,
      loading: false,
    });
    return;
  }
  assign(core, {});
}

export function skip(core: SessionCore, delta: 1 | -1) {
  if (core.state.finished || core.state.queue.length === 0 || core.state.index < 0) return;
  if (core.repeat === "one") {
    restartCurrent(core, false);
    return;
  }
  const target = adjacentQueueIndex(core.order, core.state.index, delta, core.repeat);
  if (target === undefined) {
    finishQueue(core);
    return;
  }
  startPlay(core, target, playingOf(core), false);
}

export function restartCurrent(core: SessionCore, forcePlay: boolean) {
  const playing = forcePlay || playingOf(core);
  core.memory = { ...core.memory, sawNearEnd: false, suppressZeroEnd: true, lastPositionMs: 0 };
  core.clock.seekLocal(0);
  if (playing) core.optimistic = true;
  assign(core, {});
  void core.lane.run(async (ctx) => {
    await core.transport.seek(0, ctx.signal);
    if (!ctx.live()) return;
    if (!playing) return;
    await core.transport.resume(ctx.signal);
    if (!ctx.live()) return;
  });
}

export function finishQueue(core: SessionCore) {
  if (core.queueFinished || core.state.finished) return;
  core.queueFinished = true;
  haltLane(core);
  core.order = [];
  assign(core, {
    queue: [],
    index: -1,
    orderPos: 0,
    error: null,
    hasLoaded: false,
    loading: false,
    finished: true,
  });
  void core.transport.pause(new AbortController().signal).catch(() => {});
  core.onQueueFinished?.();
}

export function halt(core: SessionCore, message: string) {
  haltLane(core);
  assign(core, { error: message, hasLoaded: false, loading: false });
  void core.transport.pause(new AbortController().signal).catch(() => {});
}

export function haltLane(core: SessionCore) {
  core.seeks.cancel();
  core.lane.abort();
  core.accepting = false;
  core.committed = false;
  core.optimistic = null;
  core.sdkPlaying = false;
  core.memory = blankMemory();
  core.clock.reset();
}

export function fail(core: SessionCore, reason: unknown) {
  if (isAbortError(reason)) return;
  core.optimistic = null;
  core.sdkPlaying = false;
  core.clock.setPaused(true);
  if (reason instanceof PlaybackFailure && reason.action === "stop") {
    halt(core, reason.message);
    return;
  }
  const message = reason instanceof Error && reason.message ? reason.message : UNAVAILABLE;
  assign(core, { error: message, loading: false, hasLoaded: false });
}

export function resync(core: SessionCore) {
  const epoch = core.loadedEpoch;
  if (!core.accepting || core.state.finished) return Promise.resolve();
  return core.transport.getState().then(
    (state) => {
      if (epoch !== core.loadedEpoch || !core.accepting || core.state.finished) return;
      ingest(core, state);
    },
    (reason: unknown) => {
      if (isAbortError(reason)) return;
    },
  );
}

function handleEnded(core: SessionCore) {
  if (core.state.finished) return;
  if (core.repeat === "one") {
    restartCurrent(core, true);
    return;
  }
  const next = core.state.index < 0 ? undefined : adjacentQueueIndex(core.order, core.state.index, 1, core.repeat);
  if (next === undefined) {
    finishQueue(core);
    return;
  }
  startPlay(core, next, true, false);
}

function displace(core: SessionCore) {
  core.optimistic = null;
  core.sdkPlaying = false;
  core.clock.setPaused(true);
  assign(core, {});
}
