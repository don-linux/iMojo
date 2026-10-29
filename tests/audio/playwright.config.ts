import { defineConfig } from "@playwright/test";

const baseURL = process.env.IPOD_URL ?? "http://127.0.0.1:3700";

// Separate from the root visual project so screenshot snapshots stay untouched.
// Default Chrome autoplay policy: do not pass --autoplay-policy.
export default defineConfig({
  testDir: ".",
  testMatch: "clickUnlock.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    channel: "chrome",
    locale: "en-US",
    timezoneId: "UTC",
  },
  projects: [{ name: "audio" }],
});
