export const CLIENT_ID = "a1b2c3d4e5f6789012345678abcdef01";

export const PROFILE = {
  id: "user-baseline",
  name: "Ada Lovelace",
  product: "premium",
};

export const TOKENS = {
  accessToken: "baseline-access-token",
  refreshToken: "baseline-refresh-token",
  expiresAt: 4_102_444_800_000,
};

export const SONG_COUNT = 120;
export const ARTIST_COUNT = 30;
export const PLAYLIST_COUNT = 40;
export const SCROLLED_SONG_INDEX = 25;

const ADJECTIVES = [
  "Pale",
  "Quiet",
  "Silver",
  "Last",
  "Golden",
  "Hidden",
  "Slow",
  "Northern",
  "Little",
  "Broken",
];

const NOUNS = [
  "September",
  "Highway",
  "Morning",
  "Satellite",
  "River",
  "Window",
  "Harbor",
  "Letter",
  "Engine",
  "Garden",
  "Station",
  "Mirror",
];

export type BacklightSeed = "off" | "always_on";

export function settingsSeed(backlight: BacklightSeed) {
  return {
    shuffle: "off" as const,
    repeat: "off" as const,
    clicker: "on" as const,
    backlight,
    backlightChosen: true,
    volume: 50,
  };
}

export function songTitle(index: number) {
  const adjective = ADJECTIVES[index % ADJECTIVES.length] ?? "Pale";
  const noun = NOUNS[index % NOUNS.length] ?? "September";
  return `${adjective} ${noun}`;
}

export function artistName(index: number) {
  if (index === 0) return "Blue Nile and the Very Long Ensemble";
  if (index === 1) return "Night Shift \u{1F3A7}";
  return `Artist ${String(index).padStart(2, "0")}`;
}

export function playlistName(index: number) {
  if (index === 0) return "Sunday Morning \u{1F3A7}";
  if (index === 1) return "Late Night Drive Through the City with the Windows Down";
  if (index === PLAYLIST_COUNT - 1) return "ZZ Bottom of the List";
  return `Playlist ${String(index).padStart(2, "0")}`;
}

function trackId(index: number) {
  return `tr-${String(index).padStart(3, "0")}`;
}

function playlistTrackIds(index: number) {
  const ids = [0, 1, 2, 3, 4].map((offset) => trackId((index * 3 + offset) % SONG_COUNT));
  if (index === 0) ids.push(trackId(0));
  return ids;
}

export function buildLibrary() {
  const artists = Array.from({ length: ARTIST_COUNT }, (_, index) => ({
    id: `ar-${String(index).padStart(2, "0")}`,
    name: artistName(index),
    sourceId: `ar-${String(index).padStart(2, "0")}`,
    trackIds: [] as string[],
  }));

  const tracks: Record<string, {
    id: string;
    title: string;
    artistId: string;
    artistName: string;
    albumName: string;
    sourceId: string;
    source: "spotify";
    durationMs: number;
    previewUrl: null;
    externalUrl: string;
    isPlayable: true;
  }> = {};
  const savedTrackIds: string[] = [];

  for (let index = 0; index < SONG_COUNT; index += 1) {
    const artist = artists[index % ARTIST_COUNT];
    if (!artist) continue;
    const id = trackId(index);
    tracks[id] = {
      id,
      title: songTitle(index),
      artistId: artist.id,
      artistName: artist.name,
      albumName: `Album ${String(index % 12).padStart(2, "0")}`,
      sourceId: id,
      source: "spotify",
      durationMs: 125_000 + (index % 50) * 1_000,
      previewUrl: null,
      externalUrl: `https://open.spotify.com/track/${id}`,
      isPlayable: true,
    };
    savedTrackIds.push(id);
    artist.trackIds.push(id);
  }

  const playlists = Array.from({ length: PLAYLIST_COUNT }, (_, index) => {
    const id = `pl-${String(index).padStart(2, "0")}`;
    const trackIds = playlistTrackIds(index);
    return {
      id,
      name: playlistName(index),
      sourceId: id,
      trackIds,
      total: trackIds.length,
      tracksLoaded: true,
      unavailable: false,
      ownerId: PROFILE.id,
      collaborative: false,
    };
  });

  return {
    provider: "spotify" as const,
    savedTrackIds,
    tracks,
    artists,
    playlists,
  };
}
