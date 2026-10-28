import { useMemo, useSyncExternalStore } from "react";
import { createProvider, providerLabel } from "./provider.ts";
import { SpotifyRequestError, SpotifySessionError } from "./spotify/api.ts";
import { emptySpotifyLibrary, withDerivedArtists } from "./spotify/library.ts";
import type {
  LoadStatus,
  MusicLibrary,
  PlaybackSource,
  ProviderConnection,
  Track,
} from "./types.ts";
const SETUP_CONNECTION: ProviderConnection = { status: "setup", account: null, error: null };

export type MusicLibraryState = {
  library: MusicLibrary;
  sourceLabel: string;
  status: LoadStatus;
  error: string | null;
  connection: ProviderConnection;
  reload: () => Promise<void>;
  connectProvider: () => Promise<void>;
  disconnectProvider: () => Promise<void>;
  saveClientId: (clientId: string) => void;
  loadPlaylist: (id: string) => Promise<void>;
  resolvePlayback: (track: Track) => Promise<PlaybackSource | null>;
};
type Snapshot = {
  library: MusicLibrary;
  sourceLabel: string;
  status: LoadStatus;
  error: string | null;
  connection: ProviderConnection;
};

const SERVER_SNAPSHOT: Snapshot = {
  library: emptySpotifyLibrary(),
  sourceLabel: "Spotify",
  status: "idle",
  error: null,
  connection: SETUP_CONNECTION,
};

function createMusicLibraryStore() {
  const provider = createProvider();
  const sourceLabel = providerLabel();
  const listeners = new Set<() => void>();
  const playlistLoads = new Map<string, Promise<void>>();
  const dirtyPlaylists = new Set<string>();
  let library = emptySpotifyLibrary();
  let status: LoadStatus = "idle";
  let error: string | null = null;
  let connection = provider.readConnection?.() ?? SETUP_CONNECTION;
  let snapshot: Snapshot = { library, sourceLabel, status, error, connection };
  let reloadGen = 0;
  let started = false;

  function emit() {
    snapshot = { library, sourceLabel, status, error, connection };
    for (const listener of listeners) listener();
  }

  function liveConnection() {
    return provider.readConnection?.() ?? connection;
  }

  function applyDeadSession(reason: SpotifySessionError) {
    const live = liveConnection();
    library = emptySpotifyLibrary();
    status = "ready";
    error = null;
    connection =
      live.status === "setup"
        ? { ...live, error: reason.message }
        : { ...live, status: "error", error: reason.message };
    emit();
  }

  function preserveLoaded(next: MusicLibrary) {
    const tracks = { ...next.tracks };
    const playlists = next.playlists.map((playlist) => {
      if (!dirtyPlaylists.has(playlist.id)) return playlist;
      const current = library.playlists.find((entry) => entry.id === playlist.id);
      if (!current) return playlist;
      for (const trackId of current.trackIds) {
        const track = library.tracks[trackId];
        if (track) tracks[trackId] = track;
      }
      return current;
    });
    dirtyPlaylists.clear();
    return withDerivedArtists({ ...next, tracks, playlists });
  }

  async function reload() {
    const gen = ++reloadGen;
    dirtyPlaylists.clear();
    playlistLoads.clear();
    const reported = provider.readConnection?.();
    if (reported && (reported.status === "setup" || reported.status === "disconnected")) {
      library = emptySpotifyLibrary();
      status = "ready";
      error = null;
      connection = reported;
      emit();
      return;
    }
    const cached = provider.cachedLibrary?.() ?? null;
    if (cached) library = cached;
    status = "loading";
    error = null;
    emit();
    try {
      const next = await provider.loadLibrary();
      if (gen !== reloadGen) return;
      library = preserveLoaded(next);
      status = "ready";
      connection = liveConnection();
      emit();
    } catch (reason) {
      if (gen !== reloadGen) return;
      if (reason instanceof SpotifySessionError) {
        applyDeadSession(reason);
        return;
      }
      const live = provider.readConnection?.();
      if (!cached) library = emptySpotifyLibrary();
      const message = reason instanceof Error ? reason.message : "Unable to load the music library";
      status = cached ? "ready" : "error";
      error = cached ? null : message;
      if (cached && live && live.status !== "setup") connection = { ...live, error: message };
      emit();
    }
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    if (!started) {
      started = true;
      queueMicrotask(() => {
        void reload();
      });
    }
    return () => {
      listeners.delete(listener);
    };
  }

  function failPlaylist(id: string, reason: unknown) {
    if (reason instanceof SpotifySessionError) {
      applyDeadSession(reason);
      return;
    }
    const message = reason instanceof Error ? reason.message : "Unable to load the playlist";
    const statusCode = reason instanceof SpotifyRequestError ? reason.status : 0;
    if (statusCode !== 403 && statusCode !== 404) {
      dirtyPlaylists.add(id);
      library = {
        ...library,
        playlists: library.playlists.map((playlist) =>
          playlist.id === id ? { ...playlist, unavailable: true } : playlist,
        ),
      };
    }
    connection = { ...connection, error: message };
    emit();
  }

  function applyPlaylist(id: string, next: MusicLibrary) {
    const updated = next.playlists.find((playlist) => playlist.id === id);
    if (!updated) return;
    const tracks = { ...library.tracks };
    for (const trackId of updated.trackIds) {
      const track = next.tracks[trackId];
      if (track) tracks[trackId] = track;
    }
    dirtyPlaylists.add(id);
    library = withDerivedArtists({
      ...library,
      tracks,
      playlists: library.playlists.map((playlist) => (playlist.id === id ? updated : playlist)),
    });
    emit();
  }

  function loadPlaylist(id: string) {
    const ensure = provider.ensurePlaylist;
    const current = library.playlists.find((playlist) => playlist.id === id);
    if (!ensure || !current || current.tracksLoaded || current.unavailable) return Promise.resolve();
    const existing = playlistLoads.get(id);
    if (existing) return existing;
    const gen = reloadGen;
    const base = library;
    const promise = ensure(base, id)
      .then((next) => {
        if (gen !== reloadGen) return;
        applyPlaylist(id, next);
      })
      .catch((reason: unknown) => {
        if (gen !== reloadGen) return;
        failPlaylist(id, reason);
      })
      .finally(() => {
        if (playlistLoads.get(id) === promise) playlistLoads.delete(id);
      });
    playlistLoads.set(id, promise);
    return promise;
  }

  async function connect() {
    if (!provider.connect) return;
    const before = liveConnection();
    if (before.status !== "setup") {
      connection = { ...connection, status: "connecting", error: null };
      emit();
    }
    try {
      const next = await provider.connect();
      connection = next;
      error = null;
      emit();
      if (next.status === "connected") await reload();
    } catch (reason) {
      const live = liveConnection();
      const message = reason instanceof Error ? reason.message : "Provider connection failed";
      connection =
        live.status === "setup"
          ? { ...live, error: message }
          : { ...live, status: "error", error: message };
      emit();
    }
  }

  async function disconnect() {
    const gen = ++reloadGen;
    dirtyPlaylists.clear();
    playlistLoads.clear();
    let failed: unknown;
    try {
      await provider.disconnect?.();
    } catch (reason) {
      failed = reason;
    }
    if (gen === reloadGen) {
      connection = liveConnection();
      library = emptySpotifyLibrary();
      status = "ready";
      error = null;
      emit();
    }
    if (failed !== undefined) throw failed;
  }

  function saveClientId(clientId: string) {
    try {
      provider.saveClientId?.(clientId);
      error = null;
      connection = liveConnection();
      emit();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Could not save the Client ID";
      connection = { ...liveConnection(), error: message };
      emit();
    }
  }

  function resolvePlayback(track: Track) {
    return provider.resolvePlayback(track);
  }

  return {
    subscribe,
    getSnapshot: () => snapshot,
    getServerSnapshot: () => SERVER_SNAPSHOT,
    reload,
    connect,
    disconnect,
    saveClientId,
    loadPlaylist,
    resolvePlayback,
  };
}

export function useMusicLibrary(): MusicLibraryState {
  const store = useMemo(() => createMusicLibraryStore(), []);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return {
    library: snapshot.library,
    sourceLabel: snapshot.sourceLabel,
    status: snapshot.status,
    error: snapshot.error,
    connection: snapshot.connection,
    reload: store.reload,
    connectProvider: store.connect,
    disconnectProvider: store.disconnect,
    saveClientId: store.saveClientId,
    loadPlaylist: store.loadPlaylist,
    resolvePlayback: store.resolvePlayback,
  };
}
