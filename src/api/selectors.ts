import type { Artist, MusicLibrary, Playlist, Track } from "./types.ts";

export function tracksFor(library: MusicLibrary, ids: readonly string[]): Track[] {
  return ids.map((id) => library.tracks[id]).filter((track): track is Track => Boolean(track));
}

export function savedTracks(library: MusicLibrary): Track[] {
  return tracksFor(library, library.savedTrackIds);
}

export function playlistTracks(library: MusicLibrary, playlist: Playlist): Track[] {
  return tracksFor(library, playlist.trackIds);
}

export function artistTracks(library: MusicLibrary, artist: Artist): Track[] {
  return tracksFor(library, artist.trackIds);
}

export function libraryCounts(library: MusicLibrary) {
  return {
    playlists: library.playlists.length,
    artists: library.artists.length,
    songs: library.savedTrackIds.length,
  };
}
