import { BACKLIGHTS, CLICKER_LABEL, REPEAT_LABEL, SHUFFLE_LABEL } from "./model.ts";
import type { Settings } from "./model.ts";
import { spotifyRows } from "./spotifyRows.ts";
import { EMPTY_MENU_DATA } from "./types.ts";
import type { Frame, MenuData, Row, SongEntry } from "./types.ts";

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");
const GIGABYTE_FORMAT = new Intl.NumberFormat("en-US", {
  style: "unit",
  unit: "gigabyte",
});

function formatGigabytes(value: number) {
  return GIGABYTE_FORMAT.format(value);
}

function trackRows(songs: SongEntry[]): Row[] {
  return songs.map((song) => ({
    id: song.id,
    title: song.title,
    action: "play" as const,
  }));
}

function mainRows(data: MenuData): Row[] {
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
}

function playlistListRows(data: MenuData): Row[] {
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
}

function artistListRows(data: MenuData): Row[] {
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
}

function songRows(data: MenuData): Row[] {
  if (data.songs.length === 0) {
    return [{ id: "no-music", title: "No Music", action: "info", centered: true }];
  }
  return trackRows(data.songs);
}

function playlistRows(frame: Frame, data: MenuData): Row[] {
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

function artistRows(frame: Frame, data: MenuData): Row[] {
  const songs = data.artistSongs[frame.param ?? ""] ?? [];
  if (songs.length === 0) {
    return [{ id: "no-music", title: "No Music", action: "info", centered: true }];
  }
  return trackRows(songs);
}

function settingsRows(settings: Settings): Row[] {
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
}

function aboutRows(data: MenuData): Row[] {
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
}

function backlightRows(): Row[] {
  return BACKLIGHTS.map((entry) => ({
    id: entry.id,
    title: entry.title,
    action: "choose" as const,
  }));
}

function resetRows(): Row[] {
  return [
    { id: "cancel", title: "Cancel", action: "cancel" },
    { id: "reset-all", title: "Reset", action: "reset" },
  ];
}

export function rows(frame: Frame, settings: Settings, data: MenuData = EMPTY_MENU_DATA): Row[] {
  switch (frame.id) {
    case "main":
      return mainRows(data);
    case "playlists":
      return playlistListRows(data);
    case "artists":
      return artistListRows(data);
    case "songs":
      return songRows(data);
    case "playlist":
      return playlistRows(frame, data);
    case "artist":
      return artistRows(frame, data);
    case "settings":
      return settingsRows(settings);
    case "spotify":
      return spotifyRows(data.connection);
    case "about":
      return aboutRows(data);
    case "backlight":
      return backlightRows();
    case "reset":
      return resetRows();
    case "now-playing":
    case "brick":
      return [];
  }
}
