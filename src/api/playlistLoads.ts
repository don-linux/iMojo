import type { MusicLibrary, Playlist, ProviderConnection } from "./types.ts";
import { SpotifyRequestError, SpotifySessionError } from "./spotify/api.ts";
import { withDerivedArtists } from "./spotify/library.ts";
import { isOwnerDeniedPlaylist } from "./playlistAccess.ts";

export type LoadPlaylistOptions = { retry?: boolean };

export type PlaylistLoadHost = {
  getLibrary: () => MusicLibrary;
  setLibrary: (library: MusicLibrary) => void;
  getConnection: () => ProviderConnection;
  setConnection: (connection: ProviderConnection) => void;
  emit: () => void;
  reloadGeneration: () => number;
  onDeadSession: (reason: SpotifySessionError) => void;
  ensurePlaylist?: (library: MusicLibrary, id: string) => Promise<MusicLibrary>;
};

export function createPlaylistLoads(host: PlaylistLoadHost) {
  const inflight = new Map<string, Promise<void>>();
  const dirty = new Set<string>();

  function reset() {
    dirty.clear();
    inflight.clear();
  }

  function preserveLoaded(next: MusicLibrary) {
    const current = host.getLibrary();
    const tracks = { ...next.tracks };
    const playlists = next.playlists.map((playlist) => {
      if (!dirty.has(playlist.id)) return playlist;
      const kept = current.playlists.find((entry) => entry.id === playlist.id);
      if (!kept) return playlist;
      for (const trackId of kept.trackIds) {
        const track = current.tracks[trackId];
        if (track) tracks[trackId] = track;
      }
      return kept;
    });
    dirty.clear();
    return withDerivedArtists({ ...next, tracks, playlists });
  }

  function replacePlaylist(id: string, patch: (playlist: Playlist) => Playlist) {
    const library = host.getLibrary();
    host.setLibrary({
      ...library,
      playlists: library.playlists.map((playlist) => (playlist.id === id ? patch(playlist) : playlist)),
    });
  }

  function failPlaylist(id: string, reason: unknown) {
    if (reason instanceof SpotifySessionError) {
      host.onDeadSession(reason);
      return;
    }
    const message = reason instanceof Error ? reason.message : "Unable to load the playlist";
    const statusCode = reason instanceof SpotifyRequestError ? reason.status : 0;
    if (statusCode !== 403 && statusCode !== 404) {
      dirty.add(id);
      replacePlaylist(id, (playlist) => ({ ...playlist, unavailable: true }));
    }
    host.setConnection({ ...host.getConnection(), error: message });
    host.emit();
  }

  function applyPlaylist(id: string, next: MusicLibrary) {
    const updated = next.playlists.find((playlist) => playlist.id === id);
    if (!updated) return;
    const library = host.getLibrary();
    const tracks = { ...library.tracks };
    for (const trackId of updated.trackIds) {
      const track = next.tracks[trackId];
      if (track) tracks[trackId] = track;
    }
    dirty.add(id);
    host.setLibrary(
      withDerivedArtists({
        ...library,
        tracks,
        playlists: library.playlists.map((playlist) => (playlist.id === id ? updated : playlist)),
      }),
    );
    host.emit();
  }

  function markLoading(id: string) {
    replacePlaylist(id, (playlist) => ({ ...playlist, unavailable: false }));
    host.emit();
  }

  function loadPlaylist(id: string, options?: LoadPlaylistOptions) {
    const ensure = host.ensurePlaylist;
    const current = host.getLibrary().playlists.find((playlist) => playlist.id === id);
    if (!ensure || !current || isOwnerDeniedPlaylist(current) || current.tracksLoaded) return Promise.resolve();
    if (current.unavailable && !options?.retry) return Promise.resolve();
    const existing = inflight.get(id);
    if (existing) return existing;
    if (current.unavailable) markLoading(id);
    const gen = host.reloadGeneration();
    const base = host.getLibrary();
    const promise = ensure(base, id)
      .then((next) => {
        if (gen !== host.reloadGeneration()) return;
        applyPlaylist(id, next);
      })
      .catch((reason: unknown) => {
        if (gen !== host.reloadGeneration()) return;
        failPlaylist(id, reason);
      })
      .finally(() => {
        if (inflight.get(id) === promise) inflight.delete(id);
      });
    inflight.set(id, promise);
    return promise;
  }

  return { reset, preserveLoaded, loadPlaylist };
}
