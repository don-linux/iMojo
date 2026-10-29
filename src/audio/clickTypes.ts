type Node = object;

export type ClickBuffer = {
  length: number;
  numberOfChannels: number;
  sampleRate: number;
  getChannelData: (channel: number) => Float32Array;
};

export type ClickGain = { gain: { value: number }; connect: (node: Node) => void };

export type ClickSource = {
  buffer: ClickBuffer | null;
  connect: (node: Node) => void;
  disconnect: () => void;
  start: (when?: number) => void;
  onended: (() => void) | null;
};

export type ClickContext = {
  state: string;
  sampleRate: number;
  currentTime: number;
  destination: Node;
  resume: () => Promise<void> | void;
  close: () => Promise<void> | void;
  createGain: () => ClickGain;
  createBuffer: (channels: number, length: number, sampleRate: number) => ClickBuffer;
  createBufferSource: () => ClickSource;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

export type ClickContextCtor = new (options?: AudioContextOptions) => ClickContext;

export type ClickListenable = {
  addEventListener: (type: string, listener: (event: Event) => void, capture?: boolean) => void;
  removeEventListener: (type: string, listener: (event: Event) => void, capture?: boolean) => void;
  visibilityState?: string;
};

export type ClickPlayerDeps = {
  getConstructor: () => ClickContextCtor | null;
  doc: ClickListenable | null;
  win: ClickListenable | null;
  now: () => number;
  loadBytes: () => Promise<ArrayBuffer | null>;
  isActivated?: () => boolean;
  isEnabled?: () => boolean;
};

export type ClickPlayer = { playClick: () => void; unlockClick: () => void; dispose: () => void };

export function createByteLoader(read: () => Promise<ArrayBuffer | null>): () => Promise<ArrayBuffer | null> {
  let pending: Promise<ArrayBuffer | null> | null = null;
  return () => {
    if (pending) return pending;
    pending = read().then(
      (bytes) => {
        if (!bytes) pending = null;
        return bytes;
      },
      () => {
        pending = null;
        return null;
      },
    );
    return pending;
  };
}
