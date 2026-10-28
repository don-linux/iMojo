import clickUrl from "./ipod/assets/click.wav";

// click.wav is 16-bit PCM at 32 kHz. The context stays at the device rate and
// the clip is resampled into that rate, so the pitch and length stay put on
// every browser. Safari plays an unconverted 32 kHz buffer at the context
// rate. The context is opened inside the gesture that needs it and kept for
// the page; hiding the tab does not tear it down.

const CLICK_GAIN = 0.3;
const CLICK_SPACING = 0.05;
const CLICK_LOOKAHEAD = 0.15;
const RESUME_LEAD = 0.08;

type AudioContextConstructor = typeof AudioContext;

type Pcm = {
  rate: number;
  channels: Float32Array[];
};

let context: AudioContext | null = null;
let output: GainNode | null = null;
let sample: AudioBuffer | null = null;
let pcm: Pcm | null = null;
let nextAt = 0;
let pendingClick = false;
let failed = false;
let detachState: (() => void) | null = null;
let bytesPromise: Promise<void> | null = null;

function audioConstructor() {
  const global = window as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return global.AudioContext ?? global.webkitAudioContext ?? null;
}

function fourcc(view: DataView, offset: number) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function parseWav(bytes: ArrayBuffer): Pcm | null {
  if (bytes.byteLength < 12) return null;
  const view = new DataView(bytes);
  if (fourcc(view, 0) !== "RIFF" || fourcc(view, 8) !== "WAVE") return null;

  let offset = 12;
  let format = 0;
  let rate = 0;
  let channels = 0;
  let bits = 0;
  let dataStart = 0;
  let dataBytes = 0;

  while (offset + 8 <= bytes.byteLength) {
    const id = fourcc(view, offset);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (id === "fmt " && size >= 16 && start + 16 <= bytes.byteLength) {
      format = view.getUint16(start, true);
      channels = view.getUint16(start + 2, true);
      rate = view.getUint32(start + 4, true);
      bits = view.getUint16(start + 14, true);
    } else if (id === "data") {
      dataStart = start;
      dataBytes = Math.min(size, bytes.byteLength - start);
      break;
    }
    const next = start + size + (size & 1);
    if (next <= offset) break;
    offset = next;
  }

  if (format !== 1 || rate <= 0 || channels < 1 || (bits !== 8 && bits !== 16)) return null;
  const bytesPerSample = bits / 8;
  const bytesPerFrame = channels * bytesPerSample;
  if (bytesPerFrame <= 0 || dataBytes < bytesPerFrame) return null;
  const frames = Math.floor(dataBytes / bytesPerFrame);
  const decoded: Float32Array[] = [];

  for (let channel = 0; channel < channels; channel += 1) {
    const samples = new Float32Array(frames);
    for (let frame = 0; frame < frames; frame += 1) {
      const at = dataStart + frame * bytesPerFrame + channel * bytesPerSample;
      samples[frame] =
        bits === 8 ? (view.getUint8(at) - 128) / 128 : view.getInt16(at, true) / 32768;
    }
    decoded.push(samples);
  }

  return { rate, channels: decoded };
}

function resampled(ctx: AudioContext, source: Pcm) {
  const first = source.channels[0];
  if (!first || first.length < 1) return null;
  const dstRate = ctx.sampleRate;
  if (source.rate === dstRate) {
    const buffer = ctx.createBuffer(source.channels.length, first.length, dstRate);
    for (let channel = 0; channel < source.channels.length; channel += 1) {
      const samples = source.channels[channel];
      if (samples) buffer.getChannelData(channel).set(samples);
    }
    return buffer;
  }

  const dstFrames = Math.max(1, Math.round((first.length * dstRate) / source.rate));
  const buffer = ctx.createBuffer(source.channels.length, dstFrames, dstRate);
  const step = source.rate / dstRate;
  const last = first.length - 1;
  for (let channel = 0; channel < source.channels.length; channel += 1) {
    const src = source.channels[channel];
    if (!src) continue;
    const dst = buffer.getChannelData(channel);
    for (let index = 0; index < dstFrames; index += 1) {
      const position = index * step;
      const left = Math.min(last, Math.floor(position));
      const right = Math.min(last, left + 1);
      const fraction = position - left;
      const leftSample = src[left] ?? 0;
      const rightSample = src[right] ?? leftSample;
      dst[index] = leftSample + (rightSample - leftSample) * fraction;
    }
  }
  return buffer;
}

function attachSample(ctx: AudioContext) {
  if (!pcm) return;
  try {
    sample = resampled(ctx, pcm);
  } catch {
    sample = null;
  }
}

function rememberPcm(bytes: ArrayBuffer | null) {
  pcm = bytes ? parseWav(bytes) : null;
  if (!pcm || !context || failed || (context.state as string) === "closed" || sample) return;
  attachSample(context);
  flushPending();
}

function loadBytes() {
  if (!bytesPromise) {
    bytesPromise = fetch(clickUrl)
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .then((bytes) => {
        rememberPcm(bytes);
      })
      .catch(() => {
        pcm = null;
      });
  }
  return bytesPromise;
}

function flushPending() {
  if (!pendingClick || !sample || !context || context.state !== "running") return;
  pendingClick = false;
  playNow();
}

function createContext(Constructor: AudioContextConstructor) {
  try {
    return new Constructor({ latencyHint: "interactive" });
  } catch {
    return new Constructor();
  }
}

function ensureContext() {
  if (context && !failed && (context.state as string) !== "closed") return context;
  const Constructor = audioConstructor();
  if (!Constructor) return null;

  failed = false;
  sample = null;
  nextAt = 0;
  detachState?.();
  detachState = null;
  const previous = context;
  context = null;
  output = null;
  if (previous && (previous.state as string) !== "closed") void previous.close().catch(() => {});

  const ctx = createContext(Constructor);
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
  attachSample(ctx);
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
    // A closed context rejects the start. The next gesture replaces it.
  }
}

function resume(ctx: AudioContext) {
  const state = ctx.state as string;
  if (state === "running" || state === "closed") return;
  void ctx.resume().catch(() => {
    if (context === ctx) failed = true;
  });
}

export function armClick(enabled: boolean, play = false) {
  if (!enabled) return;
  const ctx = ensureContext();
  if (!ctx) return;
  if (play) pendingClick = true;
  if (ctx.state !== "running") resume(ctx);
  if (ctx.state === "running") flushPending();
}

if (typeof window !== "undefined") {
  void loadBytes();
}
