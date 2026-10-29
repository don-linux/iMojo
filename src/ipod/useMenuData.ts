import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { Player } from "../api/player/types.ts";
import { artistTracks, playlistTracks, savedTracks } from "../api/selectors.ts";
import { warmSpotifyPlayer } from "../api/spotify/runtime.ts";
import type { MusicLibraryState } from "../api/useMusicLibrary.tsx";
import type { Frame, MenuData } from "../menus/types.ts";
import { songEntry } from "./model.ts";

export function useMenuData(music: MusicLibraryState, player: Player, redirectCopied: boolean) {
  const data = useMemo<MenuData>(() => {
    const songs = savedTracks(music.library);
    const playlistSongs: Record<string, ReturnType<typeof songEntry>[]> = {};
    const artistSongs: Record<string, ReturnType<typeof songEntry>[]> = {};

    for (const playlist of music.library.playlists) {
      playlistSongs[playlist.id] = playlistTracks(music.library, playlist).map(songEntry);
    }
    for (const artist of music.library.artists) {
      artistSongs[artist.id] = artistTracks(music.library, artist).map(songEntry);
    }

    return {
      playlists: music.library.playlists.map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        count: playlist.tracksLoaded
          ? playlist.trackIds.length
          : (playlist.total ?? playlist.trackIds.length),
      })),
      playlistDetail: Object.fromEntries(
        music.library.playlists.map((playlist) => [
          playlist.id,
          { loaded: Boolean(playlist.tracksLoaded), unavailable: Boolean(playlist.unavailable) },
        ]),
      ),
      artists: music.library.artists.map((artist) => ({
        id: artist.id,
        name: artist.name,
        count: artist.trackIds.length,
      })),
      songs: songs.map(songEntry),
      playlistSongs,
      artistSongs,
      nowPlaying:
        player.track && !player.finished
          ? { title: player.track.title, artistName: player.track.artistName }
          : null,
      connection: {
        status: music.connection.status,
        account: music.connection.account,
        error: music.error ?? music.connection.error,
        sourceLabel: music.sourceLabel,
        counts: {
          playlists: music.library.playlists.length,
          artists: music.library.artists.length,
          songs: music.library.savedTrackIds.length,
        },
        redirectCopied,
      },
    };
  }, [
    music.library,
    music.connection,
    music.error,
    music.sourceLabel,
    player.track,
    player.finished,
    redirectCopied,
  ]);

  const dataRef = useRef(data);
  useLayoutEffect(() => {
    dataRef.current = data;
  }, [data]);
  return { data, dataRef };
}

export function useConnectedWarmup(music: MusicLibraryState) {
  useEffect(() => {
    if (music.connection.status === "connected") warmSpotifyPlayer();
  }, [music.connection.status]);
}

export function usePlaylistFetch(stack: Frame[], music: MusicLibraryState) {
  const playlistId = stack.at(-1)?.id === "playlist" ? stack.at(-1)?.param : undefined;
  const openPlaylist = music.library.playlists.find((playlist) => playlist.id === playlistId);
  const known = openPlaylist != null;
  const loaded = Boolean(openPlaylist?.tracksLoaded);
  const unavailable = Boolean(openPlaylist?.unavailable);
  const loadPlaylist = music.loadPlaylist;
  useEffect(() => {
    if (!playlistId || !known || loaded || unavailable) return;
    void loadPlaylist(playlistId);
  }, [playlistId, known, loaded, unavailable, loadPlaylist]);
}
