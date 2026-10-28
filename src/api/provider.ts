import { noneProvider } from "./providers/none.ts";
import { spotifyProvider } from "./providers/spotify.ts";
import type { MusicProvider, ProviderId } from "./types.ts";

const providers: Record<ProviderId, MusicProvider> = {
  none: noneProvider,
  spotify: spotifyProvider,
};

export function providerIdFromEnv(): ProviderId {
  const value = import.meta.env.VITE_MUSIC_PROVIDER;
  if (value === "none") return "none";
  return "spotify";
}

export function createProvider(id: ProviderId = providerIdFromEnv()): MusicProvider {
  return providers[id];
}

export function providerLabel(id: ProviderId) {
  if (id === "spotify") return "Spotify";
  return "No Music";
}
