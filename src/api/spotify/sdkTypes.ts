export const PLAYER_NAME = "iPod";
export const SDK_SCRIPT_URL = "https://sdk.scdn.co/spotify-player.js";
export const SDK_SCRIPT_SELECTOR = "script[data-spotify-sdk]";
export const SDK_LOAD_TIMEOUT_MS = 10_000;
export const SDK_READY_TIMEOUT_MS = 15_000;

export const PRESS_PLAY_AGAIN = "Press play again";
export const PRESS_PLAY_TO_START = "Press play to start playback";
export const SESSION_EXPIRED = "Spotify session expired";
export const PREMIUM_REQUIRED = "Spotify Premium is required to play";
export const SDK_BROWSER_MESSAGE = "Spotify playback is not supported in this browser";
export const PLAYER_NOT_LOADED = "Spotify player did not load";
export const PLAYER_NOT_CONNECTED = "Spotify player did not connect";
export const TRACK_ERROR = "This track cannot be played";

export type SpotifyPlaybackState = {
  paused: boolean;
  position: number;
  duration: number;
  timestamp: number;
  shuffle?: boolean;
  repeat_mode?: number;
  track_window: {
    current_track: { uri: string | null } | null;
  };
};

export type SpotifyPlayerEvent =
  | { device_id?: string; message?: string }
  | SpotifyPlaybackState
  | null
  | undefined;

export type SpotifyPlayer = {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  addListener: (name: string, callback: (event: SpotifyPlayerEvent) => void) => void;
  getCurrentState: () => Promise<SpotifyPlaybackState | null>;
  setVolume: (volume: number) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  activateElement: () => Promise<void>;
};

export type SpotifyPlayerOptions = {
  name: string;
  getOAuthToken: (callback: (token: string) => void) => void;
  volume?: number;
};

export type SpotifySdk = {
  Player: new (options: SpotifyPlayerOptions) => SpotifyPlayer;
};

export type SdkTimer = {
  setTimeout: (handler: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

declare global {
  interface Window {
    Spotify?: SpotifySdk;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}
