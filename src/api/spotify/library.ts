import type { Artist, MusicLibrary, Playlist, Track } from "../types.ts";
import { collectPages, SpotifyRequestError, spotifyJson } from "./api.ts";
import { getAccessToken } from "./auth.ts";
import {
  readCachedLibrary,
  readClientId,
  readProfile,
  readTokens,
  writeCachedLibrary,
  writeProfile,
} from "./storage.ts";

type SpotifyImage = { url: string; width: number | null };
type SpotifyArtist = { id: string; name: string; images?: SpotifyImage[] };
type SpotifyTrack = {
  id: string | null;
  name: string;
  duration_ms: number;
  is_playable?: boolean;
  preview_url?: string | null;
  type?: string;
  artists?: SpotifyArtist[];
  album?: { name?: string; images?: SpotifyImage[] };
};
type SpotifyPlaylist = {
  id: string;
  name: string;
  collaborative?: boolean;
  images?: SpotifyImage[];
  owner?: { id?: string };
  items?: { total?: number };
  tracks?: { total?: number };
};
type SavedTrack = { track: SpotifyTrack | null };
type PlaylistItem = { item?: SpotifyTrack | null; track?: SpotifyTrack | null; is_local?: boolean };
type Me = { id: string; display_name: string | null; product?: string };

const API = "https://api.spotify.com/v1";

export function emptySpotifyLibrary(): MusicLibrary {
  return { provider: "spotify", savedTrackIds: [], tracks: {}, artists: [], playlists: [] };
}

function artwork(images: SpotifyImage[] | undefined) {
  if (!images?.length) return undefined;
  const sized = images.filter((image) => image.url);
  const large = sized.find((image) => (image.width ?? 0) >= 300);
  return (large ?? sized[sized.length - 1])?.url;
}

function mapTrack(track: SpotifyTrack | null | undefined): Track | null {
  if (!track?.id || track.type === "episode") return null;
  const artist = track.artists?.[0];
  return {
    id: track.id,
    title: track.name,
    artistId: artist?.id ?? "",
    artistName: artist?.name || "Unknown",
    albumName: track.album?.name,
    sourceId: track.id,
    source: "spotify",
    durationMs: track.duration_ms,
    previewUrl: track.preview_url,
    artworkUrl: artwork(track.album?.images),
    externalUrl: `https://open.spotify.com/track/${track.id}`,
    isPlayable: track.is_playable ?? true,
  };
}

export function withDerivedArtists(library: MusicLibrary): MusicLibrary {
  const idsByArtist = new Map<string, string[]>();
  const add = (trackId: string) => {
    const track = library.tracks[trackId];
    if (!track?.artistId) return;
    const list = idsByArtist.get(track.artistId);
    if (list) {
      if (!list.includes(track.id)) list.push(track.id);
    } else idsByArtist.set(track.artistId, [track.id]);
  };
  for (const id of library.savedTrackIds) add(id);
  for (const playlist of library.playlists) {
    if (!playlist.tracksLoaded) continue;
    for (const id of playlist.trackIds) add(id);
  }
  return {
    ...library,
    artists: library.artists.map((artist) => ({
      ...artist,
      trackIds: idsByArtist.get(artist.id) ?? [],
    })),
  };
}

function remember(library: MusicLibrary, track: Track) {
  library.tracks[track.id] = track;
}

async function token() {
  return getAccessToken();
}

async function followedArtists() {
  const artists: SpotifyArtist[] = [];
  let next: string | null = `${API}/me/following?type=artist&limit=50`;
  while (next) {
    const page: { artists?: { items?: SpotifyArtist[]; next?: string | null } } = await spotifyJson(
      next,
      await token(),
    );
    artists.push(...(page.artists?.items ?? []));
    next = page.artists?.next ?? null;
  }
  return artists;
}

function playlistFromApi(playlist: SpotifyPlaylist, loaded = false): Playlist {
  return {
    id: playlist.id,
    name: playlist.name,
    sourceId: playlist.id,
    trackIds: [],
    artworkUrl: artwork(playlist.images),
    total: playlist.items?.total ?? playlist.tracks?.total ?? 0,
    tracksLoaded: loaded,
    unavailable: false,
    ownerId: playlist.owner?.id,
    collaborative: Boolean(playlist.collaborative),
  };
}

export function cachedSpotifyLibrary() {
  if (!readClientId() || !readTokens()) return null;
  return readCachedLibrary();
}

export async function fetchSpotifyLibrary(): Promise<MusicLibrary> {
  const access = await token();
  const me = await spotifyJson<Me>(`${API}/me`, access);
  writeProfile({
    id: me.id,
    name: me.display_name || "Spotify",
    product: me.product || "",
  });

  const [playlistItems, saved, artists] = await Promise.all([
    collectPages<SpotifyPlaylist>(`${API}/me/playlists?limit=50`, token),
    collectPages<SavedTrack>(`${API}/me/tracks?limit=50&market=from_token`, token),
    followedArtists(),
  ]);

  const library = emptySpotifyLibrary();
  for (const savedTrack of saved) {
    const track = mapTrack(savedTrack.track);
    if (!track) continue;
    remember(library, track);
    library.savedTrackIds.push(track.id);
  }
  library.playlists = playlistItems
    .filter((playlist) => playlist.id)
    .map((playlist) => playlistFromApi(playlist));
  library.artists = artists
    .filter((artist) => artist.id)
    .map((artist): Artist => ({
      id: artist.id,
      name: artist.name,
      sourceId: artist.id,
      trackIds: [],
      imageUrl: artwork(artist.images),
    }));
  const next = withDerivedArtists(library);
  writeCachedLibrary(next);
  return next;
}

export async function fetchPlaylistTracks(
  library: MusicLibrary,
  id: string,
): Promise<MusicLibrary> {
  const current = library.playlists.find((playlist) => playlist.id === id);
  if (!current || current.tracksLoaded || current.unavailable) return library;
  const profile = readProfile();
  const owned = Boolean(profile?.id && current.ownerId === profile.id);
  if (current.ownerId && !owned && !current.collaborative) {
    return replacePlaylist(library, {
      ...current,
      unavailable: true,
      tracksLoaded: true,
      trackIds: [],
    });
  }

  try {
    const items = await collectPages<PlaylistItem>(
      `${API}/playlists/${encodeURIComponent(id)}/items?limit=50&market=from_token`,
      token,
    );
    const nextLibrary: MusicLibrary = {
      ...library,
      tracks: { ...library.tracks },
      playlists: library.playlists.map((playlist) => ({
        ...playlist,
        trackIds: [...playlist.trackIds],
      })),
    };
    const trackIds: string[] = [];
    for (const entry of items) {
      if (entry.is_local) continue;
      const track = mapTrack(entry.item ?? entry.track);
      if (!track) continue;
      remember(nextLibrary, track);
      trackIds.push(track.id);
    }
    const updated = nextLibrary.playlists.map((playlist) =>
      playlist.id === id
        ? { ...playlist, trackIds, tracksLoaded: true, unavailable: false, total: trackIds.length }
        : playlist,
    );
    const next = withDerivedArtists({ ...nextLibrary, playlists: updated });
    writeCachedLibrary(next);
    return next;
  } catch (reason) {
    if (reason instanceof SpotifyRequestError && (reason.status === 403 || reason.status === 404)) {
      const next = replacePlaylist(library, {
        ...current,
        unavailable: true,
        tracksLoaded: true,
        trackIds: [],
      });
      writeCachedLibrary(next);
      return next;
    }
    throw reason;
  }
}

function replacePlaylist(library: MusicLibrary, playlist: Playlist): MusicLibrary {
  return withDerivedArtists({
    ...library,
    playlists: library.playlists.map((entry) => (entry.id === playlist.id ? playlist : entry)),
  });
}
