import { defineConfig } from "@playwright/test";

const baseURL = process.env.IPOD_URL ?? "http://127.0.0.1:3000";
const webServerCommand = process.env.IPOD_WEB_SERVER;

const chromeUse = {
  channel: "chrome" as const,
  viewport: { width: 443, height: 720 },
  deviceScaleFactor: 1,
  locale: "en-US",
  timezoneId: "UTC",
  reducedMotion: "reduce" as const,
  launchOptions: {
    args: [
      "--font-render-hinting=none",
      "--disable-font-subpixel-positioning",
      "--disable-lcd-text",
      "--force-color-profile=srgb",
    ],
  },
};

export default defineConfig({
  testDir: "tests/visual",
  snapshotPathTemplate: "tests/visual/__screenshots__/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      maxDiffPixels: 0,
      animations: "disabled",
      caret: "hide",
    },
  },
  use: {
    baseURL,
    ...chromeUse,
  },
  projects: [{ name: "chrome", use: chromeUse }],
  ...(webServerCommand
    ? {
        webServer: {
          command: webServerCommand,
          url: baseURL,
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }
    : {}),
});
