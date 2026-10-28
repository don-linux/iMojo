import { getAccessToken } from "./auth.ts";
import { loadSpotifySdk } from "./sdkLoader.ts";
import {
  bindPlayerEvents,
  bindSignal,
  browserTimer,
  deliverToken,
  readWindowSdk,
  ReadyLatch,
  type SdkEventSink,
  type SdkPlayerEventMap,
  type SpotifySdkPlayerOptions,
  type TokenReader,
} from "./sdkPlayerEvents.ts";
import {
  PLAYER_NAME,
  PLAYER_NOT_CONNECTED,
  PLAYER_NOT_LOADED,
  SDK_READY_TIMEOUT_MS,
  type SdkTimer,
  type SpotifyPlayer,
  type SpotifySdk,
} from "./sdkTypes.ts";

export type {
  SdkPlayerError,
  SdkPlayerErrorKind,
  SdkPlayerEventMap,
  SpotifySdkPlayerOptions,
  TokenReader,
} from "./sdkPlayerEvents.ts";

function disposedError() {
  const error = new Error("Spotify player was disposed");
  error.name = "AbortError";
  return error;
}

function safeDisconnect(player: SpotifyPlayer | null) {
  if (!player) return;
  try {
    player.disconnect();
  } catch {
    // Teardown is best-effort; the instance is already unusable.
  }
}

/**
 * Web Playback SDK lifecycle. `activate()` must run inside the user gesture:
 * Safari only treats `activateElement()` as a gesture if it is synchronous.
 * If the SDK script is not loaded yet, the gesture is remembered and loading
 * starts; the first play can then fail with "Press play again".
 */
export class SpotifySdkPlayer {
  private readonly name: string;
  private readonly loadSdk: (signal?: AbortSignal) => Promise<void>;
  private readonly token: TokenReader;
  private readonly fixedSdk: SpotifySdk | undefined;
  private readonly readSdk: () => SpotifySdk | undefined;
  private readonly readyTimeoutMs: number;
  private readonly timer: SdkTimer;
  private readonly handlers: { [K in keyof SdkPlayerEventMap]: Set<SdkPlayerEventMap[K]> } = {
    ready: new Set(),
    not_ready: new Set(),
    state: new Set(),
    error: new Set(),
  };

  private volume: number;
  private sdk: SpotifySdk | undefined;
  private player: SpotifyPlayer | null = null;
  private deviceIdValue = "";
  private isDisposed = false;
  private wantsActivation = false;
  private deferredActivation = false;
  private opening: Promise<string> | null = null;
  private readonly ready: ReadyLatch;

  constructor(options: SpotifySdkPlayerOptions = {}) {
    this.name = options.name ?? PLAYER_NAME;
    this.volume = options.volume ?? 1;
    this.loadSdk = options.loadSdk ?? ((signal) => loadSpotifySdk(signal));
    this.token = options.getAccessToken ?? ((request) => getAccessToken(request));
    this.fixedSdk = options.sdk;
    this.readSdk = options.readSdk ?? readWindowSdk;
    this.readyTimeoutMs = options.readyTimeoutMs ?? SDK_READY_TIMEOUT_MS;
    this.timer = options.timer ?? browserTimer();
    this.ready = new ReadyLatch(this.timer, this.readyTimeoutMs, () => this.deviceIdValue);
  }

  get disposed() {
    return this.isDisposed;
  }

  get deviceId() {
    return this.deviceIdValue;
  }

  on<K extends keyof SdkPlayerEventMap>(event: K, handler: SdkPlayerEventMap[K]) {
    this.handlers[event].add(handler);
    return () => {
      this.handlers[event].delete(handler);
    };
  }

  preload() {
    if (this.isDisposed || this.fixedSdk || this.sdk) return;
    void this.loadSdk()
      .then(() => {
        if (!this.isDisposed) this.pullSdk();
      })
      .catch(() => {});
  }

  activate() {
    if (this.isDisposed) return;
    this.wantsActivation = true;
    if (!this.pullSdk()) {
      this.deferredActivation = true;
      this.preload();
      return;
    }
    const player = this.instantiate();
    if (!player) return;
    void player.activateElement();
    this.deferredActivation = false;
  }

  connect(signal?: AbortSignal) {
    return this.whenReady(signal);
  }

  whenReady(signal?: AbortSignal) {
    if (this.isDisposed) return Promise.reject(this.ready.terminal ?? disposedError());
    if (this.ready.terminal) return Promise.reject(this.ready.terminal);
    if (this.deviceIdValue) return Promise.resolve(this.deviceIdValue);
    if (!this.opening) {
      const flight = this.open().finally(() => {
        if (this.opening === flight) this.opening = null;
      });
      this.opening = flight;
    }
    return bindSignal(this.opening, signal);
  }

  getCurrentState() {
    const player = this.player;
    if (!player || this.isDisposed) return Promise.resolve(null);
    return player.getCurrentState();
  }

  pause() {
    const player = this.player;
    if (!player || this.isDisposed) return Promise.resolve();
    return player.pause();
  }

  resume() {
    const player = this.player;
    if (!player || this.isDisposed) return Promise.resolve();
    return player.resume();
  }

  seek(positionMs: number) {
    const player = this.player;
    if (!player || this.isDisposed) return Promise.resolve();
    return player.seek(positionMs);
  }

  setVolume(volume: number) {
    this.volume = volume;
    if (!this.player || this.isDisposed) return;
    void this.player.setVolume(volume);
  }

  dispose() {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.deviceIdValue = "";
    this.ready.fail(this.ready.terminal ?? disposedError());
    const player = this.player;
    this.player = null;
    safeDisconnect(player);
  }

  private emit<K extends keyof SdkPlayerEventMap>(
    event: K,
    ...args: Parameters<SdkPlayerEventMap[K]>
  ) {
    for (const handler of this.handlers[event]) {
      (handler as (...values: Parameters<SdkPlayerEventMap[K]>) => void)(...args);
    }
  }

  private sink(): SdkEventSink {
    return {
      disposed: () => this.isDisposed,
      deviceId: () => this.deviceIdValue,
      setDeviceId: (id) => {
        this.deviceIdValue = id;
      },
      activationDeferred: () => this.deferredActivation,
      readToken: (options) => this.token(options),
      emit: (event, ...args) => this.emit(event, ...args),
      ready: () => this.ready.succeed(),
      fail: (error, terminal) => this.ready.fail(error, terminal),
      dispose: () => this.dispose(),
    };
  }

  private pullSdk() {
    if (this.sdk) return this.sdk;
    const found = this.fixedSdk ?? this.readSdk();
    if (found) this.sdk = found;
    return this.sdk;
  }

  private instantiate() {
    if (this.isDisposed) return null;
    if (this.player) return this.player;
    const sdk = this.pullSdk();
    if (!sdk) return null;
    const created = new sdk.Player({
      name: this.name,
      volume: this.volume,
      getOAuthToken: (callback) => deliverToken(this.sink(), callback),
    });
    if (this.isDisposed) {
      safeDisconnect(created);
      return null;
    }
    this.player = created;
    bindPlayerEvents(created, this.sink());
    return created;
  }

  private async open() {
    if (this.isDisposed) throw this.ready.terminal ?? disposedError();
    if (this.ready.terminal) throw this.ready.terminal;
    await this.ensureLoaded();
    if (this.isDisposed) throw this.ready.terminal ?? disposedError();
    const player = this.instantiate();
    if (!player) throw this.ready.terminal ?? disposedError();
    // Outside the original gesture when the script had to load first.
    if (this.wantsActivation) void player.activateElement();
    if (this.deviceIdValue) return this.deviceIdValue;
    const ready = this.ready.arm(PLAYER_NOT_CONNECTED);
    const connected = player.connect().then(
      (ok) => ok,
      (reason: unknown) => {
        const error = reason instanceof Error ? reason : new Error(PLAYER_NOT_CONNECTED);
        this.ready.fail(error);
        throw error;
      },
    );
    void connected.catch(() => {});
    try {
      await Promise.race([connected, ready]);
    } catch (reason) {
      if (this.isDisposed) safeDisconnect(player);
      throw reason;
    }
    if (this.isDisposed) {
      safeDisconnect(player);
      throw this.ready.terminal ?? disposedError();
    }
    if (this.deviceIdValue) return this.deviceIdValue;
    return ready;
  }

  private async ensureLoaded() {
    if (this.pullSdk()) return;
    await this.loadSdk();
    if (this.isDisposed) return;
    if (!this.pullSdk()) throw new Error(PLAYER_NOT_LOADED);
  }
}
