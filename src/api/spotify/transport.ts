import { SpotifyRequestError, spotifyJson, spotifySend } from "./api.ts";
import { getAccessToken } from "./auth.ts";
import {
  BROWSER_PLAYER_NOT_READY,
  isDeviceNotFound,
  playOnListedDevice,
  type PlaybackDevice,
} from "./devicePlayback.ts";
import { ensurePremium } from "./library.ts";
import { toPlaybackFailure } from "./playbackErrors.ts";
import { bindSignal } from "./sdkPlayerEvents.ts";
import type { SpotifySdkPlayer } from "./sdkPlayer.ts";
import { PLAYER_NAME } from "./sdkTypes.ts";
import { asDeviceState } from "./stateFollow.ts";
import { spotifyPlaybackSupport } from "./support.ts";
import { isAbortError, PlaybackFailure, type DevicePlaybackState, type PlayWindow } from "../player/types.ts";

const DEVICES_URL = "https://api.spotify.com/v1/me/player/devices";

export function playRequestBody(window: PlayWindow) {
  const body: { uris: string[]; offset: { position: number }; position_ms?: number } = {
    uris: [...window.uris],
    offset: { position: Math.max(0, window.offset) },
  };
  if (window.positionMs !== undefined && Number.isFinite(window.positionMs) && window.positionMs > 0) {
    body.position_ms = Math.round(window.positionMs);
  }
  return body;
}

function shuffleOffUrl(deviceId: string) {
  return `https://api.spotify.com/v1/me/player/shuffle?state=false&device_id=${encodeURIComponent(deviceId)}`;
}

function repeatOffUrl(deviceId: string) {
  return `https://api.spotify.com/v1/me/player/repeat?state=off&device_id=${encodeURIComponent(deviceId)}`;
}

function abortFrom(signal?: AbortSignal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortFrom(signal));
      return;
    }
    const timer = setTimeout(done, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortFrom(signal));
    };
    function done() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class SpotifyTransport {
  private modesAligned = false;
  private shuffleForced = false;
  private readonly player: () => SpotifySdkPlayer;

  constructor(player: () => SpotifySdkPlayer) {
    this.player = player;
  }

  supportReason() {
    const support = spotifyPlaybackSupport();
    return support.ok ? null : support.reason;
  }

  async playWindow(window: PlayWindow, signal: AbortSignal) {
    try {
      const deviceId = await this.prepare(signal);
      await playOnListedDevice({
        deviceId,
        deviceName: PLAYER_NAME,
        signal,
        sleep,
        listDevices: () => this.listDevices(signal),
        play: (id) => this.start(id, window, signal),
        isMissingDevice: (reason) =>
          reason instanceof SpotifyRequestError && isDeviceNotFound(reason.status, reason.message),
      });
    } catch (reason) {
      throw this.wrap(reason, signal);
    }
  }

  pause(signal: AbortSignal) {
    return this.command(signal, this.player().pause());
  }

  resume(signal: AbortSignal) {
    return this.command(signal, this.player().resume());
  }

  seek(positionMs: number, signal: AbortSignal) {
    return this.command(signal, this.player().seek(positionMs));
  }

  setVolume(volume: number) {
    this.player().setVolume(volume);
  }

  async getState(): Promise<DevicePlaybackState | null> {
    return asDeviceState(await this.player().getCurrentState());
  }

  disableDeviceShuffle() {
    if (this.shuffleForced) return;
    const deviceId = this.player().deviceId;
    if (!deviceId) return;
    this.shuffleForced = true;
    void this.putShuffleOff(deviceId).catch(() => {
      this.shuffleForced = false;
    });
  }

  private async command(signal: AbortSignal, task: Promise<void>) {
    try {
      await bindSignal(task, signal);
    } catch (reason) {
      throw this.wrap(reason, signal);
    }
  }

  private async prepare(signal: AbortSignal) {
    if (signal.aborted) throw abortFrom(signal);
    const blocked = this.supportReason();
    if (blocked) throw new PlaybackFailure(blocked, "message");
    await ensurePremium(signal);
    if (signal.aborted) throw abortFrom(signal);
    const deviceId = await this.player().whenReady(signal);
    if (signal.aborted) throw abortFrom(signal);
    if (!deviceId) throw new PlaybackFailure(BROWSER_PLAYER_NOT_READY, "message");
    return deviceId;
  }

  private async listDevices(signal: AbortSignal) {
    if (signal.aborted) throw abortFrom(signal);
    const access = await getAccessToken();
    if (signal.aborted) throw abortFrom(signal);
    const body = await spotifyJson<{ devices?: PlaybackDevice[] }>(DEVICES_URL, access, signal);
    return body?.devices ?? [];
  }

  private async start(deviceId: string, window: PlayWindow, signal: AbortSignal) {
    await this.align(deviceId, signal);
    if (signal.aborted) throw abortFrom(signal);
    const access = await getAccessToken();
    if (signal.aborted) throw abortFrom(signal);
    await spotifySend(
      "PUT",
      `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`,
      access,
      playRequestBody(window),
      signal,
    );
  }

  /**
   * Device shuffle reorders the URI context and would desync the local play
   * order, so it is forced off once per device. Device repeat is forced off
   * in the same step; only the session repeats or wraps.
   */
  private async align(deviceId: string, signal: AbortSignal) {
    if (this.modesAligned) return;
    if (signal.aborted) throw abortFrom(signal);
    const access = await getAccessToken();
    if (signal.aborted) throw abortFrom(signal);
    await spotifySend("PUT", shuffleOffUrl(deviceId), access, undefined, signal);
    if (signal.aborted) throw abortFrom(signal);
    await spotifySend("PUT", repeatOffUrl(deviceId), access, undefined, signal);
    this.modesAligned = true;
    this.shuffleForced = true;
  }

  private async putShuffleOff(deviceId: string) {
    const access = await getAccessToken();
    await spotifySend("PUT", shuffleOffUrl(deviceId), access, undefined);
  }

  private wrap(reason: unknown, signal: AbortSignal) {
    if (signal.aborted || isAbortError(reason)) return abortFrom(signal);
    return toPlaybackFailure(reason) ?? abortFrom(signal);
  }
}
