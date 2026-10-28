import { isPendingFresh, rebaseAfterResume, scheduleClick } from "./clickScheduler.ts";
import {
  createByteLoader,
  type ClickBuffer,
  type ClickContext,
  type ClickContextCtor,
  type ClickGain,
  type ClickListenable,
  type ClickPlayer,
  type ClickPlayerDeps,
} from "./clickTypes.ts";
import { parseWavPcm16, resampleLinear, type Pcm16 } from "./pcm.ts";

const CLICK_GAIN = 0.3;
const GESTURE_EVENTS = ["pointerdown", "pointerup", "touchend", "click", "keydown"];

export function createClickPlayer(deps: ClickPlayerDeps): ClickPlayer {
  let context: ClickContext | null = null;
  let output: ClickGain | null = null;
  let buffer: ClickBuffer | null = null;
  let parsed: Pcm16 | null = null;
  let unreadable = false;
  let loadingFor: ClickContext | null = null;
  let nextAt = 0;
  let pendingAt: number | null = null;
  let gesturesArmed = false;
  let detachState: (() => void) | null = null;

  function bind(target: ClickListenable | null, type: string, listener: (event: Event) => void, capture: boolean, on: boolean) {
    if (!target) return;
    if (on) target.addEventListener(type, listener, capture);
    else target.removeEventListener(type, listener, capture);
  }

  function setGestures(on: boolean) {
    if (!deps.doc || on === gesturesArmed) return;
    for (const type of GESTURE_EVENTS) bind(deps.doc, type, onGesture, true, on);
    gesturesArmed = on;
  }

  function onGesture(event: Event) {
    if (event.type === "keydown") {
      const key = event as KeyboardEvent;
      if (key.repeat || key.key === "Escape") return;
    }
    unlock();
  }

  function onPageReturn(event: Event) {
    if (event.type === "visibilitychange" && deps.doc?.visibilityState === "hidden") return;
    if (context) resumeIfNeeded(context);
    if (!context || context.state !== "running") setGestures(true);
  }

  function resumeIfNeeded(ctx: ClickContext) {
    if (ctx.state !== "suspended" && ctx.state !== "interrupted") return;
    try {
      void Promise.resolve(ctx.resume()).catch(() => {});
    } catch {
      // A synchronous throw must not abandon this context.
    }
  }

  // iOS's silent switch mutes Web Audio by design. Setting
  // navigator.audioSession.type = "playback" would override it page-wide.
  function construct(Ctor: ClickContextCtor): ClickContext | null {
    try {
      return new Ctor({ latencyHint: "interactive" });
    } catch {
      try {
        return new Ctor();
      } catch {
        return null;
      }
    }
  }

  function ensureContext(): ClickContext | null {
    if (context && context.state !== "closed") {
      if (!buffer) prepareBuffer(context);
      return context;
    }
    let Ctor: ClickContextCtor | null = null;
    try {
      Ctor = deps.getConstructor();
    } catch {
      return null;
    }
    if (!Ctor) return null;
    const created = construct(Ctor);
    return created ? adopt(created) : null;
  }

  function adopt(ctx: ClickContext): ClickContext | null {
    try {
      const gain = ctx.createGain();
      gain.gain.value = CLICK_GAIN;
      gain.connect(ctx.destination);
      detachState?.();
      context = ctx;
      output = gain;
      buffer = null;
      nextAt = 0;
      const onChange = () => {
        if (context === ctx) onState();
      };
      ctx.addEventListener("statechange", onChange);
      detachState = () => ctx.removeEventListener("statechange", onChange);
      prepareBuffer(ctx);
      if (ctx.state === "running") {
        nextAt = rebaseAfterResume(ctx.currentTime, nextAt);
        setGestures(false);
      } else {
        setGestures(true);
      }
      return ctx;
    } catch {
      if (context === ctx) {
        context = null;
        output = null;
        detachState?.();
        detachState = null;
      }
      void Promise.resolve(ctx.close()).catch(() => {});
      return null;
    }
  }

  function onState() {
    const ctx = context;
    if (!ctx || ctx.state !== "running") {
      setGestures(true);
      return;
    }
    nextAt = rebaseAfterResume(ctx.currentTime, nextAt);
    setGestures(false);
    flushPending();
  }

  function prepareBuffer(ctx: ClickContext) {
    if (buffer || loadingFor === ctx) return;
    loadingFor = ctx;
    void fillBuffer(ctx);
  }

  async function fillBuffer(ctx: ClickContext) {
    try {
      const pcm = parsed ?? (await readPcm());
      if (!pcm || context !== ctx) return;
      const channels = pcm.sampleRate === ctx.sampleRate
        ? pcm.channels
        : resampleLinear(pcm.channels, pcm.sampleRate, ctx.sampleRate);
      const frames = channels[0]?.length ?? 0;
      if (!frames || context !== ctx) return;
      const audio = ctx.createBuffer(channels.length, frames, ctx.sampleRate);
      for (let index = 0; index < channels.length; index += 1) {
        audio.getChannelData(index).set(channels[index]);
      }
      if (context !== ctx) return;
      buffer = audio;
      flushPending();
    } catch {
      // The click is optional. The next gesture retries a failed read.
    } finally {
      if (loadingFor === ctx) loadingFor = null;
    }
  }

  async function readPcm(): Promise<Pcm16 | null> {
    if (parsed || unreadable) return parsed;
    const bytes = await deps.loadBytes();
    if (!bytes) return null;
    parsed = parseWavPcm16(bytes);
    if (!parsed) unreadable = true;
    return parsed;
  }

  function flushPending() {
    if (pendingAt === null || !context || context.state !== "running" || !buffer) return;
    const at = pendingAt;
    pendingAt = null;
    if (!isPendingFresh(at, deps.now())) return;
    playScheduled();
  }

  function playScheduled() {
    const ctx = context;
    const gain = output;
    if (!ctx || !gain || !buffer || ctx.state !== "running") return;
    const slot = scheduleClick(ctx.currentTime, nextAt);
    if (!slot) return;
    try {
      startSource(ctx, buffer, gain, slot.startAt);
      nextAt = slot.nextAt;
    } catch {
      // start() throws if the context closed after the state check.
    }
  }

  // Older WebKit stays silent until a buffer source starts inside the gesture.
  function startSilent(ctx: ClickContext) {
    try {
      startSource(ctx, ctx.createBuffer(1, 1, ctx.sampleRate), ctx.destination, 0);
    } catch {
      // A closed context rejects the silent start; the next gesture replaces it.
    }
  }

  function startSource(ctx: ClickContext, audio: ClickBuffer, target: object, when: number) {
    const source = ctx.createBufferSource();
    source.buffer = audio;
    source.connect(target);
    source.onended = () => {
      source.disconnect();
    };
    source.start(when);
  }

  function unlock() {
    const ctx = ensureContext();
    if (!ctx) return;
    resumeIfNeeded(ctx);
    startSilent(ctx);
  }

  function playClick() {
    const ctx = ensureContext();
    if (!ctx) return;
    resumeIfNeeded(ctx);
    if (ctx.state === "running" && buffer) {
      pendingAt = null;
      playScheduled();
      return;
    }
    pendingAt = deps.now();
  }

  function dispose() {
    setGestures(false);
    bind(deps.doc, "visibilitychange", onPageReturn, false, false);
    bind(deps.win, "pageshow", onPageReturn, false, false);
    const ctx = context;
    context = null;
    output = null;
    buffer = null;
    pendingAt = null;
    detachState?.();
    detachState = null;
    if (ctx && ctx.state !== "closed") void Promise.resolve(ctx.close()).catch(() => {});
  }

  setGestures(true);
  bind(deps.doc, "visibilitychange", onPageReturn, false, true);
  bind(deps.win, "pageshow", onPageReturn, false, true);
  return { playClick, unlockClick: unlock, dispose };
}

async function readInlineWav(): Promise<ArrayBuffer | null> {
  const asset = await import("../ipod/assets/click.wav?inline");
  const response = await fetch(asset.default);
  if (!response.ok) return null;
  return response.arrayBuffer();
}

function audioConstructor(): ClickContextCtor | null {
  const scoped = window as unknown as {
    AudioContext?: ClickContextCtor;
    webkitAudioContext?: ClickContextCtor;
  };
  return scoped.AudioContext ?? scoped.webkitAudioContext ?? null;
}

const loadClickBytes = createByteLoader(readInlineWav);
let browserPlayer: ClickPlayer | null = null;

if (typeof window !== "undefined") {
  void loadClickBytes();
  browserPlayer = createClickPlayer({
    getConstructor: audioConstructor,
    doc: document as unknown as ClickListenable,
    win: window as unknown as ClickListenable,
    now: () => Date.now(),
    loadBytes: loadClickBytes,
  });
}

export function playClick(): void {
  browserPlayer?.playClick();
}

export function unlockClick(): void {
  browserPlayer?.unlockClick();
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    browserPlayer?.dispose();
  });
}
