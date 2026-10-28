import { createClickPlayer } from "./clickPlayer.ts";
import type { ClickContextCtor } from "./clickTypes.ts";

export const GESTURES = ["pointerdown", "pointerup", "touchend", "click", "keydown"];

export function clickWav(): ArrayBuffer {
  const frames = 4;
  const bytes = new ArrayBuffer(44 + frames * 4);
  const view = new DataView(bytes);
  const mark = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  mark(0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  mark(8, "WAVE");
  mark(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, 32_000, true);
  view.setUint32(28, 128_000, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  mark(36, "data");
  view.setUint32(40, frames * 4, true);
  for (let frame = 0; frame < frames; frame += 1) {
    view.setInt16(44 + frame * 4, 16_000, true);
    view.setInt16(46 + frame * 4, -16_000, true);
  }
  return bytes;
}

type FakeBuffer = {
  length: number;
  numberOfChannels: number;
  sampleRate: number;
  getChannelData: (channel: number) => Float32Array;
};

type FakeSource = {
  buffer: FakeBuffer | null;
  started: number | null;
  connected: object | null;
  disconnects: number;
  onended: (() => void) | null;
  connect: (node: object) => void;
  disconnect: () => void;
  start: (when?: number) => void;
};

export function createFake(options?: AudioContextOptions) {
  const listeners = new Set<() => void>();
  const sources: FakeSource[] = [];
  const buffers: FakeBuffer[] = [];
  const gains: { gain: { value: number } }[] = [];
  const emit = () => {
    for (const listener of Array.from(listeners)) listener();
  };
  const ctx = {
    options,
    state: "suspended",
    sampleRate: 48_000,
    currentTime: 0,
    destination: {},
    resumeCalls: 0,
    closeCalls: 0,
    resumeMode: "ok" as "ok" | "throw" | "reject",
    sources,
    buffers,
    gains,
    resume() {
      ctx.resumeCalls += 1;
      if (ctx.resumeMode === "throw") throw new Error("resume failed");
      if (ctx.resumeMode === "reject") return Promise.reject(new Error("resume denied"));
      return Promise.resolve();
    },
    close() {
      ctx.closeCalls += 1;
      ctx.state = "closed";
      emit();
      return Promise.resolve();
    },
    setState(state: string) {
      ctx.state = state;
      emit();
    },
    createGain() {
      const gain = { gain: { value: 0 }, connect() {} };
      gains.push(gain);
      return gain;
    },
    createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      const buffer: FakeBuffer = {
        length,
        numberOfChannels: channels,
        sampleRate,
        getChannelData: (channel: number) => data[channel],
      };
      buffers.push(buffer);
      return buffer;
    },
    createBufferSource() {
      const source: FakeSource = {
        buffer: null,
        started: null,
        connected: null,
        disconnects: 0,
        onended: null,
        connect(node: object) {
          source.connected = node;
        },
        disconnect() {
          source.disconnects += 1;
        },
        start(when?: number) {
          source.started = when ?? 0;
        },
      };
      sources.push(source);
      return source;
    },
    decodeAudioData() {
      throw new Error("decodeAudioData must not be used");
    },
    addEventListener(_type: string, listener: () => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: string, listener: () => void) {
      listeners.delete(listener);
    },
  };
  return ctx;
}

export type Fake = ReturnType<typeof createFake>;
type Target = ReturnType<typeof createTarget>;

export function createTarget() {
  const entries = new Map<string, { listener: (event: Event) => void; capture: boolean }[]>();
  const list = (type: string) => entries.get(type) ?? [];
  return {
    visibilityState: "visible",
    addEventListener(type: string, listener: (event: Event) => void, capture?: boolean) {
      entries.set(type, [...list(type), { listener, capture: capture === true }]);
    },
    removeEventListener(type: string, listener: (event: Event) => void, capture?: boolean) {
      const wanted = capture === true;
      const next = list(type).filter((entry) => entry.listener !== listener || entry.capture !== wanted);
      entries.set(type, next);
    },
    captureCount: (type: string) => list(type).filter((entry) => entry.capture).length,
    count: (type: string) => list(type).length,
    dispatch(type: string, extra: Record<string, unknown> = {}) {
      const event = { type, ...extra } as Event;
      for (const entry of list(type).slice()) entry.listener(event);
    },
  };
}

export function harness(loadBytes?: () => Promise<ArrayBuffer | null>) {
  const contexts: Fake[] = [];
  const doc = createTarget();
  const win = createTarget();
  let now = 0;
  const player = createClickPlayer({
    getConstructor: () => function Ctor(options?: AudioContextOptions) {
      const ctx = createFake(options);
      contexts.push(ctx);
      return ctx;
    } as unknown as ClickContextCtor,
    doc,
    win,
    now: () => now,
    loadBytes: loadBytes ?? (async () => clickWav()),
  });
  return {
    contexts,
    doc,
    win,
    player,
    at(value: number) {
      now = value;
    },
  };
}

export async function drain() {
  for (let step = 0; step < 6; step += 1) await Promise.resolve();
}

export function audible(ctx: Fake) {
  return ctx.sources.filter((source) => (source.buffer?.length ?? 0) > 1);
}

export function armed(doc: Target) {
  return GESTURES.every((type) => doc.captureCount(type) === 1);
}
