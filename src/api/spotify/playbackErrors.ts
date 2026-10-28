import { SpotifyRateLimitError, SpotifyRequestError, SpotifySessionError } from "./api.ts";
import { BROWSER_PLAYER_NOT_READY } from "./devicePlayback.ts";
import { SESSION_EXPIRED, TRACK_ERROR } from "./sdkTypes.ts";
import { spotifyPlaybackSupport, type SpotifyPlaybackSupport } from "./support.ts";
import { isAbortError, PlaybackFailure } from "../player/types.ts";

export function toPlaybackFailure(reason: unknown, support: SpotifyPlaybackSupport = spotifyPlaybackSupport()) {
  if (isAbortError(reason)) return null;
  if (reason instanceof PlaybackFailure) return reason;
  if (reason instanceof SpotifySessionError) {
    return new PlaybackFailure(reason.message || SESSION_EXPIRED, "stop");
  }
  if (reason instanceof SpotifyRateLimitError) {
    return new PlaybackFailure(reason.message, "message");
  }
  if (reason instanceof SpotifyRequestError) {
    if (reason.status === 401) return new PlaybackFailure(reason.message || SESSION_EXPIRED, "stop");
    if (reason.status === 403) return new PlaybackFailure(reason.message || TRACK_ERROR, "message");
    if (reason.status === 404) {
      const message = support.ok ? BROWSER_PLAYER_NOT_READY : support.reason;
      return new PlaybackFailure(message, "message");
    }
    return new PlaybackFailure(reason.message || TRACK_ERROR, "message");
  }
  if (reason instanceof Error && reason.message) return new PlaybackFailure(reason.message, "message");
  return new PlaybackFailure(TRACK_ERROR, "message");
}
