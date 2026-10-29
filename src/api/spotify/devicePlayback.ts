export const BROWSER_PLAYER_NOT_READY = "The browser player is not ready";

const DEVICE_WAIT_MS = 8_000;

export type PlaybackDevice = {
  id: string | null;
  name?: string;
  is_restricted?: boolean;
};

export function isDeviceNotFound(status: number, message: string) {
  return status === 404 && /device not found/i.test(message);
}

export function playbackDeviceId(devices: PlaybackDevice[], deviceId: string, deviceName: string) {
  if (devices.some((device) => device.id === deviceId)) return deviceId;
  const named = devices.filter(
    (device) => device.name === deviceName && Boolean(device.id) && device.is_restricted !== true,
  );
  if (named.length !== 1) return null;
  return named[0]?.id ?? null;
}

function abortError(signal: AbortSignal) {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError(signal);
}

function isAbort(reason: unknown): reason is Error {
  return reason instanceof Error && (reason.name === "AbortError" || reason.name === "TimeoutError");
}

async function wait(
  ms: number,
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  if (!signal) {
    await sleep(ms, signal);
    return;
  }
  let onAbort: (() => void) | undefined;
  try {
    await Promise.race([
      sleep(ms, signal),
      new Promise<void>((_resolve, reject) => {
        onAbort = () => reject(abortError(signal));
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
  throwIfAborted(signal);
}

export async function playOnListedDevice(input: {
  deviceId: string;
  deviceName: string;
  listDevices: () => Promise<PlaybackDevice[]>;
  play: (deviceId: string) => Promise<void>;
  isMissingDevice: (reason: unknown) => boolean;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
}) {
  throwIfAborted(input.signal);
  const now = input.now ?? Date.now;
  const deadline = now() + DEVICE_WAIT_MS;
  let delay = 250;
  let resolved: string | null = null;

  for (;;) {
    throwIfAborted(input.signal);
    resolved = playbackDeviceId(await input.listDevices(), input.deviceId, input.deviceName);
    throwIfAborted(input.signal);
    if (resolved) break;
    if (now() >= deadline) throw new Error(BROWSER_PLAYER_NOT_READY);
    await wait(delay, input.sleep, input.signal);
    delay = Math.min(delay * 2, 1000);
  }
  if (!resolved) throw new Error(BROWSER_PLAYER_NOT_READY);

  let deviceId = resolved;
  delay = 300;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      throwIfAborted(input.signal);
      await input.play(deviceId);
      return deviceId;
    } catch (reason) {
      if (isAbort(reason) || input.signal?.aborted) {
        throw input.signal?.aborted ? abortError(input.signal) : reason;
      }
      const missing = input.isMissingDevice(reason);
      if (!missing || attempt === 4) {
        if (missing) throw new Error(BROWSER_PLAYER_NOT_READY);
        throw reason;
      }
      await wait(delay, input.sleep, input.signal);
      deviceId =
        playbackDeviceId(await input.listDevices(), input.deviceId, input.deviceName) ?? deviceId;
      delay = Math.min(delay * 2, 1000);
    }
  }
  return deviceId;
}
