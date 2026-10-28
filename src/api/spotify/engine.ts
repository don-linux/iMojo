import type { EngineEventMap, PlaybackClock, PlaybackEngine } from "../engine.ts";
import { SpotifyRequestError, spotifySend } from "./api.ts";
import { getAccessToken } from "./auth.ts";
import { readProfile } from "./storage.ts";

type SpotifyPlaybackState = {
  paused: boolean;
  position: number;
  duration: number;
  timestamp: number;
  track_window: {
    current_track: { uri: string | null } | null;
  };
};

type SpotifyPlayer = {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(name: "ready", callback: (event: { device_id: string }) => void): void;
  addListener(name: "not_ready", callback: (event: { device_id: string }) => void): void;
  addListener(
    name: "player_state_changed",
    callback: (state: SpotifyPlaybackState | null) => void,
  ): void;
  addListener(
    name: "initialization_error" | "authentication_error" | "account_error" | "playback_error",
    callback: (event: { message: string }) => void,
  ): void;
  getCurrentState(): Promise<SpotifyPlaybackState | null>;
  setVolume(volume: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  activateElement(): Promise<void>;
};

type SpotifySdk = {
  Player: new (options: {
    name: string;
    getOAuthToken: (callback: (token: string) => void) => void;
    volume?: number;
  }) => SpotifyPlayer;
};

declare global {
  interface Window {
    Spotify?: SpotifySdk;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

const EMPTY_CLOCK: PlaybackClock = { currentTime: 0, duration: 0 };

const CONNECT_TIMEOUT_MS = 15_000;

function premiumMessage() {
  const product = readProfile()?.product;
  if (product && product !== "premium") return "Spotify Premium is required to play";
  return null;
}

function isScopeWarning(message: string) {
  return /scope/i.test(message);
}

function errorText(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function waitForSdk() {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(
      () => reject(new Error("Spotify player did not load")),
      CONNECT_TIMEOUT_MS,
    );
  });
  return Promise.race([loadSdk(), timeout]).finally(() => window.clearTimeout(timer));
}

function loadSdk() {
  if (window.Spotify) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const previous = window.onSpotifyWebPlaybackSDKReady;
    window.onSpotifyWebPlaybackSDKReady = () => {
      previous?.();
      resolve();
    };
    if (!document.querySelector("script[data-spotify-sdk]")) {
      const script = document.createElement("script");
      script.src = "https://sdk.scdn.co/spotify-player.js";
      script.async = true;
      script.dataset.spotifySdk = "true";
      document.body.appendChild(script);
    }
  });
}

let activeEngine: SpotifySdkEngine | null = null;

function setActiveEngine(engine: SpotifySdkEngine | null) {
  activeEngine = engine;
}

export function primeSpotifyPlayback() {
  activeEngine?.prime();
}

export function warmSpotifyPlayer() {
  void activeEngine?.warm();
}

export class SpotifySdkEngine implements PlaybackEngine {
  private player: SpotifyPlayer | null = null;
  private connecting: Promise<void> | null = null;
  private settleConnect: ((error?: Error) => void) | null = null;
  private connectTimer = 0;
  private sdkMessage: string | null = null;
  private sdkToken = "";
  private handedToken = "";
  private tokenQueue: Promise<void> = Promise.resolve();
  private tokenGeneration = 0;
  private authRetry: "idle" | "armed" | "live" = "idle";
  private needsFreshToken = false;
  private playerInitFailed = false;
  private initError = "";
  private wantsActivation = false;
  private destroyed = false;
  private deviceId = "";
  private uri = "";
  private nextUri: string | null = null;
  private volume = 1;
  private paused = true;
  private finishing = false;
  private clock: PlaybackClock = EMPTY_CLOCK;
  private anchor = { position: 0, at: 0, duration: 0, paused: true };
  private frame = 0;
  private listeners: { [K in keyof EngineEventMap]: Set<EngineEventMap[K]> } = {
    clock: new Set(),
    loaded: new Set(),
    play: new Set(),
    pause: new Set(),
    ended: new Set(),
    error: new Set(),
    advance: new Set(),
    handoff: new Set(),
    revert: new Set(),
  };

  constructor() {
    setActiveEngine(this);
    void loadSdk();
  }

  private emit<K extends keyof EngineEventMap>(event: K, ...args: Parameters<EngineEventMap[K]>) {
    for (const handler of this.listeners[event]) {
      (handler as (...values: Parameters<EngineEventMap[K]>) => void)(...args);
    }
  }

  prime() {
    this.wantsActivation = true;
    void (this.player ?? this.createPlayer())?.activateElement();
  }

  warm() {
    void loadSdk();
  }

  private createPlayer() {
    if (this.playerInitFailed || this.destroyed) return this.player;
    if (this.player) return this.player;
    const sdk = window.Spotify;
    if (!sdk) return null;
    const player = new sdk.Player({
      name: "iPod",
      volume: this.volume,
      getOAuthToken: (callback) => this.deliverToken(callback),
    });
    this.player = player;
    player.addListener("ready", ({ device_id }) => {
      if (this.player !== player || this.playerInitFailed) return;
      this.deviceId = device_id;
      this.finishConnect();
    });
    player.addListener("not_ready", () => {
      if (this.player !== player || !this.deviceId) return;
      this.deviceId = "";
    });
    player.addListener("account_error", () => {
      if (this.player !== player) return;
      this.rejectConnect("Spotify Premium is required to play");
    });
    player.addListener("initialization_error", ({ message }) => {
      if (this.player !== player) return;
      // The SDK emits this when EME cannot build a player. Reloading the
      // script destroys the encrypted-media iframe and cannot recover it.
      const text = message || "Failed to initialize player";
      this.playerInitFailed = true;
      this.initError = text;
      this.rejectConnect(text);
    });
    player.addListener("authentication_error", ({ message }) => {
      if (this.player !== player) return;
      const text = message || "Authentication failed";
      // A scope warning can arrive before `ready`. Keep waiting for the device.
      if (this.settleConnect && isScopeWarning(text)) {
        this.sdkMessage = text;
        return;
      }
      if (this.authRetry === "idle" && this.settleConnect) {
        this.sdkMessage = text;
        this.retryAuthConnect();
        return;
      }
      // The retry is in flight and this event still belongs to the previous token.
      if (this.authRetry === "armed") {
        this.sdkMessage = text;
        return;
      }
      this.rejectConnect(text);
    });
    player.addListener("playback_error", ({ message }) => {
      if (this.player !== player) return;
      this.fail(message);
    });
    player.addListener("player_state_changed", (state) => {
      if (this.player !== player) return;
      this.onState(state);
    });
    return player;
  }

  private deliverToken(callback: (token: string) => void) {
    // `getOAuthToken` is invoked as a Promise executor and must resolve once.
    // The embedded transport rejects a second delivery of the same access token.
    const generation = this.tokenGeneration;
    const deliver = this.tokenQueue.then(async () => {
      if (generation !== this.tokenGeneration || this.destroyed) return;
      const fresh = this.needsFreshToken;
      this.needsFreshToken = false;
      let token =
        !fresh && !this.handedToken && this.sdkToken ? this.sdkToken : await getAccessToken(true);
      if (generation !== this.tokenGeneration || this.destroyed) return;
      if (token === this.handedToken) token = await getAccessToken(true);
      if (generation !== this.tokenGeneration || this.destroyed) return;
      if (!token || token === this.handedToken) throw new Error("Spotify player did not connect");
      this.sdkToken = token;
      this.handedToken = token;
      if (this.authRetry === "armed") this.authRetry = "live";
      callback(token);
    });
    this.tokenQueue = deliver.then(
      () => undefined,
      () => undefined,
    );
    void deliver.catch((reason: unknown) => {
      if (generation !== this.tokenGeneration || this.destroyed) return;
      this.rejectConnect(errorText(reason, "Connect Spotify to play"));
    });
  }

  private blockInitializedPlayer() {
    if (!this.playerInitFailed) return false;
    const message = this.initError || "Failed to initialize player";
    this.fail(message);
    return true;
  }

  private async ensurePlayer() {
    if (this.destroyed) return;
    if (this.blockInitializedPlayer()) {
      throw new Error(this.initError || "Failed to initialize player");
    }
    if (this.player && this.deviceId) return;
    const current = this.connecting;
    if (current) {
      await current;
      if (this.destroyed) return;
      if (this.blockInitializedPlayer()) {
        throw new Error(this.initError || "Failed to initialize player");
      }
      if (this.player && this.deviceId) return;
      if (this.connecting && this.connecting !== current) {
        await this.connecting;
        return;
      }
    }
    if (this.player && !this.deviceId && current) {
      this.player.disconnect();
      this.player = null;
      this.handedToken = "";
      this.sdkToken = "";
    }
    const attempt = this.connectPlayer();
    this.connecting = attempt;
    try {
      await attempt;
      if (this.destroyed) return;
    } catch (reason) {
      if (this.connecting === attempt) this.connecting = null;
      this.deviceId = "";
      this.finishConnect();
      this.player?.disconnect();
      if (!this.playerInitFailed) {
        this.player = null;
        this.handedToken = "";
        this.sdkToken = "";
      }
      const message = errorText(reason, "Spotify player did not connect");
      this.fail(message);
      throw reason instanceof Error ? reason : new Error(message);
    }
  }

  private armConnectTimer() {
    if (this.connectTimer) window.clearTimeout(this.connectTimer);
    this.connectTimer = window.setTimeout(() => {
      this.finishConnect(new Error(this.sdkMessage ?? "Spotify player did not connect"));
    }, CONNECT_TIMEOUT_MS);
  }

  private retryAuthConnect() {
    const player = this.player;
    if (
      this.authRetry !== "idle" ||
      !this.settleConnect ||
      !player ||
      this.playerInitFailed ||
      this.deviceId
    ) {
      return;
    }
    this.authRetry = "armed";
    this.needsFreshToken = true;
    this.armConnectTimer();
    // `connect()` asks for a token again. The next callback must be a new string.
    void player.connect().then(
      () => undefined,
      () => undefined,
    );
  }

  private async connectPlayer() {
    await waitForSdk();
    if (this.destroyed || activeEngine !== this) return;
    this.tokenGeneration += 1;
    this.tokenQueue = Promise.resolve();
    this.handedToken = "";
    this.authRetry = "idle";
    this.needsFreshToken = false;
    this.sdkToken = await getAccessToken();
    if (this.destroyed || activeEngine !== this) return;
    const player = this.createPlayer();
    if (!player) throw new Error("Spotify player did not load");
    if (this.wantsActivation) void player.activateElement();
    if (this.deviceId) return;

    this.sdkMessage = null;
    await new Promise<void>((resolve, reject) => {
      const settle = (error?: Error) => {
        if (this.settleConnect !== settle) return;
        this.settleConnect = null;
        if (this.connectTimer) {
          window.clearTimeout(this.connectTimer);
          this.connectTimer = 0;
        }
        if (error) {
          this.fail(error.message);
          reject(error);
          return;
        }
        this.sdkMessage = null;
        resolve();
      };
      this.settleConnect = settle;
      this.armConnectTimer();
      // `connect()` can resolve false before `ready`. Retry auth once, then
      // keep waiting for the device id.
      void player.connect().then(
        (connected) => {
          if (this.deviceId || this.settleConnect !== settle || this.playerInitFailed) return;
          if (connected === false) this.retryAuthConnect();
        },
        () => undefined,
      );
    });

    if (this.destroyed || activeEngine !== this) return;
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  }

  private rejectConnect(message: string) {
    if (this.settleConnect) this.finishConnect(new Error(message));
    else this.fail(message);
  }

  private finishConnect(error?: Error) {
    this.settleConnect?.(error);
  }

  private fail(message: string) {
    this.paused = true;
    this.emit("error", message || "This track cannot be played");
  }

  private onState(state: SpotifyPlaybackState | null) {
    if (!state) return;
    const lag = Date.now() - state.timestamp;
    this.anchor = {
      position: state.position,
      at: performance.now() - (Number.isFinite(lag) ? lag : 0),
      duration: state.duration,
      paused: state.paused,
    };
    this.paused = state.paused;
    this.publishClock();
    if (
      state.paused &&
      state.duration > 0 &&
      state.position > 800 &&
      state.position >= state.duration - 1200 &&
      state.track_window.current_track?.uri === this.uri
    ) {
      void this.finishTrack();
    }
  }

  private publishClock() {
    const elapsed = this.anchor.paused ? 0 : performance.now() - this.anchor.at;
    const position = Math.min(this.anchor.duration, Math.max(0, this.anchor.position + elapsed));
    this.clock = {
      currentTime: position / 1000,
      duration: this.anchor.duration / 1000,
    };
    this.emit("clock", this.clock);
  }

  private tick = () => {
    this.publishClock();
    if (!this.anchor.paused && this.anchor.duration > 0) {
      const position = this.anchor.position + (performance.now() - this.anchor.at);
      if (position >= this.anchor.duration - 250) void this.finishTrack();
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  private async startUri(uri: string) {
    const blocked = premiumMessage();
    if (blocked) throw new Error(blocked);
    await this.ensurePlayer();
    if (this.destroyed) return;
    this.prime();
    if (!this.deviceId) throw new Error(this.sdkMessage ?? "Spotify player did not connect");
    const access = await getAccessToken();
    try {
      await spotifySend(
        "PUT",
        `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(this.deviceId)}`,
        access,
        { uris: [uri] },
      );
    } catch (reason) {
      if (reason instanceof SpotifyRequestError) throw new Error(reason.message);
      throw reason;
    }
    this.uri = uri;
    this.finishing = false;
    this.paused = false;
    this.anchor = { position: 0, at: performance.now(), duration: 0, paused: false };
  }

  private async finishTrack() {
    if (this.finishing) return;
    this.finishing = true;
    const next = this.nextUri;
    if (!next) {
      this.paused = true;
      this.anchor = { ...this.anchor, paused: true };
      this.emit("ended");
      return;
    }
    this.nextUri = null;
    this.uri = next;
    this.emit("handoff");
    try {
      await this.startUri(next);
      this.publishClock();
      this.emit("advance", this.clock);
      this.emit("play");
    } catch (reason) {
      this.fail(reason instanceof Error ? reason.message : "This track cannot be played");
    }
  }

  on<K extends keyof EngineEventMap>(event: K, handler: EngineEventMap[K]) {
    this.listeners[event].add(handler);
    return () => {
      this.listeners[event].delete(handler);
    };
  }

  async load(uri: string) {
    this.uri = uri;
    this.nextUri = null;
    this.finishing = false;
    this.clock = EMPTY_CLOCK;
    this.anchor = { position: 0, at: performance.now(), duration: 0, paused: true };
    this.emit("clock", this.clock);
    const blocked = premiumMessage();
    if (blocked) {
      this.fail(blocked);
      throw new Error(blocked);
    }
    await this.ensurePlayer();
    if (this.destroyed) return;
    this.emit("loaded", this.clock);
  }

  setNext(uri: string | null) {
    this.nextUri = uri;
    if (uri && this.finishing && this.paused) {
      this.finishing = false;
      void this.finishTrack();
    }
  }

  async play() {
    this.prime();
    if (!this.uri) throw new Error("No track loaded");
    const blocked = premiumMessage();
    if (blocked) throw new Error(blocked);
    await this.ensurePlayer();
    if (this.destroyed) return;
    const state = await this.player?.getCurrentState();
    if (state?.track_window.current_track?.uri === this.uri && state.paused) {
      await this.player?.resume();
    } else if (state?.track_window.current_track?.uri !== this.uri) {
      await this.startUri(this.uri);
    }
    this.paused = false;
    this.finishing = false;
    this.anchor = { ...this.anchor, paused: false, at: performance.now() };
    this.emit("play");
  }

  pause() {
    this.paused = true;
    this.anchor = {
      ...this.anchor,
      paused: true,
      position: this.clock.currentTime * 1000,
      at: performance.now(),
    };
    void this.player?.pause();
    this.emit("pause");
  }

  stop() {
    this.uri = "";
    this.nextUri = null;
    this.finishing = false;
    this.paused = true;
    void this.player?.pause();
    this.clock = EMPTY_CLOCK;
    this.anchor = { position: 0, at: performance.now(), duration: 0, paused: true };
    this.emit("clock", this.clock);
  }

  seek(seconds: number) {
    const position = Math.max(0, seconds * 1000);
    this.anchor = { ...this.anchor, position, at: performance.now() };
    this.publishClock();
    void this.player?.seek(Math.round(position));
  }

  setVolume(volume: number) {
    this.volume = volume;
    void this.player?.setVolume(volume);
  }

  getClock() {
    return this.clock;
  }

  isPaused() {
    return this.paused;
  }

  destroy() {
    this.destroyed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.finishConnect();
    this.deviceId = "";
    this.player?.disconnect();
    this.player = null;
    this.connecting = null;
    if (activeEngine === this) setActiveEngine(null);
    for (const set of Object.values(this.listeners)) set.clear();
  }
}
