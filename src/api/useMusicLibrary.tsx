import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createProvider, providerLabel } from "./provider.ts";
import { emptySpotifyLibrary } from "./spotify/library.ts";
import { SpotifySessionError } from "./spotify/api.ts";
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

function reportedConnection(provider: ReturnType<typeof createProvider>): ProviderConnection {
  return provider.readConnection?.() ?? SETUP_CONNECTION;
}

export function useMusicLibrary(): MusicLibraryState {
  const provider = useMemo(() => createProvider(), []);
  const [library, setLibrary] = useState<MusicLibrary>(emptySpotifyLibrary);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ProviderConnection>(() =>
    reportedConnection(provider),
  );
  const libraryRef = useRef(library);
  libraryRef.current = library;

  const reload = useCallback(async () => {
    const snapshot = provider.readConnection?.();
    if (snapshot && (snapshot.status === "setup" || snapshot.status === "disconnected")) {
      setLibrary(emptySpotifyLibrary());
      setStatus("ready");
      setError(null);
      setConnection(snapshot);
      return;
    }
    const cached = provider.cachedLibrary?.() ?? null;
    if (cached) setLibrary(cached);
    setStatus("loading");
    setError(null);
    try {
      const next = await provider.loadLibrary();
      setLibrary(next);
      setStatus("ready");
      setConnection(reportedConnection(provider));
    } catch (reason) {
      const nextConnection = provider.readConnection?.();
      if (reason instanceof SpotifySessionError && nextConnection) {
        setLibrary(emptySpotifyLibrary());
        setStatus("ready");
        setError(null);
        setConnection(
          nextConnection.status === "setup"
            ? { ...nextConnection, error: reason.message }
            : { ...nextConnection, status: "error", error: reason.message },
        );
        return;
      }
      if (!cached) setLibrary(emptySpotifyLibrary());
      setStatus(cached ? "ready" : "error");
      const message = reason instanceof Error ? reason.message : "Unable to load the music library";
      setError(cached ? null : message);
      if (cached && nextConnection && nextConnection.status !== "setup") {
        setConnection({ ...nextConnection, error: message });
      }
    }
  }, [provider]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const connectProvider = useCallback(async () => {
    if (!provider.connect) return;
    const before = reportedConnection(provider);
    if (before.status !== "setup") {
      setConnection((current) => ({ ...current, status: "connecting", error: null }));
    }
    try {
      const next = await provider.connect();
      setConnection(next);
      if (next.status === "connected") await reload();
    } catch (reason) {
      const snapshot = reportedConnection(provider);
      const message = reason instanceof Error ? reason.message : "Provider connection failed";
      setConnection(
        snapshot.status === "setup"
          ? { ...snapshot, error: message }
          : { ...snapshot, status: "error", error: message },
      );
    }
  }, [provider, reload]);

  const disconnectProvider = useCallback(async () => {
    try {
      await provider.disconnect?.();
    } finally {
      setConnection(reportedConnection(provider));
      setLibrary(emptySpotifyLibrary());
      setStatus("ready");
      setError(null);
    }
  }, [provider]);

  const saveClientId = useCallback(
    (clientId: string) => {
      provider.saveClientId?.(clientId);
      setConnection(reportedConnection(provider));
      setError(null);
    },
    [provider],
  );

  const loadPlaylist = useCallback(
    async (id: string) => {
      if (!provider.ensurePlaylist) return;
      const current = libraryRef.current.playlists.find((playlist) => playlist.id === id);
      if (!current || current.tracksLoaded || current.unavailable) return;
      try {
        const next = await provider.ensurePlaylist(libraryRef.current, id);
        setLibrary(next);
      } catch (reason) {
        setConnection((existing) => ({
          ...existing,
          error: reason instanceof Error ? reason.message : "Unable to load the playlist",
        }));
      }
    },
    [provider],
  );

  return {
    library,
    sourceLabel: providerLabel(),
    status,
    error,
    connection,
    reload,
    connectProvider,
    disconnectProvider,
    saveClientId,
    loadPlaylist,
    resolvePlayback: provider.resolvePlayback,
  };
}
