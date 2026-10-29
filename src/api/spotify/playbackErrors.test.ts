import assert from "node:assert/strict";
import { test } from "node:test";
import { SpotifyRateLimitError, SpotifyRequestError, SpotifySessionError } from "./api.ts";
import { BROWSER_PLAYER_NOT_READY } from "./devicePlayback.ts";
import { toPlaybackFailure } from "./playbackErrors.ts";

const supported = { ok: true } as const;

test("playback failures classify auth, premium, restriction, device, and rate limits", () => {
  assert.equal(toPlaybackFailure(new SpotifyRequestError(401, "expired"), supported)?.action, "stop");
  assert.equal(toPlaybackFailure(new SpotifySessionError("Spotify session expired"), supported)?.action, "stop");
  const premium = toPlaybackFailure(new SpotifyRequestError(403, "Spotify Premium is required to play"), supported);
  assert.equal(premium?.message, "Spotify Premium is required to play");
  assert.equal(premium?.action, "message");
  assert.equal(toPlaybackFailure(new SpotifyRequestError(403, "Restriction violated"), supported)?.message, "Restriction violated");
  assert.equal(
    toPlaybackFailure(new SpotifyRequestError(404, "Device not found"), { ok: false, reason: "Needs DRM" })?.message,
    "Needs DRM",
  );
  assert.equal(
    toPlaybackFailure(new SpotifyRequestError(404, "Device not found"), supported)?.message,
    BROWSER_PLAYER_NOT_READY,
  );
  assert.match(toPlaybackFailure(new SpotifyRateLimitError(), supported)?.message ?? "", /rate/i);
  const aborted = new Error("aborted");
  aborted.name = "AbortError";
  assert.equal(toPlaybackFailure(aborted, supported), null);
});
