import { spotifyProvider } from "./providers/spotify.ts";
import type { MusicProvider } from "./types.ts";

export function createProvider(): MusicProvider {
  return spotifyProvider;
}

export function providerLabel() {
  return "Spotify";
}
