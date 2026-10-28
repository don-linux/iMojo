import { SpotifyRequestError, spotifyJson, spotifySend } from "./api.ts";
import { getAccessToken } from "./auth.ts";
import {
  isDeviceNotFound,
  playOnListedDevice,
  type PlaybackDevice,
} from "./devicePlayback.ts";
import { PLAYER_NAME } from "./sdkTypes.ts";

const DEVICES_URL = "https://api.spotify.com/v1/me/player/devices";

export function messageOf(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

export function isAbort(reason: unknown) {
  return reason instanceof Error && (reason.name === "AbortError" || reason.name === "TimeoutError");
}

export function abortError(signal?: AbortSignal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

export function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const timer = setTimeout(done, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    function done() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function playUriOnDevice(input: {
  deviceId: string;
  uri: string;
  signal: AbortSignal;
  stopped: () => boolean;
}) {
  const stop = () => {
    if (input.stopped() || input.signal.aborted) throw abortError(input.signal);
  };
  try {
    await playOnListedDevice({
      deviceId: input.deviceId,
      deviceName: PLAYER_NAME,
      signal: input.signal,
      sleep,
      listDevices: async () => {
        stop();
        const access = await getAccessToken();
        stop();
        const body = await spotifyJson<{ devices?: PlaybackDevice[] }>(
          DEVICES_URL,
          access,
          input.signal,
        );
        return body?.devices ?? [];
      },
      play: async (deviceId) => {
        stop();
        const access = await getAccessToken();
        stop();
        await spotifySend(
          "PUT",
          `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`,
          access,
          { uris: [input.uri] },
          input.signal,
        );
      },
      isMissingDevice: (reason) =>
        reason instanceof SpotifyRequestError && isDeviceNotFound(reason.status, reason.message),
    });
  } catch (reason) {
    if (isAbort(reason) || input.signal.aborted) throw abortError(input.signal);
    if (reason instanceof SpotifyRequestError) throw new Error(reason.message);
    throw reason;
  }
}
