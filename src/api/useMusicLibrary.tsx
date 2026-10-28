import { useCallback, useEffect, useMemo, useState } from "react";
import { createProvider, providerIdFromEnv, providerLabel } from "./provider.ts";
import { emptyLibrary } from "./providers/none.ts";
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
  resolvePlayback: (track: Track) => Promise<PlaybackSource | null>;
};

function initialConnection(provider: ReturnType<typeof createProvider>): ProviderConnection {
  const status = provider.connectionStatus?.();
  if (status) return { status, account: null, error: null };
  return { status: provider.connect ? "disconnected" : "setup", account: null, error: null };
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

  const reload = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const next = await provider.loadLibrary();
      setLibrary(next);
      setStatus("ready");
      if (provider.connect) {
        setConnection((current) => ({ ...current, status: "connected", error: null }));
      }
    } catch (reason) {
      setLibrary(emptyLibrary);
      setStatus("error");
      setError(reason instanceof Error ? reason.message : "Unable to load the music library");
    }
  }, [provider]);

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
      const status = provider.connectionStatus?.() ?? "setup";
      setConnection({ status, account: null, error: null });
      if (providerId === "spotify") {
        setLibrary(emptyLibrary);
        setStatus("ready");
        setError(null);
      }
    }
  }, [provider, providerId]);

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
    resolvePlayback: provider.resolvePlayback,
  };
}
