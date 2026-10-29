import type { ProviderConnection } from "../api/types.ts";

export type ScreenId =
  | "main"
  | "playlists"
  | "artists"
  | "songs"
  | "playlist"
  | "artist"
  | "settings"
  | "about"
  | "backlight"
  | "reset"
  | "spotify"
  | "now-playing"
  | "brick";

export type Frame = {
  id: ScreenId;
  index: number;
  param?: string;
  title?: string;
};

export type Row = {
  id: string;
  title: string;
  value?: string;
  centered?: boolean;
  action:
    | "open"
    | "info"
    | "cycle"
    | "choose"
    | "cancel"
    | "reset"
    | "play"
    | "spotify-connect"
    | "spotify-disconnect"
    | "spotify-refresh"
    | "spotify-copy-redirect"
    | "spotify-create-app"
    | "spotify-docs"
    | "spotify-client-id";
  screen?: ScreenId;
  screenTitle?: string;
  param?: string;
};

export type PlaylistEntry = { id: string; name: string; count: number };
export type ArtistEntry = { id: string; name: string; count: number };
export type SongEntry = { id: string; title: string; artistName: string };

export type MenuData = {
  playlists: PlaylistEntry[];
  artists: ArtistEntry[];
  songs: SongEntry[];
  playlistSongs: Record<string, SongEntry[]>;
  artistSongs: Record<string, SongEntry[]>;
  nowPlaying: { title: string; artistName: string } | null;
  connection: {
    status: ProviderConnection["status"];
    account: string | null;
    error: string | null;
    sourceLabel: string;
    counts: { playlists: number; artists: number; songs: number };
    redirectCopied: boolean;
  };
  playlistDetail: Record<string, { loaded: boolean; unavailable: boolean }>;
};

export const EMPTY_MENU_DATA: MenuData = {
  playlists: [],
  artists: [],
  songs: [],
  playlistSongs: {},
  artistSongs: {},
  nowPlaying: null,
  connection: {
    status: "setup",
    account: null,
    error: null,
    sourceLabel: "Spotify",
    counts: { playlists: 0, artists: 0, songs: 0 },
    redirectCopied: false,
  },
  playlistDetail: {},
};
