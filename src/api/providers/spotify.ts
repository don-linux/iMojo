import { artistTracks, playlistTracks } from "../selectors.ts";
import type { MusicProvider, ProviderConnection } from "../types.ts";

export const spotifyConfig = {
  clientId: import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? "",
  redirectUri: import.meta.env.VITE_SPOTIFY_REDIRECT_URI ?? "",
  bffUrl: import.meta.env.VITE_SPOTIFY_BFF_URL ?? "",
};

export function isSpotifyConfigured() {
  return Boolean(spotifyConfig.bffUrl || spotifyConfig.clientId);
}

function setupMessage() {
  return "Configure VITE_SPOTIFY_BFF_URL or VITE_SPOTIFY_CLIENT_ID";
}

export const spotifyProvider: MusicProvider = {
  id: "spotify",
  connectionStatus() {
    return isSpotifyConfigured() ? "disconnected" : "setup";
  },
  async loadLibrary() {
    if (!isSpotifyConfigured()) throw new Error(setupMessage());
    // TODO: exchange the OAuth code through the BFF/JWK endpoint, then call:
    // GET /me/tracks?limit=50&offset=...
    // GET /me/playlists?limit=50&offset=...
    // GET /me/following?type=artist&limit=50&after=...
    // Pagination follows `next`; 429 responses honor `Retry-After`.
    throw new Error("Spotify authorization is not implemented yet");
  },
  async getPlaylistTracks(library, id) {
    const playlist = library.playlists.find((entry) => entry.id === id);
    if (!playlist) {
      // TODO: GET /playlists/{id}/tracks?limit=100&offset=...
      return [];
    }
    return playlistTracks(library, playlist);
  },
  async getArtistTracks(library, id) {
    const artist = library.artists.find((entry) => entry.id === id);
    if (!artist) {
      // TODO: GET /artists/{id}/top-tracks?market=...
      return [];
    }
    return artistTracks(library, artist);
  },
  async resolvePlayback(track) {
    if (track.previewUrl) return { url: track.previewUrl, kind: "preview" };
    // TODO: full playback uses the Web Playback SDK with the `streaming` scope
    // and a Spotify Premium account. Preview URLs may be absent.
    return null;
  },
  async connect(): Promise<ProviderConnection> {
    if (!isSpotifyConfigured()) {
      return { status: "setup", account: null, error: setupMessage() };
    }
    // TODO: redirect to the BFF PKCE authorize endpoint. The browser must not
    // hold the client secret. Store the verifier in sessionStorage and clear it
    // after the callback.
    return {
      status: "error",
      account: null,
      error: "Spotify authorization is not implemented yet",
    };
  },
  async disconnect() {
    // TODO: revoke the BFF session and clear any local connection state.
  },
  async refresh() {
    return this.loadLibrary();
  },
};
