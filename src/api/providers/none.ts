import type { MusicLibrary, MusicProvider } from "../types.ts";

export const emptyLibrary: MusicLibrary = {
  provider: "none",
  savedTrackIds: [],
  tracks: {},
  artists: [],
  playlists: [],
};

export const noneProvider: MusicProvider = {
  id: "none",
  async loadLibrary() {
    return emptyLibrary;
  },
  async getPlaylistTracks() {
    return [];
  },
  async getArtistTracks() {
    return [];
  },
  async resolvePlayback() {
    return null;
  },
};
