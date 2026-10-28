import clickUrl from "./ipod/assets/click.wav";

// Mirrors Apple's ClickSoundPlayer.
const CLICK_GAIN = 0.3;
const CLICK_SPACING = 0.05;
const CLICK_LOOKAHEAD = 0.15;
const RESUME_LEAD = 0.08;
const RESUME_WINDOW_MS = 200;

type AudioContextConstructor = typeof AudioContext;

let context: AudioContext | null = null;
let output: GainNode | null = null;
let sample: AudioBuffer | null = null;
let nextAt = 0;
let requestedAt: number | null = null;

function ensureContext() {
  if (context) return context;
  const global = window as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  const Constructor = global.AudioContext ?? global.webkitAudioContext;
  if (!Constructor) return null;

  context = new Constructor();
  output = context.createGain();
  output.gain.value = CLICK_GAIN;
  output.connect(context.destination);
  context.addEventListener("statechange", onStateChange);
  void loadSample(context);
  return context;
}

async function loadSample(ctx: AudioContext) {
  try {
    const response = await fetch(clickUrl);
    sample = await ctx.decodeAudioData(await response.arrayBuffer());
  } catch {
    // The click is optional; keep the player silent if it cannot load.
  }
}

function onStateChange() {
  const ctx = context;
  if (!ctx || ctx.state !== "running") return;
  nextAt = Math.max(nextAt, ctx.currentTime + RESUME_LEAD);
  if (requestedAt === null) return;
  const expired = Date.now() - requestedAt > RESUME_WINDOW_MS;
  requestedAt = null;
  if (!expired) playNow();
}

function playNow() {
  const ctx = context;
  if (!ctx || !output || !sample) return;
  const now = ctx.currentTime;
  if (nextAt - now >= CLICK_LOOKAHEAD) return;
  const startAt = Math.max(now, nextAt);
  const source = ctx.createBufferSource();
  source.buffer = sample;
  source.connect(output);
  source.start(startAt);
  nextAt = startAt + CLICK_SPACING;
}

function resume(ctx: AudioContext) {
  if (ctx.state === "running" || ctx.state === "closed") return;
  void ctx.resume().catch(() => {});
}

export function unlockClick() {
  const ctx = ensureContext();
  if (!ctx) return;
  resume(ctx);
}

export function playClick() {
  const ctx = ensureContext();
  if (!ctx) return;
  if (ctx.state !== "running") {
    resume(ctx);
    if (requestedAt === null) requestedAt = Date.now();
    return;
  }
  playNow();
}

if (typeof window !== "undefined") ensureContext();
