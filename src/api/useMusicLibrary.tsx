import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createProvider, providerIdFromEnv, providerLabel } from "./provider.ts";
import { emptyLibrary } from "./providers/none.ts";
import { emptySpotifyLibrary } from "./spotify/library.ts";
import { SpotifySessionError } from "./spotify/api.ts";
import type {
  LoadStatus,
  MusicLibrary,
  PlaybackSource,
  ProviderConnection,
  Track,
} from "./types.ts";

export type MusicLibraryState = {
  library: MusicLibrary;
  providerId: ReturnType<typeof providerIdFromEnv>;
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

function initialConnection(provider: ReturnType<typeof createProvider>): ProviderConnection {
  return (
    provider.readConnection?.() ?? {
      status: provider.connectionStatus?.() ?? (provider.connect ? "disconnected" : "setup"),
      account: null,
      error: null,
    }
  );
}

export function useMusicLibrary(): MusicLibraryState {
  const providerId = useMemo(() => providerIdFromEnv(), []);
  const provider = useMemo(() => createProvider(providerId), [providerId]);
  const [library, setLibrary] = useState<MusicLibrary>(emptyLibrary);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ProviderConnection>(() =>
    initialConnection(provider),
  );
  const libraryRef = useRef(library);
  libraryRef.current = library;

  const reload = useCallback(async () => {
    const snapshot = provider.readConnection?.();
    if (snapshot && (snapshot.status === "setup" || snapshot.status === "disconnected")) {
      setLibrary(providerId === "spotify" ? emptySpotifyLibrary() : emptyLibrary);
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
      setConnection(
        provider.readConnection?.() ?? { status: "connected", account: null, error: null },
      );
    } catch (reason) {
      const nextConnection = provider.readConnection?.();
      if (reason instanceof SpotifySessionError && nextConnection) {
        setLibrary(providerId === "spotify" ? emptySpotifyLibrary() : emptyLibrary);
        setStatus("ready");
        setError(null);
        setConnection({ ...nextConnection, status: "error", error: reason.message });
        return;
      }
      if (!cached) setLibrary(providerId === "spotify" ? emptySpotifyLibrary() : emptyLibrary);
      setStatus(cached ? "ready" : "error");
      const message = reason instanceof Error ? reason.message : "Unable to load the music library";
      setError(cached ? null : message);
      if (cached && nextConnection) setConnection({ ...nextConnection, error: message });
    }
  }, [provider, providerId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const connectProvider = useCallback(async () => {
    if (!provider.connect) {
      setConnection({
        status: "error",
        account: null,
        error: `${providerLabel(providerId)} does not require a connection`,
      });
      return;
    }
    setConnection((current) => ({ ...current, status: "connecting", error: null }));
    try {
      const next = await provider.connect();
      setConnection(next);
      if (next.status === "connected") await reload();
    } catch (reason) {
      setConnection({
        status: "error",
        account: null,
        error: reason instanceof Error ? reason.message : "Provider connection failed",
      });
    }
  }, [provider, providerId, reload]);

  const disconnectProvider = useCallback(async () => {
    try {
      await provider.disconnect?.();
    } finally {
      setConnection(provider.readConnection?.() ?? { status: "setup", account: null, error: null });
      setLibrary(providerId === "spotify" ? emptySpotifyLibrary() : emptyLibrary);
      setStatus("ready");
      setError(null);
    }
  }, [provider, providerId]);

  const saveClientId = useCallback(
    (clientId: string) => {
      provider.saveClientId?.(clientId);
      setConnection(
        provider.readConnection?.() ?? { status: "disconnected", account: null, error: null },
      );
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
    providerId,
    sourceLabel: providerLabel(providerId),
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
