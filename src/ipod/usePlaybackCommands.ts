import type { RefObject } from "react";
import type { Player } from "../api/player/types.ts";
import { artistTracks, playlistTracks, savedTracks } from "../api/selectors.ts";
import { primeSpotifyPlayback } from "../api/spotify/runtime.ts";
import type { MusicLibraryState } from "../api/useMusicLibrary.tsx";
import type { Track } from "../api/types.ts";
import type { Settings } from "../menus/model.ts";
import type { Frame, MenuData } from "../menus/types.ts";
import type { Overlay } from "./model.ts";
import { topFrame } from "./navigation.ts";
import { playbackSlice, selectionView } from "./selection.ts";

type PlaybackInput = {
  music: MusicLibraryState;
  playerRef: RefObject<Player>;
  settingsRef: RefObject<Settings>;
  stackRef: RefObject<Frame[]>;
  dataRef: RefObject<MenuData>;
  overlayRef: RefObject<Overlay>;
  pressOnly: () => void;
  push: (id: Frame["id"], param?: string, title?: string) => void;
  activate: () => void;
};

function sameQueue(left: readonly Track[], right: readonly Track[]) {
  return (
    left.length === right.length && left.every((track, index) => track.id === right[index]?.id)
  );
}

export function usePlaybackCommands({
  music,
  playerRef,
  settingsRef,
  stackRef,
  dataRef,
  overlayRef,
  pressOnly,
  push,
  activate,
}: PlaybackInput) {
  function queueFor(frame: Frame) {
    if (frame.id === "songs") return savedTracks(music.library);
    if (frame.id === "playlist") {
      const playlist = music.library.playlists.find((entry) => entry.id === frame.param);
      return playlist ? playlistTracks(music.library, playlist) : [];
    }
    if (frame.id === "artist") {
      const artist = music.library.artists.find((entry) => entry.id === frame.param);
      return artist ? artistTracks(music.library, artist) : [];
    }
    return [];
  }

  function playTrack(position: number) {
    const frame = topFrame(stackRef);
    if (!frame) return;
    const queue = queueFor(frame);
    const index = position;
    if (index < 0 || index >= queue.length) return;
    const current = playerRef.current;
    const snapshot = current.getSnapshot();
    if (snapshot.hasLoaded && snapshot.index === index && sameQueue(snapshot.queue, queue)) {
      if (!current.playing) current.toggle();
    } else {
      current.playQueue(queue, index);
    }
    if (frame.id !== "now-playing") push("now-playing");
  }

  function playPause() {
    if (overlayRef.current) return;
    primeSpotifyPlayback();
    pressOnly();
    const current = playerRef.current;
    if (current.hasLoaded || current.loading) {
      current.toggle();
      return;
    }
    const frame = topFrame(stackRef);
    const row = frame
      ? selectionView(frame, settingsRef.current, dataRef.current, playbackSlice(playerRef.current)).row
      : undefined;
    if (
      row?.action === "open" &&
      (row.screen === "songs" || row.screen === "playlist" || row.screen === "artist")
    ) {
      const queue = queueFor({ id: row.screen, index: 0, param: row.param });
      if (queue.length > 0) {
        const start =
          settingsRef.current.shuffle === "songs" ? Math.floor(Math.random() * queue.length) : 0;
        current.playQueue(queue, start);
        push("now-playing");
        return;
      }
    }
    if (row?.action === "play") {
      activate();
      return;
    }
    if (current.queue.length > 0) current.toggle();
  }

  return { playTrack, playPause };
}
