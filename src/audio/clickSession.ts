import { gestureAction } from "./clickGesture.ts";
import { isPendingFresh, rebaseAfterResume, scheduleClick } from "./clickScheduler.ts";
import type {
  ClickBuffer,
  ClickContext,
  ClickContextCtor,
  ClickGain,
  ClickListenable,
  ClickPlayer,
  ClickPlayerDeps,
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
  let primed = false;
  let openGesture: Event | null = null;
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
    // The wheel calls unlockClick from this dispatch, sometimes after a microtask.
    openGesture = event;
    const token = event;
    setTimeout(() => {
      if (openGesture === token) openGesture = null;
    }, 0);
    const action = gestureAction(event);
    if (action === "unlock") unlock();
    else if (action === "construct") ensureContext();
  }

  function onPageReturn(event: Event) {
    if (event.type === "visibilitychange" && deps.doc?.visibilityState === "hidden") return;
    if (context) resumeIfNeeded(context);
    if (!context || context.state !== "running") setGestures(true);
  }

  function resume(ctx: ClickContext) {
    try {
      void Promise.resolve(ctx.resume()).catch(() => {});
    } catch {
      // A synchronous throw must not abandon this context.
    }
  }

  function resumeIfNeeded(ctx: ClickContext) {
    if (ctx.state !== "suspended" && ctx.state !== "interrupted") return;
    resume(ctx);
  }

  function userActivated() {
    return deps.isActivated?.() ?? true;
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
      primed = false;
      const onChange = () => {
        if (context === ctx) onState();
      };
      ctx.addEventListener("statechange", onChange);
      detachState = () => ctx.removeEventListener("statechange", onChange);
      prepareBuffer(ctx);
      if (ctx.state === "running") nextAt = rebaseAfterResume(ctx.currentTime, nextAt);
      // A context created on touch pointerdown can already say "running".
      // The silent prime still has to happen on a later activating event.
      setGestures(true);
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
      primed = false;
      setGestures(true);
      return;
    }
    nextAt = rebaseAfterResume(ctx.currentTime, nextAt);
    if (primed) setGestures(false);
    else setGestures(true);
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
  // start(0) is already in the past once currentTime advances, so the 1-frame prime is skipped.
  function startSilent(ctx: ClickContext) {
    try {
      startSource(ctx, ctx.createBuffer(1, 1, ctx.sampleRate), ctx.destination, ctx.currentTime);
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
    resume(ctx);
    startSilent(ctx);
    primed = true;
    flushPending();
    if (ctx.state === "running") setGestures(false);
  }

  function playClick() {
    const ctx = ensureContext();
    if (!ctx) return;
    if (!userActivated()) {
      pendingAt = deps.now();
      return;
    }
    resumeIfNeeded(ctx);
    if (ctx.state === "running" && buffer) {
      pendingAt = null;
      playScheduled();
      return;
    }
    pendingAt = deps.now();
  }

  function unlockClick() {
    const early = openGesture !== null && gestureAction(openGesture) === "construct";
    if (early || !userActivated()) {
      ensureContext();
      return;
    }
    unlock();
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
  return { playClick, unlockClick, dispose };
}
