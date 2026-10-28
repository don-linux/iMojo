export type ProviderId = "spotify";

export type LoadStatus = "idle" | "loading" | "ready" | "error";

export type Track = {
  id: string;
  title: string;
  artistId: string;
  artistName: string;
  albumName?: string;
  sourceId: string;
  source: ProviderId;
  durationMs: number;
  previewUrl?: string | null;
  artworkUrl?: string;
  externalUrl?: string;
  isPlayable?: boolean;
};

export type Artist = {
  id: string;
  name: string;
  sourceId: string;
  trackIds: string[];
  imageUrl?: string;
};

export type Playlist = {
  id: string;
  name: string;
  sourceId: string;
  trackIds: string[];
  artworkUrl?: string;
  /** Present before playlist items have been fetched. */
  total?: number;
  tracksLoaded?: boolean;
  unavailable?: boolean;
  /** Feb 2026 owner rule. These playlists are not retried. */
  ownerDenied?: boolean;
  ownerId?: string;
  collaborative?: boolean;
};

export type MusicLibrary = {
  provider: ProviderId;
  savedTrackIds: string[];
  tracks: Record<string, Track>;
  artists: Artist[];
  playlists: Playlist[];
};

export type PlaybackSource = {
  url: string;
  kind: "preview" | "full";
};

/** Provider-agnostic connection state. Spotify is one implementation. */
export type ProviderConnection = {
  status: "setup" | "disconnected" | "connecting" | "connected" | "error";
  account: string | null;
  error: string | null;
};

/** @deprecated Use ProviderConnection. Kept for provider implementations. */
export type SpotifyConnection = ProviderConnection;

export type MusicProvider = {
  id: ProviderId;
  loadLibrary: () => Promise<MusicLibrary>;
  getPlaylistTracks: (library: MusicLibrary, id: string) => Promise<Track[]>;
  getArtistTracks: (library: MusicLibrary, id: string) => Promise<Track[]>;
  resolvePlayback: (track: Track) => Promise<PlaybackSource | null>;
  connectionStatus?: () => ProviderConnection["status"];
  readConnection?: () => ProviderConnection;
  saveClientId?: (clientId: string) => void;
  cachedLibrary?: () => MusicLibrary | null;
  ensurePlaylist?: (library: MusicLibrary, id: string) => Promise<MusicLibrary>;
  connect?: () => Promise<ProviderConnection>;
  disconnect?: () => Promise<void>;
  refresh?: () => Promise<MusicLibrary>;
};
