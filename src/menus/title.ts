import type { Frame } from "./types.ts";

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
