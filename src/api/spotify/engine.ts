import type { EngineEventMap, PlaybackEngine } from "../engine.ts";
import { BROWSER_PLAYER_NOT_READY } from "./devicePlayback.ts";
import { createEngineListeners, EngineClock } from "./engineClock.ts";
import { abortError, isAbort, messageOf, playUriOnDevice } from "./engineTransfer.ts";
import { ensurePremium } from "./library.ts";
import { SpotifySdkPlayer } from "./sdkPlayer.ts";
import { PLAYER_NAME, PLAYER_NOT_LOADED, TRACK_ERROR, type SpotifyPlaybackState } from "./sdkTypes.ts";
import { spotifyPlaybackSupport } from "./support.ts";

let activeEngine: SpotifySdkEngine | null = null;

function setActiveEngine(engine: SpotifySdkEngine | null) {
  activeEngine = engine;
}

export function primeSpotifyPlayback() {
  activeEngine?.activate();
}

export function warmSpotifyPlayer() {
  void activeEngine?.warm();
}

export function disposeSpotifyPlayer() {
  activeEngine?.releasePlayer();
}

export class SpotifySdkEngine implements PlaybackEngine {
  private sdk: SpotifySdkPlayer | null = null;
  private detachSdk: (() => void) | null = null;
  private unsupported: string | null = null;
  private destroyed = false;
  private halted = false;
  private premiumReady = false;
  private uri = "";
  private nextUri: string | null = null;
  private volume = 1;
  private paused = true;
  private finishing = false;
  private operation: AbortController | null = null;
  private readonly playback = new EngineClock({
    running: () => !this.destroyed && !this.halted,
    emitClock: (clock) => this.emit("clock", clock),
    nearEnd: () => {
      void this.finishTrack();
    },
  });
  private listeners = createEngineListeners();

  constructor() {
    setActiveEngine(this);
    const support = spotifyPlaybackSupport();
    if (!support.ok) {
      this.unsupported = support.reason;
      return;
    }
    this.mountPlayer().preload();
  }
  private emit<K extends keyof EngineEventMap>(event: K, ...args: Parameters<EngineEventMap[K]>) {
    for (const handler of this.listeners[event]) {
      (handler as (...values: Parameters<EngineEventMap[K]>) => void)(...args);
    }
  }
  activate() {
    if (this.destroyed || this.unsupported) return;
    this.livePlayer()?.activate();
  }
  prime() {
    this.activate();
  }
  warm() {
    if (this.destroyed || this.unsupported) return;
    this.halted = false;
    const sdk = this.livePlayer();
    if (!sdk) return;
    void sdk
      .whenReady()
      .then(() => {
        if (!this.destroyed && !this.halted) this.playback.ensure();
      })
      .catch(() => {});
  }

  releasePlayer() {
    this.halted = true;
    this.premiumReady = false;
    this.playback.stop();
    this.operation?.abort();
    this.operation = null;
    this.detachSdk?.();
    this.detachSdk = null;
    const sdk = this.sdk;
    this.sdk = null;
    sdk?.dispose();
  }

  private mountPlayer() {
    const sdk = new SpotifySdkPlayer({ name: PLAYER_NAME, volume: this.volume });
    const offState = sdk.on("state", (state) => {
      if (this.destroyed || this.halted || sdk.disposed) return;
      this.onState(state);
    });
    const offError = sdk.on("error", (error) => {
      if (this.destroyed) return;
      this.fail(error.message);
    });
    this.detachSdk?.();
    this.detachSdk = () => {
      offState();
      offError();
    };
    this.sdk = sdk;
    return sdk;
  }

  private livePlayer() {
    if (this.destroyed || this.unsupported) return null;
    if (!this.sdk || this.sdk.disposed) return this.mountPlayer();
    return this.sdk;
  }

  private beginOperation() {
    this.operation?.abort();
    const controller = new AbortController();
    this.operation = controller;
    return controller.signal;
  }

  private throwIfStopped(signal?: AbortSignal) {
    if (this.destroyed || this.halted || signal?.aborted) throw abortError(signal);
  }

  private async requirePremium(signal: AbortSignal) {
    if (this.premiumReady) return;
    await ensurePremium(signal);
    this.premiumReady = true;
    this.throwIfStopped(signal);
  }

  private async prepare(signal: AbortSignal) {
    this.throwIfStopped(signal);
    await this.requirePremium(signal);
    const sdk = this.livePlayer();
    if (!sdk) throw new Error(this.unsupported ?? PLAYER_NOT_LOADED);
    const deviceId = await sdk.whenReady();
    this.throwIfStopped(signal);
    if (!deviceId) throw new Error(BROWSER_PLAYER_NOT_READY);
    this.playback.ensure();
    return sdk;
  }

  private fail(message: string) {
    this.paused = true;
    this.emit("error", message || TRACK_ERROR);
  }

  private onState(state: SpotifyPlaybackState | null) {
    if (!state) return;
    this.paused = state.paused;
    if (this.playback.note(state, this.uri)) void this.finishTrack();
  }

  private async startUri(uri: string, signal: AbortSignal) {
    const sdk = await this.prepare(signal);
    if (!sdk.deviceId) throw new Error(BROWSER_PLAYER_NOT_READY);
    await playUriOnDevice({
      deviceId: sdk.deviceId,
      uri,
      signal,
      stopped: () => this.destroyed || this.halted,
    });
    this.throwIfStopped(signal);
    this.uri = uri;
    this.finishing = false;
    this.paused = false;
    this.playback.restart();
  }

  private async finishTrack() {
    if (this.finishing) return;
    this.finishing = true;
    const next = this.nextUri;
    if (!next) {
      this.paused = true;
      this.playback.freeze();
      this.emit("ended");
      return;
    }
    this.nextUri = null;
    this.uri = next;
    this.emit("handoff");
    const signal = this.beginOperation();
    try {
      await this.startUri(next, signal);
      this.throwIfStopped(signal);
      this.playback.publish();
      this.emit("advance", this.playback.clock);
      this.emit("play");
    } catch (reason) {
      if (isAbort(reason) || this.halted || this.destroyed) return;
      this.fail(messageOf(reason, TRACK_ERROR));
    }
  }

  on<K extends keyof EngineEventMap>(event: K, handler: EngineEventMap[K]) {
    this.listeners[event].add(handler);
    return () => {
      this.listeners[event].delete(handler);
    };
  }

  async load(uri: string) {
    const signal = this.beginOperation();
    this.uri = uri;
    this.nextUri = null;
    this.finishing = false;
    this.playback.reset();
    try {
      if (this.destroyed) throw abortError();
      if (this.unsupported) throw new Error(this.unsupported);
      this.halted = false;
      await this.prepare(signal);
      this.throwIfStopped(signal);
      this.emit("loaded", this.playback.clock);
    } catch (reason) {
      if (this.destroyed || this.halted || isAbort(reason)) {
        throw reason instanceof Error ? reason : abortError(signal);
      }
      const message = messageOf(reason, TRACK_ERROR);
      this.fail(message);
      throw reason instanceof Error ? reason : new Error(message);
    }
  }

  setNext(uri: string | null) {
    this.nextUri = uri;
    if (uri && this.finishing && this.paused) {
      this.finishing = false;
      void this.finishTrack();
    }
  }

  async play() {
    this.activate();
    if (!this.uri) throw new Error("No track loaded");
    if (this.destroyed) throw abortError();
    if (this.unsupported) throw new Error(this.unsupported);
    this.halted = false;
    const signal = this.beginOperation();
    const sdk = await this.prepare(signal);
    const state = await sdk.getCurrentState();
    this.throwIfStopped(signal);
    if (state?.track_window.current_track?.uri === this.uri && state.paused) {
      await sdk.resume();
    } else if (state?.track_window.current_track?.uri !== this.uri) {
      await this.startUri(this.uri, signal);
    }
    this.throwIfStopped(signal);
    this.paused = false;
    this.finishing = false;
    this.playback.resume();
    this.emit("play");
    this.playback.ensure();
  }
  pause() {
    this.paused = true;
    this.playback.pause();
    void this.sdk?.pause();
    this.emit("pause");
  }
  stop() {
    this.uri = "";
    this.nextUri = null;
    this.finishing = false;
    this.paused = true;
    void this.sdk?.pause();
    this.playback.reset();
  }
  seek(seconds: number) {
    this.playback.seek(seconds);
    void this.sdk?.seek(Math.round(Math.max(0, seconds * 1000)));
  }
  setVolume(volume: number) {
    this.volume = volume;
    this.sdk?.setVolume(volume);
  }
  getClock() {
    return this.playback.clock;
  }
  isPaused() {
    return this.paused;
  }
  destroy() {
    this.destroyed = true;
    this.releasePlayer();
    if (activeEngine === this) setActiveEngine(null);
    for (const set of Object.values(this.listeners)) set.clear();
  }
}
