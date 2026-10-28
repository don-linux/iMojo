import { expect, type Locator, type Page } from "@playwright/test";
import {
  buildLibrary,
  CLIENT_ID,
  PROFILE,
  settingsSeed,
  TOKENS,
  type BacklightSeed,
} from "./library.ts";

const SPOTIFY = /https?:\/\/([^/?#]+\.)?(spotify\.com|scdn\.co)(?::\d+)?(?:[/?#]|$)/;

const SHOT = {
  maxDiffPixels: 0,
  animations: "disabled" as const,
  caret: "hide" as const,
};

function pngName(name: string) {
  return name.endsWith(".png") ? name : `${name}.png`;
}

export type BootOptions = {
  backlight: BacklightSeed;
  library: boolean;
  offline?: boolean;
  pauseClock?: boolean;
};

// A Web Playback SDK stand-in that connects but never reports a device, so playback stays pending
// (no error copy) for longer than any screenshot takes, in every version of the app.
const SDK_STUB = `
(() => {
  class Player {
    constructor() {}
    addListener() { return true; }
    removeListener() { return true; }
    connect() { return Promise.resolve(true); }
    disconnect() {}
    activateElement() { return Promise.resolve(); }
    getCurrentState() { return Promise.resolve(null); }
    setVolume() { return Promise.resolve(); }
    getVolume() { return Promise.resolve(1); }
    pause() { return Promise.resolve(); }
    resume() { return Promise.resolve(); }
    togglePlay() { return Promise.resolve(); }
    seek() { return Promise.resolve(); }
    previousTrack() { return Promise.resolve(); }
    nextTrack() { return Promise.resolve(); }
  }
  window.Spotify = { Player };
  window.onSpotifyWebPlaybackSDKReady?.();
})();
`;

export async function boot(page: Page, options: BootOptions) {
  await page.route(SPOTIFY, (route) => {
    if (route.request().url().includes("sdk.scdn.co/spotify-player.js")) {
      return route.fulfill({ status: 200, contentType: "text/javascript", body: SDK_STUB });
    }
    return route.abort();
  });
  await page.addInitScript(
    (data) => {
      localStorage.setItem("ipod-settings", JSON.stringify(data.settings));
      if (data.offline) {
        Object.defineProperty(navigator, "onLine", {
          configurable: true,
          get: () => false,
        });
      }
      if (!data.clientId || !data.tokens || !data.profile || !data.library) return;
      localStorage.setItem("ipod.spotify.clientId", data.clientId);
      localStorage.setItem("ipod.spotify.tokens", JSON.stringify(data.tokens));
      localStorage.setItem("ipod.spotify.profile", JSON.stringify(data.profile));
      localStorage.setItem("ipod.spotify.library", JSON.stringify(data.library));
    },
    {
      settings: settingsSeed(options.backlight),
      offline: options.offline === true,
      clientId: options.library ? CLIENT_ID : "",
      tokens: options.library ? TOKENS : null,
      profile: options.library ? PROFILE : null,
      library: options.library ? buildLibrary() : null,
    },
  );

  if (options.pauseClock) {
    const start = new Date("2026-01-15T15:00:00.000Z");
    await page.clock.install({ time: start });
    await page.clock.pauseAt(start);
  }

  await page.goto("/");
}

export async function frames(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

export async function waitForLibrary(page: Page) {
  await expect(page.getByTestId("ipod-loading-screen")).toHaveCount(0, { timeout: 15_000 });
  const error = page.getByTestId("ipod-error-screen");
  if ((await error.count()) > 0) {
    throw new Error(`Library boot showed an error screen: ${await error.innerText()}`);
  }
  await frames(page);
}

export async function shotDevice(
  page: Page,
  name: string,
  options?: { masks?: Locator[]; pumpFrames?: boolean },
) {
  if (options?.pumpFrames === false) await page.evaluate(() => document.fonts.ready);
  else await frames(page);
  await expect(page.locator(".device")).toHaveScreenshot(pngName(name), {
    ...SHOT,
    mask: options?.masks,
  });
}

export async function shotPage(page: Page, name: string) {
  await frames(page);
  await expect(page).toHaveScreenshot(pngName(name), { ...SHOT, fullPage: true });
}
