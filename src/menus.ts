import type { ProviderConnection } from "./api/types.ts";

export const SHUFFLE = ["off", "songs"] as const;
export const REPEAT = ["off", "one", "all"] as const;
export const CLICKER = ["off", "on"] as const;

export const BACKLIGHTS = [
  { id: "off", title: "Off", ms: null },
  { id: "1sec", title: "1 second", ms: 1000 },
  { id: "2sec", title: "2 seconds", ms: 2000 },
  { id: "3sec", title: "3 seconds", ms: 3000 },
  { id: "5sec", title: "5 seconds", ms: 5000 },
  { id: "always_on", title: "Always On", ms: null },
] as const;

export type Shuffle = (typeof SHUFFLE)[number];
export type Repeat = (typeof REPEAT)[number];
export type Clicker = (typeof CLICKER)[number];
export type BacklightMode = (typeof BACKLIGHTS)[number]["id"];

export type Settings = {
  shuffle: Shuffle;
  repeat: Repeat;
  clicker: Clicker;
  backlight: BacklightMode;
  backlightChosen: boolean;
  volume: number;
};

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

const SHUFFLE_LABEL: Record<Shuffle, string> = { off: "Off", songs: "Songs" };
const REPEAT_LABEL: Record<Repeat, string> = { off: "Off", one: "One", all: "All" };
const CLICKER_LABEL: Record<Clicker, string> = { off: "Off", on: "On" };

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");
const GIGABYTE_FORMAT = new Intl.NumberFormat("en-US", {
  style: "unit",
  unit: "gigabyte",
});

function formatGigabytes(value: number) {
  return GIGABYTE_FORMAT.format(value);
}

function spotifyStatusLabel(status: ProviderConnection["status"]) {
  if (status === "setup") return "Setup required";
  if (status === "connecting") return "Connecting…";
  if (status === "connected") return "Connected";
  if (status === "error") return "Error";
  return "Not connected";
}

export function defaultSettings(): Settings {
  const dark =
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return {
    shuffle: "off",
    repeat: "off",
    clicker: "on",
    backlight: dark ? "always_on" : "off",
    backlightChosen: false,
    volume: 50,
  };
}

export function isBacklight(value: unknown): value is BacklightMode {
  return BACKLIGHTS.some((entry) => entry.id === value);
}

export function nextValue<T extends string>(order: readonly T[], current: T): T {
  const index = order.indexOf(current);
  return order[(index + 1) % order.length] ?? order[0];
}

export function cycleSetting(settings: Settings, id: string): Settings {
  if (id === "shuffle") return { ...settings, shuffle: nextValue(SHUFFLE, settings.shuffle) };
  if (id === "repeat") return { ...settings, repeat: nextValue(REPEAT, settings.repeat) };
  if (id === "clicker") return { ...settings, clicker: nextValue(CLICKER, settings.clicker) };
  return settings;
}

export function titleFor(frame: Frame): string {
  switch (frame.id) {
    case "main":
      return "iPod";
    case "playlists":
      return "Playlists";
    case "artists":
      return "Artists";
    case "songs":
      return frame.title ?? "Songs";
    case "playlist":
      return frame.title ?? "Playlist";
    case "artist":
      return frame.title ?? "Artist";
    case "settings":
      return "Settings";
    case "about":
      return "About";
    case "backlight":
      return "Backlight Timer";
    case "reset":
      return "Reset All Settings";
    case "spotify":
      return "Spotify";
    case "now-playing":
      return "Now Playing";
    case "brick":
      return "Brick";
  }
}

function trackRows(songs: SongEntry[]): Row[] {
  return songs.map((song) => ({
    id: song.id,
    title: song.title,
    action: "play" as const,
  }));
}

export function rows(frame: Frame, settings: Settings, data: MenuData = EMPTY_MENU_DATA): Row[] {
  switch (frame.id) {
    case "main":
      return [
        { id: "playlists", title: "Playlists", action: "open", screen: "playlists" },
        { id: "artists", title: "Artists", action: "open", screen: "artists" },
        { id: "songs", title: "Songs", action: "open", screen: "songs" },
        { id: "settings", title: "Settings", action: "open", screen: "settings" },
        ...(data.nowPlaying
          ? [
              {
                id: "now-playing",
                title: "Now Playing",
                action: "open" as const,
                screen: "now-playing" as const,
              },
            ]
          : []),
      ];
    case "playlists":
      if (data.playlists.length === 0) {
        return [{ id: "no-music", title: "No Music", action: "info", centered: true }];
      }
      return data.playlists.map((playlist) => ({
        id: playlist.id,
        title: playlist.name,
        action: "open" as const,
        screen: "playlist" as const,
        param: playlist.id,
      }));
    case "artists":
      if (data.artists.length === 0) {
        return [{ id: "no-music", title: "No Music", action: "info", centered: true }];
      }
      return [
        ...(data.songs.length > 0
          ? [
              {
                id: "all-artists",
                title: "All",
                action: "open" as const,
                screen: "songs" as const,
                screenTitle: "All Songs",
              },
            ]
          : []),
        ...data.artists.map((artist) => ({
          id: artist.id,
          title: artist.name,
          action: "open" as const,
          screen: "artist" as const,
          param: artist.id,
        })),
      ];
    case "songs":
      if (data.songs.length === 0) {
        return [{ id: "no-music", title: "No Music", action: "info", centered: true }];
      }
      return trackRows(data.songs);
    case "playlist": {
      const id = frame.param ?? "";
      const detail = data.playlistDetail[id];
      const songs = data.playlistSongs[id] ?? [];
      if (detail?.unavailable) {
        return [{ id: "unavailable", title: "Unavailable", action: "info", centered: true }];
      }
      if (detail && !detail.loaded) {
        return [{ id: "loading", title: "Loading…", action: "info", centered: true }];
      }
      if (songs.length === 0) {
        return [{ id: "no-music", title: "No Music", action: "info", centered: true }];
      }
      return trackRows(songs);
    }
    case "artist": {
      const songs = data.artistSongs[frame.param ?? ""] ?? [];
      if (songs.length === 0) {
        return [{ id: "no-music", title: "No Music", action: "info", centered: true }];
      }
      return trackRows(songs);
    }
    case "settings":
      return [
        { id: "about", title: "About", action: "open", screen: "about" },
        {
          id: "shuffle",
          title: "Shuffle",
          value: SHUFFLE_LABEL[settings.shuffle],
          action: "cycle",
        },
        {
          id: "repeat",
          title: "Repeat",
          value: REPEAT_LABEL[settings.repeat],
          action: "cycle",
        },
        { id: "backlight", title: "Backlight Timer", action: "open", screen: "backlight" },
        {
          id: "clicker",
          title: "Clicker",
          value: CLICKER_LABEL[settings.clicker],
          action: "cycle",
        },
        { id: "reset", title: "Reset All Settings", action: "open", screen: "reset" },
        { id: "spotify", title: "Spotify", action: "open", screen: "spotify" },
      ];
    case "spotify": {
      const connection = data.connection;
      const base: Row[] = [
        {
          id: "spotify-status",
          title: "Status",
          value: spotifyStatusLabel(connection.status),
          action: "info",
        },
        { id: "spotify-source", title: "Source", value: connection.sourceLabel, action: "info" },
        {
          id: "spotify-account",
          title: "Account",
          value: connection.account ?? "—",
          action: "info",
        },
      ];
      const setup: Row[] = [
        {
          id: "spotify-copy-redirect",
          title: "Copy Redirect URI",
          value: connection.redirectCopied ? "Copied" : undefined,
          action: "spotify-copy-redirect",
        },
        {
          id: "spotify-create-app",
          title: "Create personal app",
          action: "spotify-create-app",
        },
        { id: "spotify-docs", title: "Connection docs", action: "spotify-docs" },
        {
          id: "spotify-client-id",
          title: "Client ID",
          value: connection.status === "setup" ? "Not set" : "Saved",
          action: "spotify-client-id",
        },
      ];
      const actions: Row[] =
        connection.status === "connected"
          ? [
              { id: "spotify-refresh", title: "Refresh Library", action: "spotify-refresh" },
              { id: "spotify-disconnect", title: "Disconnect", action: "spotify-disconnect" },
            ]
          : [{ id: "spotify-connect", title: "Connect", action: "spotify-connect" }];
      if (connection.error) {
        actions.push({
          id: "spotify-error",
          title: "Error",
          value: connection.error,
          action: "info",
        });
      }
      return [...base, ...setup, ...actions];
    }
    case "about":
      return [
        { id: "name", title: "iPod", action: "info", centered: true },
        {
          id: "songs",
          title: "Songs",
          value: NUMBER_FORMAT.format(data.connection.counts.songs),
          action: "info",
        },
        { id: "capacity", title: "Capacity", value: formatGigabytes(9.2), action: "info" },
        { id: "available", title: "Available", value: formatGigabytes(4.5), action: "info" },
        { id: "version", title: "Version", value: "2644.1.0", action: "info" },
      ];
    case "backlight":
      return BACKLIGHTS.map((entry) => ({
        id: entry.id,
        title: entry.title,
        action: "choose" as const,
      }));
    case "reset":
      return [
        { id: "cancel", title: "Cancel", action: "cancel" },
        { id: "reset-all", title: "Reset", action: "reset" },
      ];
    case "now-playing":
    case "brick":
      return [];
  }
}
