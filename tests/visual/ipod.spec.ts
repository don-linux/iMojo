import { expect, test } from "@playwright/test";
import { captureLibrary } from "./drive.ts";
import { boot, frames, shotDevice, waitForLibrary } from "./seed.ts";

const SCHEMES = ["light", "dark"] as const;

for (const colorScheme of SCHEMES) {
  test.describe(`backlight on ${colorScheme}`, () => {
    test.use({ colorScheme });

    test("loading screen", async ({ page }) => {
      await boot(page, { backlight: "always_on", library: true, pauseClock: true });
      await expect(page.getByTestId("ipod-loading-screen")).toBeVisible();
      await shotDevice(page, `loading-${colorScheme}-backlight-on`, { pumpFrames: false });
    });

    test("main menu without a library", async ({ page }) => {
      await boot(page, { backlight: "always_on", library: false });
      await waitForLibrary(page);
      await expect(page.locator("h1.screen-title")).toHaveText("iPod");
      await shotDevice(page, `main-empty-${colorScheme}-backlight-on`);
    });

    test("offline", async ({ page }) => {
      await boot(page, { backlight: "always_on", library: true, offline: true });
      await expect(page.getByTestId("ipod-error-screen")).toContainText(
        "You are not connected to the internet",
      );
      await frames(page);
      await shotDevice(page, `offline-${colorScheme}-backlight-on`);
    });

    test("library screens", async ({ page }) => {
      test.setTimeout(180_000);
      await boot(page, { backlight: "always_on", library: true });
      await waitForLibrary(page);
      await captureLibrary(page, colorScheme);
    });
  });

  test.describe(`backlight off ${colorScheme}`, () => {
    test.use({ colorScheme });

    test("main menu", async ({ page }) => {
      await boot(page, { backlight: "off", library: true });
      await waitForLibrary(page);
      await expect(page.locator(".screen")).not.toHaveClass(/backlit/);
      await shotDevice(page, `main-library-${colorScheme}-backlight-off`);
    });
  });
}
