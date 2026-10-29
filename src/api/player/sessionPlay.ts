import { orderPosition, takeWindow } from "./order.ts";
import { assign, trackAt, type SessionCore } from "./sessionHost.ts";
import { PlaybackFailure, type PlayWindow } from "./types.ts";

const UNAVAILABLE = "This track is unavailable";

export function startPlay(core: SessionCore, index: number, resume: boolean, keepPosition: boolean) {
  const blocked = core.transport.supportReason?.() ?? null;
  const position = orderPosition(core.order, index);
  if (blocked) {
    core.optimistic = null;
    core.sdkPlaying = false;
    assign(core, { index, orderPos: position, error: blocked, loading: false, hasLoaded: false, finished: false });
    return;
  }
  const track = trackAt(core, index);
  if (!track) return;
  core.seeks.cancel();
  core.accepting = false;
  core.committed = false;
  core.optimistic = resume;
  const positionMs = keepPosition ? core.clock.preciseMs() : 0;
  assign(core, { index, orderPos: position, error: null, loading: true, finished: false });
  if (!keepPosition) {
    core.clock.note({
      positionMs: 0,
      timestamp: core.now(),
      durationMs: track.durationMs > 0 ? track.durationMs : 0,
      paused: !resume,
      generation: core.loadedEpoch,
    });
  }
  void core.lane.run(async (ctx) => {
    const slice = await resolveWindow(core, index, ctx.live);
    if (!slice || !ctx.live()) return;
    const request: PlayWindow = {
      ...slice,
      positionMs: keepPosition && positionMs > 0 ? positionMs : undefined,
    };
    await core.transport.playWindow(request, ctx.signal);
    if (!ctx.live()) return;
    commit(core, ctx.epoch, slice, resume, keepPosition ? positionMs : 0);
    if (resume) return;
    await core.transport.pause(ctx.signal);
    if (!ctx.live()) return;
  });
}

async function resolveWindow(core: SessionCore, index: number, live: () => boolean) {
  const tracks = core.state.queue;
  const current = tracks[index];
  if (!current) return null;
  if (core.repeat === "one") {
    const source = await core.resolveTrack(current);
    if (!live()) return null;
    if (!source?.url) throw new PlaybackFailure(UNAVAILABLE, "message");
    return { uris: [source.url], queueIndices: [index], offset: 0 };
  }
  const indices = takeWindow(core.order, Math.max(0, core.order.indexOf(index)), core.windowLimit);
  const sources = await Promise.all(
    indices.map(async (queueIndex) => {
      const item = tracks[queueIndex];
      if (!item) return null;
      try {
        return await core.resolveTrack(item);
      } catch {
        return null;
      }
    }),
  );
  if (!live()) return null;
  const uris: string[] = [];
  const queueIndices: number[] = [];
  indices.forEach((queueIndex, sourceIndex) => {
    const source = sources[sourceIndex];
    if (!source?.url) return;
    uris.push(source.url);
    queueIndices.push(queueIndex);
  });
  if (!uris.length || queueIndices[0] !== index) throw new PlaybackFailure(UNAVAILABLE, "message");
  return { uris, queueIndices, offset: 0 };
}

function commit(core: SessionCore, epoch: number, window: PlayWindow, resume: boolean, positionMs: number) {
  core.loadedEpoch = epoch;
  core.accepting = true;
  core.committed = true;
  core.optimistic = resume;
  core.sdkPlaying = resume;
  core.memory = {
    generation: epoch,
    expectedUri: window.uris[window.offset] ?? "",
    windowUris: window.uris,
    windowIndices: window.queueIndices,
    windowPos: window.offset,
    lastPositionMs: positionMs,
    sawNearEnd: false,
    seen: false,
    suppressZeroEnd: true,
  };
  const track = trackAt(core, core.state.index);
  core.clock.note({
    positionMs,
    timestamp: core.now(),
    durationMs: track && track.durationMs > 0 ? track.durationMs : 0,
    paused: !resume,
    generation: epoch,
  });
  core.volumes.flushNow(core.state.volume);
  assign(core, { loading: false, hasLoaded: true, error: null });
}
