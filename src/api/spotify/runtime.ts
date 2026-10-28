import type { DevicePlaybackState } from "../player/types.ts";
import type { PlayerSession } from "../player/session.ts";
import { SpotifySdkPlayer } from "./sdkPlayer.ts";
import { PLAYER_NAME } from "./sdkTypes.ts";
import { asDeviceState } from "./stateFollow.ts";
import { spotifyPlaybackSupport } from "./support.ts";
import { SpotifyTransport } from "./transport.ts";

type SpotifySink = {
  ingest: (state: DevicePlaybackState | null) => void;
  reportSdkError: (kind: string, message: string) => void;
  suspend: () => void;
  getVolume: () => number;
};

let player: SpotifySdkPlayer | null = null;
let sink: SpotifySink | null = null;
let token = 0;

function livePlayer() {
  if (player && !player.disposed) return player;
  const sdk = new SpotifySdkPlayer({ name: PLAYER_NAME, volume: sink?.getVolume() ?? 1 });
  sdk.on("state", (state) => {
    sink?.ingest(asDeviceState(state));
  });
  sdk.on("error", (error) => {
    sink?.reportSdkError(error.kind, error.message);
  });
  player = sdk;
  return sdk;
}

export function bindSpotifySession(session: PlayerSession) {
  sink = {
    ingest: (state) => session.ingest(state),
    reportSdkError: (kind, message) => session.reportSdkError(kind, message),
    suspend: () => session.suspend(),
    getVolume: () => session.getVolume(),
  };
}

export function primeSpotifyPlayback() {
  livePlayer().activate();
}

export function warmSpotifyPlayer() {
  const sdk = livePlayer();
  sdk.preload();
  void sdk.whenReady().catch(() => {});
}

function dropPlayer() {
  sink?.suspend();
  player?.dispose();
  player = null;
  spotifyTransport.releaseDevice();
}

export function disposeSpotifyPlayer() {
  // Do not bump `token`: the mounted engine must still dispose a player created after this.
  dropPlayer();
}

export const spotifyTransport = new SpotifyTransport(() => livePlayer());

export class SpotifySdkEngine {
  private readonly token: number;

  constructor() {
    this.token = ++token;
    if (!spotifyPlaybackSupport().ok) return;
    livePlayer().preload();
  }

  destroy() {
    const mine = this.token;
    queueMicrotask(() => {
      if (mine !== token) return;
      dropPlayer();
    });
  }
}
