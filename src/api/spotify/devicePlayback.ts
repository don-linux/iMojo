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
  const named = devices.find(
    (device) => device.name === deviceName && device.id && device.is_restricted !== true,
  );
  return named?.id ?? null;
}

export async function playOnListedDevice(input: {
  deviceId: string;
  deviceName: string;
  listDevices: () => Promise<PlaybackDevice[]>;
  play: (deviceId: string) => Promise<void>;
  isMissingDevice: (reason: unknown) => boolean;
  sleep: (ms: number) => Promise<void>;
  now?: () => number;
}) {
  const now = input.now ?? Date.now;
  const deadline = now() + DEVICE_WAIT_MS;
  let delay = 250;
  let resolved: string | null = null;

  for (;;) {
    resolved = playbackDeviceId(await input.listDevices(), input.deviceId, input.deviceName);
    if (resolved) break;
    if (now() >= deadline) throw new Error(BROWSER_PLAYER_NOT_READY);
    await input.sleep(delay);
    delay = Math.min(delay * 2, 1000);
  }

  delay = 300;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await input.play(resolved);
      return resolved;
    } catch (reason) {
      const missing = input.isMissingDevice(reason);
      if (!missing || attempt === 4) {
        if (missing) throw new Error(BROWSER_PLAYER_NOT_READY);
        throw reason;
      }
      await input.sleep(delay);
      resolved =
        playbackDeviceId(await input.listDevices(), input.deviceId, input.deviceName) ?? resolved;
      delay = Math.min(delay * 2, 1000);
    }
  }
  return resolved;
}
