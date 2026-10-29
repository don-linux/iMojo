import type { Playlist } from "./types.ts";

/** Feb 2026 owner rule: someone else's non-collaborative playlist is not retried. */
export function isOwnerDeniedPlaylist(playlist: Playlist) {
  if (playlist.ownerDenied) return true;
  // denyPlaylist used to persist only this shape, before ownerDenied existed.
  return Boolean(
    playlist.unavailable && playlist.tracksLoaded && playlist.ownerId && !playlist.collaborative,
  );
}
