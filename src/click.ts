import clickUrl from "./ipod/assets/click.wav";

// Mirrors Apple's ClickSoundPlayer. The context is created on the gesture:
// Safari will not resume one that was opened at page load, and it drops the
// context after the tab is hidden. click.wav is 32 kHz; Safari plays those
// samples at the context rate unless they are converted first.
const CLICK_GAIN = 0.3;
const CLICK_SPACING = 0.05;
const CLICK_LOOKAHEAD = 0.15;
const RESUME_LEAD = 0.08;

type AudioContextConstructor = typeof AudioContext;

type PcmInfo = {
  rate: number;
  frames: number;
};

let context: AudioContext | null = null;
let output: GainNode | null = null;
let sample: AudioBuffer | null = null;
let nextAt = 0;
let pendingClick = false;
let stale = false;
let detachState: (() => void) | null = null;
let bytesPromise: Promise<ArrayBuffer | null> | null = null;

function audioConstructor() {
  const global = window as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return global.AudioContext ?? global.webkitAudioContext ?? null;
}

function loadBytes() {
  if (!bytesPromise) {
    bytesPromise = fetch(clickUrl)
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .catch(() => null);
  }
  return bytesPromise;
}

function fourcc(view: DataView, offset: number) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function wavPcm(bytes: ArrayBuffer): PcmInfo | null {
  if (bytes.byteLength < 12) return null;
  const view = new DataView(bytes);
  if (fourcc(view, 0) !== "RIFF" || fourcc(view, 8) !== "WAVE") return null;
  let offset = 12;
  let rate = 0;
  let channels = 0;
  let bits = 0;
  let dataBytes = 0;
  while (offset + 8 <= bytes.byteLength) {
    const id = fourcc(view, offset);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (id === "fmt " && size >= 16 && start + 16 <= bytes.byteLength) {
      channels = view.getUint16(start + 2, true);
      rate = view.getUint32(start + 4, true);
      bits = view.getUint16(start + 14, true);
    } else if (id === "data") {
      dataBytes = Math.min(size, bytes.byteLength - start);
      break;
    }
    offset = start + size + (size & 1);
  }
  const bytesPerFrame = channels * (bits / 8);
  if (!rate || bytesPerFrame <= 0 || !dataBytes) return null;
  return { rate, frames: Math.floor(dataBytes / bytesPerFrame) };
}

function resample(ctx: AudioContext, buffer: AudioBuffer, srcRate: number, dstRate: number) {
  const dstFrames = Math.max(1, Math.round((buffer.length * dstRate) / srcRate));
  const out = ctx.createBuffer(buffer.numberOfChannels, dstFrames, dstRate);
  const step = srcRate / dstRate;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const src = buffer.getChannelData(channel);
    const dst = out.getChannelData(channel);
    const last = src.length - 1;
    for (let index = 0; index < dstFrames; index += 1) {
      const position = index * step;
      const left = Math.min(last, Math.floor(position));
      const right = Math.min(last, left + 1);
      const fraction = position - left;
      dst[index] = src[left] + (src[right] - src[left]) * fraction;
    }
  }
  return out;
}

function atContextRate(ctx: AudioContext, buffer: AudioBuffer, bytes: ArrayBuffer) {
  const dstRate = ctx.sampleRate;
  const pcm = wavPcm(bytes);
  if (!pcm) {
    if (buffer.sampleRate === dstRate) return buffer;
    return resample(ctx, buffer, buffer.sampleRate, dstRate);
  }
  const converted = Math.round((pcm.frames * dstRate) / pcm.rate);
  if (buffer.sampleRate === dstRate && Math.abs(buffer.length - converted) <= 2) return buffer;
  const sourceRate = Math.abs(buffer.length - pcm.frames) <= 2 ? pcm.rate : buffer.sampleRate;
  if (sourceRate === dstRate) return buffer;
  return resample(ctx, buffer, sourceRate, dstRate);
}

function flushPending() {
  if (!pendingClick || !sample || !context || context.state !== "running") return;
  pendingClick = false;
  playNow();
}

async function decodeInto(ctx: AudioContext) {
  try {
    const bytes = await loadBytes();
    if (!bytes || context !== ctx) return;
    const decoded = await ctx.decodeAudioData(bytes.slice(0));
    if (context !== ctx) return;
    sample = atContextRate(ctx, decoded, bytes);
    flushPending();
  } catch {
    // The click is optional; keep the player silent if it cannot load.
  }
}

function replaceContext(ctx: AudioContext) {
  if (stale) return true;
  const state = ctx.state as string;
  return state === "closed" || state === "interrupted";
}

function ensureContext() {
  if (context && !replaceContext(context)) return context;
  const Constructor = audioConstructor();
  if (!Constructor) return null;

  stale = false;
  sample = null;
  nextAt = 0;
  detachState?.();
  detachState = null;
  const previous = context;
  context = null;
  output = null;
  if (previous && (previous.state as string) !== "closed") void previous.close().catch(() => {});

  const ctx = new Constructor();
  const gain = ctx.createGain();
  gain.gain.value = CLICK_GAIN;
  gain.connect(ctx.destination);
  const onState = () => {
    if (context !== ctx || ctx.state !== "running") return;
    nextAt = Math.max(nextAt, ctx.currentTime + RESUME_LEAD);
    flushPending();
  };
  ctx.addEventListener("statechange", onState);
  detachState = () => ctx.removeEventListener("statechange", onState);
  context = ctx;
  output = gain;
  void decodeInto(ctx);
  return ctx;
}

function playNow() {
  const ctx = context;
  if (!ctx || !output || !sample || ctx.state !== "running") return;
  const now = ctx.currentTime;
  if (nextAt - now >= CLICK_LOOKAHEAD) return;
  const startAt = Math.max(now, nextAt);
  try {
    const source = ctx.createBufferSource();
    source.buffer = sample;
    source.connect(output);
    source.start(startAt);
    nextAt = startAt + CLICK_SPACING;
  } catch {
    // A closed or interrupted context rejects the start.
  }
}

function resume(ctx: AudioContext) {
  if (ctx.state === "running" || (ctx.state as string) === "closed") return;
  void ctx.resume().catch(() => {
    if (context === ctx) stale = true;
  });
}

export function unlockClick() {
  const ctx = ensureContext();
  if (!ctx) return;
  resume(ctx);
}

export function playClick() {
  const ctx = ensureContext();
  if (!ctx) return;
  pendingClick = true;
  if (ctx.state !== "running") {
    resume(ctx);
    return;
  }
  flushPending();
}

if (typeof window !== "undefined") {
  void loadBytes();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") stale = true;
  });
}
