import type { MusicLibrary, MusicProvider, ProviderConnection, Track } from "../types.ts";
import { beginLogin } from "../spotify/auth.ts";
import { SpotifySessionError } from "../spotify/api.ts";
import {
  cachedSpotifyLibrary,
  emptySpotifyLibrary,
  fetchPlaylistTracks,
  fetchSpotifyLibrary,
} from "../spotify/library.ts";
import {
  disconnectSpotify,
  isSpotifyClientId,
  readClientId,
  readProfile,
  readTokens,
  writeClientId,
} from "../spotify/storage.ts";

const CLIENT_ID_ERROR = "Client ID must be 32 hex characters";
const STORAGE_BLOCKED = "This browser is blocking site storage";

function connection(): ProviderConnection {
  const clientId = readClientId();
  if (!clientId) return { status: "setup", account: null, error: null };
  const profile = readProfile();
  if (!isSpotifyClientId(clientId)) {
    return { status: "error", account: profile?.name ?? null, error: CLIENT_ID_ERROR };
  }
  if (!readTokens()) return { status: "disconnected", account: profile?.name ?? null, error: null };
  return { status: "connected", account: profile?.name ?? null, error: null };
}

export const spotifyProvider: MusicProvider = {
  id: "spotify",
  connectionStatus() {
    return connection().status;
  },
  readConnection() {
    return connection();
  },
  saveClientId(clientId: string) {
    const next = clientId.trim();
    if (!isSpotifyClientId(next)) throw new SpotifySessionError(CLIENT_ID_ERROR);
    if (!writeClientId(next)) throw new SpotifySessionError(STORAGE_BLOCKED);
  },
  cachedLibrary() {
    return cachedSpotifyLibrary();
  },
  async loadLibrary() {
    if (!readClientId() || !readTokens()) return emptySpotifyLibrary();
    return fetchSpotifyLibrary();
  },
  async ensurePlaylist(library: MusicLibrary, id: string) {
    return fetchPlaylistTracks(library, id);
  },
  async getPlaylistTracks(library, id) {
    const next = await fetchPlaylistTracks(library, id);
    const playlist = next.playlists.find((entry) => entry.id === id);
    if (!playlist) return [];
    return playlist.trackIds
      .map((trackId) => next.tracks[trackId])
      .filter((track): track is Track => Boolean(track));
  },
  async getArtistTracks(library, id) {
    const artist = library.artists.find((entry) => entry.id === id);
    if (!artist) return [];
    return artist.trackIds
      .map((trackId) => library.tracks[trackId])
      .filter((track): track is Track => Boolean(track));
  },
  async resolvePlayback(track) {
    if (!track.id) return null;
    return { url: `spotify:track:${track.id}`, kind: "full" };
  },
  async connect() {
    if (!readClientId()) {
      return { status: "setup", account: null, error: "Paste your Client ID first" };
    }
    try {
      await beginLogin();
      return connection();
    } catch (reason) {
      if (reason instanceof SpotifySessionError) {
        return { status: "error", account: readProfile()?.name ?? null, error: reason.message };
      }
      return {
        status: "error",
        account: null,
        error: reason instanceof Error ? reason.message : "Spotify sign-in failed",
      };
    }
  },
  async disconnect() {
    disconnectSpotify();
  },
  async refresh() {
    return this.loadLibrary();
  },
};
