import assert from "node:assert/strict";
import test from "node:test";
import { isOwnerDeniedPlaylist } from "./playlistAccess.ts";
import type { Playlist } from "./types.ts";

function playlist(patch: Partial<Playlist>): Playlist {
  return { id: "p", name: "Mix", sourceId: "p", trackIds: [], ...patch };
}

test("owner denials are closed to retry", () => {
  assert.equal(isOwnerDeniedPlaylist(playlist({ ownerDenied: true })), true);
  assert.equal(
    isOwnerDeniedPlaylist(
      playlist({
        unavailable: true,
        tracksLoaded: true,
        ownerId: "other",
        collaborative: false,
      }),
    ),
    true,
  );
});

test("other unavailable playlists can retry", () => {
  assert.equal(isOwnerDeniedPlaylist(playlist({ unavailable: true })), false);
  assert.equal(
    isOwnerDeniedPlaylist(playlist({ unavailable: true, tracksLoaded: true, collaborative: true, ownerId: "other" })),
    false,
  );
  assert.equal(isOwnerDeniedPlaylist(playlist({ tracksLoaded: true, ownerId: "other" })), false);
});
