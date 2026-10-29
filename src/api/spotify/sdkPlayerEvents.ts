import {
  PREMIUM_REQUIRED,
  PRESS_PLAY_AGAIN,
  PRESS_PLAY_TO_START,
  SDK_BROWSER_MESSAGE,
  SESSION_EXPIRED,
  TRACK_ERROR,
  type SdkTimer,
  type SpotifyPlaybackState,
  type SpotifyPlayer,
  type SpotifyPlayerEvent,
  type SpotifySdk,
} from "./sdkTypes.ts";

export type SdkPlayerErrorKind =
  | "autoplay"
  | "initialization"
  | "authentication"
  | "account"
  | "playback"
  | "session";

export type SdkPlayerError = {
  kind: SdkPlayerErrorKind;
  message: string;
  recoverable: boolean;
};

export type SdkPlayerEventMap = {
  ready: (deviceId: string) => void;
  not_ready: () => void;
  state: (state: SpotifyPlaybackState | null) => void;
  error: (error: SdkPlayerError) => void;
};

export type TokenReader = (options?: { force?: boolean }) => Promise<string>;

export type SpotifySdkPlayerOptions = {
  name?: string;
  volume?: number;
  loadSdk?: (signal?: AbortSignal) => Promise<void>;
  getAccessToken?: TokenReader;
  /** Prebuilt SDK. When set, no script load is required before constructing a Player. */
  sdk?: SpotifySdk;
  /** Test seam for the global SDK object. Defaults to `window.Spotify`. */
  readSdk?: () => SpotifySdk | undefined;
  readyTimeoutMs?: number;
  timer?: SdkTimer;
};

export type SdkEventSink = {
  disposed: () => boolean;
  listening: () => boolean;
  deviceId: () => string;
  setDeviceId: (id: string) => void;
  activationDeferred: () => boolean;
  readToken: TokenReader;
  emit: <K extends keyof SdkPlayerEventMap>(
    event: K,
    ...args: Parameters<SdkPlayerEventMap[K]>
  ) => void;
  ready: () => void;
  fail: (error: Error, terminal?: boolean) => void;
  dispose: () => void;
};

export function browserTimer(): SdkTimer {
  return {
    setTimeout: (handler, ms) => setTimeout(handler, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

export function readWindowSdk() {
  if (typeof window === "undefined") return undefined;
  return window.Spotify;
}

export function namedAbort(message: string) {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}
export function disposedError() {
  return namedAbort("Spotify player was disposed");
}
export function safeDisconnect(player: SpotifyPlayer | null) {
  if (!player) return;
  try {
    player.disconnect();
  } catch {
    // Teardown is best-effort; the instance is already unusable.
  }
}

export function abortError(signal: AbortSignal) {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

export function bindSignal<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) reject(abortError(signal));
        else resolve(value);
      },
      (reason: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(reason);
      },
    );
  });
}

function eventMessage(event: SpotifyPlayerEvent) {
  if (!event || typeof event !== "object" || !("message" in event)) return "";
  return typeof event.message === "string" ? event.message : "";
}

function deviceIdFrom(event: SpotifyPlayerEvent) {
  if (!event || typeof event !== "object" || !("device_id" in event)) return "";
  return typeof event.device_id === "string" ? event.device_id : "";
}

function isPlaybackState(event: SpotifyPlayerEvent): event is SpotifyPlaybackState {
  return Boolean(event && typeof event === "object" && "track_window" in event && "paused" in event);
}

function sessionMessage(reason: unknown) {
  return reason instanceof Error && reason.message ? reason.message : SESSION_EXPIRED;
}

export function deliverToken(sink: SdkEventSink, callback: (token: string) => void) {
  void sink
    .readToken()
    .then((token) => {
      if (sink.disposed()) return;
      if (!token) {
        sink.fail(new Error(SESSION_EXPIRED));
        sink.emit("error", { kind: "session", message: SESSION_EXPIRED, recoverable: false });
        return;
      }
      callback(token);
    })
    .catch((reason: unknown) => {
      if (sink.disposed()) return;
      const message = sessionMessage(reason);
      sink.emit("error", { kind: "session", message, recoverable: false });
      sink.fail(new Error(message));
    });
}

export function bindPlayerEvents(player: SpotifyPlayer, sink: SdkEventSink) {
  let authRefreshing = false;
  let authRetried = false;

  const expire = () => {
    if (sink.disposed()) return;
    const error = new Error(SESSION_EXPIRED);
    sink.emit("error", { kind: "authentication", message: SESSION_EXPIRED, recoverable: false });
    sink.fail(error, true);
    sink.dispose();
  };

  const resetAuth = () => {
    authRefreshing = false;
    authRetried = false;
  };

  player.addListener("ready", (event) => {
    if (!sink.listening()) return;
    resetAuth();
    const deviceId = deviceIdFrom(event);
    sink.setDeviceId(deviceId);
    sink.emit("ready", deviceId);
    sink.ready();
  });
  player.addListener("not_ready", () => {
    sink.setDeviceId("");
    if (!sink.disposed()) sink.emit("not_ready");
  });
  player.addListener("player_state_changed", (event) => {
    if (!sink.listening()) return;
    sink.emit("state", isPlaybackState(event) ? event : null);
  });
  player.addListener("autoplay_failed", () => {
    const message = sink.activationDeferred() ? PRESS_PLAY_AGAIN : PRESS_PLAY_TO_START;
    sink.emit("error", { kind: "autoplay", message, recoverable: true });
  });
  player.addListener("initialization_error", () => {
    sink.emit("error", { kind: "initialization", message: SDK_BROWSER_MESSAGE, recoverable: false });
    sink.fail(new Error(SDK_BROWSER_MESSAGE), true);
  });
  player.addListener("authentication_error", () => {
    if (!sink.listening()) return;
    if (authRefreshing) return;
    if (authRetried) {
      expire();
      return;
    }
    authRefreshing = true;
    void sink
      .readToken({ force: true })
      .then((token) => {
        authRefreshing = false;
        if (!sink.listening()) return;
        if (!token) {
          expire();
          return;
        }
        authRetried = true;
        void player.connect().catch(() => {});
      })
      .catch(() => {
        authRefreshing = false;
        if (!sink.listening()) return;
        expire();
      });
  });
  player.addListener("account_error", (event) => {
    const raw = eventMessage(event);
    const message = /premium/i.test(raw) ? PREMIUM_REQUIRED : raw || TRACK_ERROR;
    sink.emit("error", { kind: "account", message, recoverable: false });
    if (!sink.deviceId()) sink.fail(new Error(message));
  });
  player.addListener("playback_error", (event) => {
    const message = eventMessage(event) || TRACK_ERROR;
    sink.emit("error", { kind: "playback", message, recoverable: true });
  });

  return resetAuth;
}

export class ReadyLatch {
  terminal: Error | null = null;
  private promise: Promise<string> | null = null;
  private settle: ((error?: Error) => void) | null = null;
  private timerOn = false;
  private timerHandle: unknown = null;
  private readonly timer: SdkTimer;
  private readonly timeoutMs: number;
  private readonly deviceId: () => string;

  constructor(timer: SdkTimer, timeoutMs: number, deviceId: () => string) {
    this.timer = timer;
    this.timeoutMs = timeoutMs;
    this.deviceId = deviceId;
  }

  arm(timeoutMessage: string) {
    if (this.terminal) return Promise.reject(this.terminal);
    const current = this.deviceId();
    if (current) return Promise.resolve(current);
    if (this.promise) return this.promise;
    this.promise = new Promise<string>((resolve, reject) => {
      this.settle = (error) => {
        if (error) reject(error);
        else resolve(this.deviceId());
      };
    });
    void this.promise.catch(() => {});
    this.timerOn = true;
    this.timerHandle = this.timer.setTimeout(() => {
      this.fail(new Error(timeoutMessage));
    }, this.timeoutMs);
    return this.promise;
  }

  succeed() {
    const settle = this.settle;
    this.settle = null;
    this.promise = null;
    this.clear();
    settle?.();
  }

  fail(error: Error, terminal = false) {
    if (terminal) this.terminal = error;
    const settle = this.settle;
    this.settle = null;
    this.promise = null;
    this.clear();
    settle?.(error);
  }

  private clear() {
    if (!this.timerOn) return;
    this.timerOn = false;
    this.timer.clearTimeout(this.timerHandle);
  }
}
