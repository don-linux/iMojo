import assert from "node:assert/strict";
import test from "node:test";
import { createPlaylistLoads, type PlaylistLoadHost } from "./playlistLoads.ts";
import { SpotifyRequestError, SpotifySessionError } from "./spotify/api.ts";
import type { MusicLibrary, Playlist, ProviderConnection } from "./types.ts";

function playlist(patch: Partial<Playlist> = {}): Playlist {
  return { id: "p", name: "Mix", sourceId: "p", trackIds: [], ...patch };
}

function library(entry: Playlist = playlist()): MusicLibrary {
  return { provider: "spotify", savedTrackIds: [], tracks: {}, artists: [], playlists: [entry] };
}

function hostFor(initial: MusicLibrary, ensure?: PlaylistLoadHost["ensurePlaylist"]) {
  let libraryState = initial;
  let connection: ProviderConnection = { status: "connected", account: "ada", error: null };
  let generation = 1;
  const emits: number[] = [];
  const dead: string[] = [];
  const host: PlaylistLoadHost = {
    getLibrary: () => libraryState,
    setLibrary: (next) => {
      libraryState = next;
    },
    getConnection: () => connection,
    setConnection: (next) => {
      connection = next;
    },
    emit: () => {
      emits.push(emits.length + 1);
    },
    reloadGeneration: () => generation,
    onDeadSession: (reason) => {
      dead.push(reason.message);
    },
    ensurePlaylist: ensure,
  };
  return {
    loads: createPlaylistLoads(host),
    emits,
    dead,
    bump() {
      generation += 1;
    },
    library: () => libraryState,
    connection: () => connection,
  };
}

test("unavailable playlists stay put until an explicit retry", async () => {
  let calls = 0;
  const harness = hostFor(library(playlist({ unavailable: true })), async (next) => {
    calls += 1;
    return next;
  });
  await harness.loads.loadPlaylist("p");
  assert.equal(calls, 0);
  assert.equal(harness.library().playlists[0]?.unavailable, true);
});

test("retry clears a failed playlist back to loading and refetches once", async () => {
  const seen: boolean[] = [];
  const harness = hostFor(library(playlist({ unavailable: true })), async (next) => {
    seen.push(Boolean(next.playlists[0]?.unavailable));
    return {
      ...next,
      playlists: next.playlists.map((entry) => ({
        ...entry,
        trackIds: ["t"],
        tracksLoaded: true,
        unavailable: false,
        ownerDenied: false,
      })),
      tracks: {
        t: {
          id: "t",
          title: "Song",
          artistId: "a",
          artistName: "Ada",
          sourceId: "t",
          source: "spotify",
          durationMs: 1000,
        },
      },
    };
  });
  const first = harness.loads.loadPlaylist("p", { retry: true });
  const second = harness.loads.loadPlaylist("p", { retry: true });
  assert.equal(first, second);
  assert.equal(harness.library().playlists[0]?.unavailable, false);
  await first;
  assert.deepEqual(seen, [false]);
  assert.equal(harness.library().playlists[0]?.tracksLoaded, true);
  assert.deepEqual(harness.library().playlists[0]?.trackIds, ["t"]);
});

test("owner denials are not retried", async () => {
  let calls = 0;
  const denied = playlist({
    unavailable: true,
    tracksLoaded: true,
    ownerId: "other",
    collaborative: false,
  });
  const harness = hostFor(library(denied), async (next) => {
    calls += 1;
    return next;
  });
  await harness.loads.loadPlaylist("p", { retry: true });
  assert.equal(calls, 0);
  assert.equal(harness.library().playlists[0]?.unavailable, true);

  const flagged = hostFor(library(playlist({ ownerDenied: true, unavailable: true })), async (next) => {
    calls += 1;
    return next;
  });
  await flagged.loads.loadPlaylist("p", { retry: true });
  assert.equal(calls, 0);
  assert.equal(flagged.library().playlists[0]?.unavailable, true);
});

test("a non-owner failure can be retried after it is marked unavailable", async () => {
  let attempt = 0;
  const harness = hostFor(library(), async (next) => {
    attempt += 1;
    if (attempt === 1) throw new SpotifyRequestError(500, "Playlist failed");
    return {
      ...next,
      playlists: next.playlists.map((entry) => ({ ...entry, tracksLoaded: true, unavailable: false })),
    };
  });
  await harness.loads.loadPlaylist("p");
  assert.equal(harness.library().playlists[0]?.unavailable, true);
  assert.equal(harness.connection().error, "Playlist failed");
  await harness.loads.loadPlaylist("p", { retry: true });
  assert.equal(attempt, 2);
  assert.equal(harness.library().playlists[0]?.unavailable, false);
  assert.equal(harness.library().playlists[0]?.tracksLoaded, true);
});

test("403 and 404 do not mark the playlist unavailable", async () => {
  const harness = hostFor(library(), async () => {
    throw new SpotifyRequestError(403, "Nope");
  });
  await harness.loads.loadPlaylist("p");
  assert.equal(harness.library().playlists[0]?.unavailable, undefined);
  assert.equal(harness.connection().error, "Nope");
});

test("a dead session is reported instead of marking the playlist", async () => {
  const harness = hostFor(library(), async () => {
    throw new SpotifySessionError("Spotify session expired. Connect again.");
  });
  await harness.loads.loadPlaylist("p");
  assert.deepEqual(harness.dead, ["Spotify session expired. Connect again."]);
  assert.equal(harness.library().playlists[0]?.unavailable, undefined);
});
