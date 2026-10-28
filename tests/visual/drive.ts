import { expect, type Locator, type Page } from "@playwright/test";
import { playlistName, PLAYLIST_COUNT, SCROLLED_SONG_INDEX, songTitle } from "./library.ts";
import { frames, shotDevice, shotPage } from "./seed.ts";

const rowTitle = (page: Page) =>
  page.locator('.sheet.live [aria-selected="true"] [data-testid="item-title"]');

const screenTitle = (page: Page) => page.locator("h1.screen-title");

async function expectSelected(page: Page, title: string) {
  await expect(rowTitle(page)).toHaveText(title);
}

async function move(page: Page, key: "ArrowDown" | "ArrowUp", times: number, title: string) {
  const ipod = page.locator(".ipod");
  await ipod.focus();
  for (let step = 0; step < times; step += 1) await ipod.press(key);
  await expectSelected(page, title);
  await frames(page);
}

async function choose(page: Page, title: string) {
  await page.getByTestId("wheel-select-button").click();
  await expect(screenTitle(page)).toHaveText(title);
  await frames(page);
}

async function back(page: Page, title: string) {
  const menu = page.getByTestId("wheel-menu-button");
  const size = await menu.evaluate((node) => ({
    width: node.clientWidth,
    height: node.clientHeight,
  }));
  // The control fills the disc and is clipped to the top wedge. Its box center is the select button.
  await menu.click({ position: { x: size.width / 2, y: size.height * 0.08 } });
  await expect(screenTitle(page)).toHaveText(title);
  await frames(page);
}

function nowPlayingMasks(page: Page): Locator[] {
  return [
    "now-playing-error",
    "now-playing-elapsed",
    "now-playing-remaining",
    "now-playing-scrub-elapsed",
    "now-playing-scrub-remaining",
    "now-playing-progress-fill",
    "now-playing-scrub-marker",
  ].map((id) => page.getByTestId(id));
}

async function openBrick(page: Page) {
  await page.clock.install({ time: new Date("2026-06-01T12:00:00.000Z") });
  await page.getByTestId("wheel-ring").focus();
  await page.keyboard.down("Enter");
  await page.clock.runFor(5_200);
  await page.keyboard.up("Enter");
  await expect(page.locator(".brick-screen canvas")).toHaveCount(1);
  await expect(page.getByTestId("brick-score")).toHaveText("0");
  await page.evaluate(() => document.fonts.ready);
  await page.clock.runFor(80);
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 2_000);
}

export async function captureLibrary(page: Page, colorScheme: string) {
  const name = (screen: string) => `${screen}-${colorScheme}-backlight-on`;

  await expect(screenTitle(page)).toHaveText("iPod");
  await expectSelected(page, "Playlists");
  await shotDevice(page, name("main-library"));

  await choose(page, "Playlists");
  await expectSelected(page, playlistName(0));
  await shotDevice(page, name("playlists-top"));

  await choose(page, playlistName(0));
  await expect(page.locator('.sheet.live [data-testid="item-title"]').first()).toHaveText(songTitle(0));
  await expect(page.locator(".sheet.live")).not.toContainText("Loading");
  await expect(page.locator(".sheet.live")).not.toContainText("Unavailable");
  await shotDevice(page, name("playlist-tracks"));

  await back(page, "Playlists");
  await move(page, "ArrowDown", PLAYLIST_COUNT - 1, playlistName(PLAYLIST_COUNT - 1));
  await shotDevice(page, name("playlists-end"));

  await back(page, "iPod");
  await move(page, "ArrowDown", 1, "Artists");
  await choose(page, "Artists");
  await expectSelected(page, "All");
  await shotDevice(page, name("artists"));

  await back(page, "iPod");
  await move(page, "ArrowDown", 1, "Songs");
  await choose(page, "Songs");
  await move(page, "ArrowDown", SCROLLED_SONG_INDEX, songTitle(SCROLLED_SONG_INDEX));
  await shotDevice(page, name("songs-scrolled"));

  await page.getByTestId("wheel-select-button").click();
  await expect(page.getByTestId("now-playing")).toBeVisible();
  await expect(page.getByTestId("now-playing-song-title")).toContainText(songTitle(SCROLLED_SONG_INDEX));
  await expect(page.getByTestId("now-playing-indicator")).toHaveClass(/pause/);
  await expect(page.getByTestId("now-playing-error")).toHaveCount(0);
  await shotDevice(page, name("now-playing"), { masks: nowPlayingMasks(page) });

  await back(page, "Songs");
  await back(page, "iPod");
  await move(page, "ArrowDown", 1, "Settings");
  await choose(page, "Settings");
  await expectSelected(page, "About");
  await shotDevice(page, name("settings-top"));

  await move(page, "ArrowDown", 6, "Spotify");
  await shotDevice(page, name("settings-row7"));

  await choose(page, "Spotify");
  await expectSelected(page, "Refresh Library");
  await expect(
    page.locator('.sheet.live [data-testid="menu-item"]').filter({ hasText: "Error" }).locator('[data-testid="item-value"]'),
  ).toHaveText("Failed to fetch");
  await shotDevice(page, name("spotify"));

  await move(page, "ArrowUp", 1, "Client ID");
  await page.getByTestId("wheel-select-button").click();
  await expect(page.locator(".client-id-dialog")).toBeVisible();
  await shotPage(page, name("client-id"));
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".client-id-dialog")).toHaveCount(0);
  await frames(page);

  await back(page, "Settings");
  await move(page, "ArrowUp", 3, "Backlight Timer");
  await choose(page, "Backlight Timer");
  await expectSelected(page, "Always On");
  await shotDevice(page, name("backlight"));

  await back(page, "Settings");
  await move(page, "ArrowUp", 3, "About");
  await choose(page, "About");
  await expect(page.locator('.sheet.live [data-testid="item-value"]').first()).toHaveText("120");
  await shotDevice(page, name("about"));

  await openBrick(page);
  await shotDevice(page, name("brick"), { pumpFrames: false });
}
