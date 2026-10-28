import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_PLAYER_NOT_READY,
  playOnListedDevice,
  playbackDeviceId,
} from "./devicePlayback.ts";

function clock() {
  let time = 0;
  return {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
  };
}

test("plays only after the browser device is listed", async () => {
  const { now, sleep } = clock();
  const seen: string[] = [];
  let polls = 0;
  const played = await playOnListedDevice({
    deviceId: "ipod-device",
    deviceName: "iPod",
    now,
    sleep,
    listDevices: async () => {
      polls += 1;
      seen.push("list");
      return polls < 2 ? [] : [{ id: "ipod-device", name: "iPod" }];
    },
    play: async (deviceId) => {
      seen.push(deviceId);
    },
    isMissingDevice: () => false,
  });
  assert.equal(played, "ipod-device");
  assert.deepEqual(seen, ["list", "list", "ipod-device"]);
});

test("uses the player name when the ready id is not the listed id", () => {
  const id = playbackDeviceId(
    [
      { id: "chrome-web", name: "Web Player (Chrome)" },
      { id: "listed-ipod", name: "iPod", is_restricted: false },
    ],
    "ready-id-that-spotify-does-not-list",
    "iPod",
  );
  assert.equal(id, "listed-ipod");
});

test("does not call play when the browser device never appears", async () => {
  const { now, sleep } = clock();
  let played = false;
  await assert.rejects(
    playOnListedDevice({
      deviceId: "ipod-device",
      deviceName: "iPod",
      now,
      sleep,
      listDevices: async () => [{ id: "other", name: "Phone" }],
      play: async () => {
        played = true;
      },
      isMissingDevice: () => false,
    }),
    (reason: unknown) => {
      assert.equal(reason instanceof Error && reason.message, BROWSER_PLAYER_NOT_READY);
      return true;
    },
  );
  assert.equal(played, false);
});

test("retries play when Spotify says the device is missing", async () => {
  const { now, sleep } = clock();
  let attempts = 0;
  await playOnListedDevice({
    deviceId: "ipod-device",
    deviceName: "iPod",
    now,
    sleep,
    listDevices: async () => [{ id: "ipod-device", name: "iPod" }],
    play: async () => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error("Device not found"), { missing: true });
    },
    isMissingDevice: (reason) => reason instanceof Error && "missing" in reason,
  });
  assert.equal(attempts, 3);
});

test("stops retrying a missing device and explains the browser player", async () => {
  const { now, sleep } = clock();
  let attempts = 0;
  await assert.rejects(
    playOnListedDevice({
      deviceId: "ipod-device",
      deviceName: "iPod",
      now,
      sleep,
      listDevices: async () => [{ id: "ipod-device", name: "iPod" }],
      play: async () => {
        attempts += 1;
        throw Object.assign(new Error("Device not found"), { missing: true });
      },
      isMissingDevice: (reason) => reason instanceof Error && "missing" in reason,
    }),
    (reason: unknown) => {
      assert.equal(reason instanceof Error && reason.message, BROWSER_PLAYER_NOT_READY);
      return true;
    },
  );
  assert.equal(attempts, 5);
});

test("leaves other playback errors unchanged", async () => {
  const { now, sleep } = clock();
  await assert.rejects(
    playOnListedDevice({
      deviceId: "ipod-device",
      deviceName: "iPod",
      now,
      sleep,
      listDevices: async () => [{ id: "ipod-device", name: "iPod" }],
      play: async () => {
        throw new Error("Spotify Premium is required to play");
      },
      isMissingDevice: () => false,
    }),
    /Spotify Premium is required to play/,
  );
});
