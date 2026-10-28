export type PlaybackClock = {
  currentTime: number;
  duration: number;
};

export type EngineEventMap = {
  clock: (clock: PlaybackClock) => void;
  loaded: (clock: PlaybackClock) => void;
  play: () => void;
  pause: () => void;
  ended: () => void;
  error: () => void;
  /** The crossfaded-in channel became the displayed track. */
  advance: (clock: PlaybackClock) => void;
  /** The cued track took over playback. The display still lags until `advance`. */
  handoff: () => void;
  /** An unshown crossfade was put back on the cue deck. */
  revert: () => void;
};

/**
 * Minimal playback contract shared by the HTML5 preview engine today and a
 * future Spotify Web Playback SDK engine. The player hook only depends on this
 * surface, never on a concrete audio element.
 */
export type PlaybackEngine = {
  load: (url: string) => Promise<void>;
  /** Cues the next track on the second channel. Pass null to clear it. */
  setNext: (url: string | null) => void;
  play: () => Promise<void>;
  pause: () => void;
  stop: () => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  getClock: () => PlaybackClock;
  isPaused: () => boolean;
  on: <K extends keyof EngineEventMap>(event: K, handler: EngineEventMap[K]) => () => void;
  destroy: () => void;
};

const EMPTY_CLOCK: PlaybackClock = { currentTime: 0, duration: 0 };
export const CROSSFADE_SECONDS = 2;
const PROMOTE_SECONDS = CROSSFADE_SECONDS / 2;
const FADE_MS = CROSSFADE_SECONDS * 1000;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function cosineOut(progress: number) {
  return Math.cos(progress * Math.PI * 0.5);
}

function cosineIn(progress: number) {
  return Math.cos((1 - progress) * Math.PI * 0.5);
}

type Channel = {
  audio: HTMLAudioElement;
  url: string;
  gain: number;
  loaded: boolean;
  fadeFrame: number | null;
  detach: () => void;
};

export class Html5PreviewEngine implements PlaybackEngine {
  private current: Channel | null = null;
  private next: Channel | null = null;
  private display: Channel | null = null;
  private fading = new Set<Channel>();
  private clock: PlaybackClock = EMPTY_CLOCK;
  private volume = 1;
  private triggeredFade = false;
  private fadingOut = false;
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

  private emit<K extends keyof EngineEventMap>(event: K, ...args: Parameters<EngineEventMap[K]>) {
    for (const handler of this.listeners[event]) {
      (handler as (...values: Parameters<EngineEventMap[K]>) => void)(...args);
    }
  }

  private durationOf(channel: Channel) {
    const { duration } = channel.audio;
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  }

  private applyGain(channel: Channel) {
    channel.audio.volume = clamp(this.volume * channel.gain, 0, 1);
  }

  private publishClockFrom(channel: Channel) {
    this.clock = {
      currentTime: channel.audio.currentTime,
      duration: this.durationOf(channel),
    };
    this.emit("clock", this.clock);
  }

  private makeChannel(url: string, gain: number): Channel {
    const audio = new Audio();
    audio.preload = "auto";
    audio.src = url;

    const channel: Channel = {
      audio,
      url,
      gain,
      loaded: false,
      fadeFrame: null,
      detach: () => {},
    };
    this.applyGain(channel);

    const onTime = () => this.handleTime(channel);
    const onMetadata = () => this.handleMetadata(channel);
    const onPlay = () => {
      if (channel === this.current) this.emit("play");
    };
    const onPause = () => {
      if (channel === this.current) this.emit("pause");
    };
    const onEnded = () => this.handleEnded(channel);
    const onError = () => this.handleError(channel);

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMetadata);
    audio.addEventListener("durationchange", onMetadata);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    channel.detach = () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMetadata);
      audio.removeEventListener("durationchange", onMetadata);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      if (channel.fadeFrame !== null) {
        cancelAnimationFrame(channel.fadeFrame);
        channel.fadeFrame = null;
      }
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };

    audio.load();
    return channel;
  }

  private destroyChannel(channel: Channel | null) {
    if (!channel) return;
    channel.detach();
    this.fading.delete(channel);
    if (this.next === channel) this.next = null;
    if (this.display === channel) this.display = null;
    if (this.current === channel) this.current = null;
  }

  private destroyAllChannels() {
    const channels = new Set<Channel>();
    if (this.current) channels.add(this.current);
    if (this.next) channels.add(this.next);
    if (this.display) channels.add(this.display);
    for (const channel of this.fading) channels.add(channel);
    this.fading.clear();
    this.current = null;
    this.next = null;
    this.display = null;
    for (const channel of channels) channel.detach();
  }

  private cancelFade(channel: Channel) {
    if (channel.fadeFrame === null) return;
    cancelAnimationFrame(channel.fadeFrame);
    channel.fadeFrame = null;
  }

  private fadeChannel(
    channel: Channel,
    from: number,
    to: number,
    duration: number,
    easing: (progress: number) => number,
    done?: () => void,
  ) {
    this.cancelFade(channel);
    channel.gain = from;
    this.applyGain(channel);
    const started = performance.now();

    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      channel.gain = from + (to - from) * easing(progress);
      this.applyGain(channel);
      if (progress < 1) {
        channel.fadeFrame = requestAnimationFrame(step);
        return;
      }
      channel.fadeFrame = null;
      done?.();
    };

    channel.fadeFrame = requestAnimationFrame(step);
  }

  private handleMetadata(channel: Channel) {
    if (channel !== this.display) return;
    this.publishClockFrom(channel);
    const duration = this.durationOf(channel);
    if (!channel.loaded && duration > 0) {
      channel.loaded = true;
      this.emit("loaded", this.clock);
    }
  }

  private promote(channel: Channel) {
    if (this.display === channel) return;
    this.display = channel;
    this.publishClockFrom(channel);
    const duration = this.durationOf(channel);
    if (!channel.loaded && duration > 0) {
      channel.loaded = true;
      this.emit("loaded", this.clock);
    }
    this.emit("advance", this.clock);
  }

  private handleTime(channel: Channel) {
    if (channel === this.display) this.publishClockFrom(channel);
    if (channel !== this.current) return;

    if (channel !== this.display && channel.audio.currentTime >= PROMOTE_SECONDS) {
      this.promote(channel);
    }

    const duration = this.durationOf(channel);
    if (this.triggeredFade || duration <= CROSSFADE_SECONDS) return;
    if (channel.audio.currentTime < duration - CROSSFADE_SECONDS) return;

    this.triggeredFade = true;
    if (this.next) this.crossfadeToNext();
    else this.fadeOutCurrent();
  }

  private handleEnded(channel: Channel) {
    if (channel !== this.current) return;
    if (channel !== this.display) this.promote(channel);
    if (this.next) {
      this.crossfadeToNext();
      return;
    }
    this.emit("ended");
  }

  private handleError(channel: Channel) {
    if (channel === this.current) {
      this.emit("error");
      return;
    }
    if (channel === this.next) this.destroyChannel(channel);
  }

  private crossfadeToNext() {
    const outgoing = this.current;
    const incoming = this.next;
    if (!outgoing || !incoming) return;

    this.next = null;
    this.current = incoming;
    this.fading.add(outgoing);
    this.triggeredFade = false;
    this.fadingOut = false;

    incoming.gain = 0;
    this.applyGain(incoming);
    this.emit("handoff");
    void incoming.audio.play().catch(() => {
      if (this.current !== incoming) return;
      this.emit("error");
      this.promote(incoming);
    });
    this.fadeChannel(incoming, 0, 1, FADE_MS, cosineIn);
    this.fadeChannel(outgoing, outgoing.gain, 0, FADE_MS, cosineOut, () => {
      this.destroyChannel(outgoing);
      if (this.current === incoming && this.display !== incoming) this.promote(incoming);
    });
  }

  private fadeOutCurrent() {
    const current = this.current;
    if (!current) return;
    this.fadingOut = true;
    this.fadeChannel(current, current.gain, 0, FADE_MS, cosineOut);
  }

  on<K extends keyof EngineEventMap>(event: K, handler: EngineEventMap[K]) {
    this.listeners[event].add(handler);
    return () => {
      this.listeners[event].delete(handler);
    };
  }

  load(url: string) {
    this.destroyAllChannels();
    this.triggeredFade = false;
    this.fadingOut = false;
    this.clock = EMPTY_CLOCK;
    this.emit("clock", this.clock);
    const channel = this.makeChannel(url, 1);
    this.current = channel;
    this.display = channel;
    return Promise.resolve();
  }

  setNext(url: string | null) {
    if (url === null) {
      if (this.next) this.destroyChannel(this.next);
      return;
    }
    if (this.next?.url === url) return;
    if (this.next) this.destroyChannel(this.next);
    if (!this.current) return;

    this.next = this.makeChannel(url, 0);
    if (!this.fadingOut || !this.current) return;

    // The current track had already started fading out before the next one
    // became available. Restore it and run a proper crossfade instead.
    this.cancelFade(this.current);
    this.current.gain = 1;
    this.applyGain(this.current);
    this.fadingOut = false;
    this.triggeredFade = true;
    this.crossfadeToNext();
  }

  async play() {
    const current = this.current;
    if (!current) throw new Error("No track loaded");
    this.cancelFade(current);
    current.gain = 1;
    this.applyGain(current);
    this.triggeredFade = false;
    this.fadingOut = false;
    await current.audio.play();
  }

  /**
   * Puts a crossfade that has not been shown yet back on the cue deck.
   * The display channel stays the current one.
   */
  private reclaimDisplay() {
    if (!this.current || this.display === this.current) return false;
    const incoming = this.current;
    const outgoing = this.display;
    this.current = outgoing;
    this.display = outgoing;
    incoming.audio.pause();
    this.cancelFade(incoming);
    incoming.gain = 0;
    incoming.audio.currentTime = 0;
    this.applyGain(incoming);
    if (outgoing) {
      this.cancelFade(outgoing);
      outgoing.gain = 1;
      this.applyGain(outgoing);
      this.fading.delete(outgoing);
    }
    this.next = incoming;
    this.triggeredFade = false;
    this.fadingOut = false;
    return true;
  }

  pause() {
    const reverted = this.reclaimDisplay();

    for (const channel of [...this.fading]) {
      this.cancelFade(channel);
      this.destroyChannel(channel);
    }

    const current = this.current;
    if (current) {
      this.cancelFade(current);
      current.gain = 1;
      this.applyGain(current);
      current.audio.pause();
    }
    this.next?.audio.pause();
    this.triggeredFade = false;
    this.fadingOut = false;
    if (reverted) this.emit("revert");
  }

  stop() {
    this.destroyAllChannels();
    this.triggeredFade = false;
    this.fadingOut = false;
    this.clock = EMPTY_CLOCK;
    this.emit("clock", this.clock);
  }

  seek(seconds: number) {
    const reverted = this.reclaimDisplay();

    for (const channel of [...this.fading]) {
      this.cancelFade(channel);
      this.destroyChannel(channel);
    }

    const current = this.current;
    if (!current) {
      if (reverted) this.emit("revert");
      return;
    }
    this.cancelFade(current);
    current.gain = 1;
    this.applyGain(current);
    this.triggeredFade = false;
    this.fadingOut = false;
    const duration = this.durationOf(current);
    const next = clamp(seconds, 0, duration > 0 ? duration : seconds);
    current.audio.currentTime = next;
    this.publishClockFrom(current);
    if (reverted) this.emit("revert");
  }

  setVolume(volume: number) {
    this.volume = clamp(volume, 0, 1);
    const channels = new Set<Channel>();
    if (this.current) channels.add(this.current);
    if (this.next) channels.add(this.next);
    if (this.display) channels.add(this.display);
    for (const channel of this.fading) channels.add(channel);
    for (const channel of channels) this.applyGain(channel);
  }

  getClock() {
    return this.clock;
  }

  isPaused() {
    return this.current ? this.current.audio.paused : true;
  }

  destroy() {
    this.destroyAllChannels();
    for (const set of Object.values(this.listeners)) set.clear();
  }
}
