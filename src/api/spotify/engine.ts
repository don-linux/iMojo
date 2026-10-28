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

function premiumMessage() {
  const product = readProfile()?.product;
  if (product && product !== "premium") return "Spotify Premium is required to play";
  return null;
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
    void this.player?.activateElement();
  }

  warm() {
    void this.ensurePlayer();
  }

  private async ensurePlayer() {
    if (!this.connecting) {
      this.connecting = this.connectPlayer().catch((reason: unknown) => {
        this.connecting = null;
        throw reason;
      });
    }
    await this.connecting;
  }

  private async connectPlayer() {
    await loadSdk();
    const sdk = window.Spotify;
    if (!sdk) throw new Error("Spotify player did not load");
    const player = new sdk.Player({
      name: "iPod",
      volume: this.volume,
      getOAuthToken: (callback) => {
        void getAccessToken()
          .then(callback)
          .catch(() => callback(""));
      },
    });
    this.player = player;
    const ready = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("Spotify player did not connect")),
        15000,
      );
      player.addListener("ready", ({ device_id }) => {
        window.clearTimeout(timer);
        this.deviceId = device_id;
        resolve();
      });
    });
    player.addListener("player_state_changed", (state) => this.onState(state));
    player.addListener("account_error", () => this.fail("Spotify Premium is required to play"));
    player.addListener("authentication_error", ({ message }) => this.fail(message));
    player.addListener("initialization_error", ({ message }) => this.fail(message));
    player.addListener("playback_error", ({ message }) => this.fail(message));
    const connected = await player.connect();
    if (!connected) throw new Error("Spotify player did not connect");
    await ready;
    this.frame = requestAnimationFrame(this.tick);
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
    const access = await getAccessToken();
    try {
      await spotifySend("PUT", "https://api.spotify.com/v1/me/player", access, {
        device_ids: [this.deviceId],
        play: false,
      });
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
    if (this.frame) cancelAnimationFrame(this.frame);
    this.player?.disconnect();
    this.player = null;
    if (activeEngine === this) setActiveEngine(null);
    for (const set of Object.values(this.listeners)) set.clear();
  }
}
