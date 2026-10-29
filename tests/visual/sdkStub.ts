import type { Page, Route } from "@playwright/test";

const SPOTIFY = /https?:\/\/([^/?#]+\.)?(spotify\.com|scdn\.co)(?::\d+)?(?:[/?#]|$)/;
const DEVICE_ID = "visual-gate-device";

// A Web Playback SDK stand-in: it connects, reports a device, and answers every play command with one
// playing state at 0:00 for the requested URI (time and progress are masked). Every app version settles on the same screen
// instead of racing a connect timeout or a running clock.
const SDK_STUB = `
(() => {
  class Player {
    constructor() { this.listeners = {}; window.__visualGatePlayer = this; }
    addListener(event, callback) { this.listeners[event] = callback; return true; }
    removeListener(event) { delete this.listeners[event]; return true; }
    connect() {
      setTimeout(() => this.listeners.ready?.({ device_id: ${JSON.stringify(DEVICE_ID)} }), 0);
      return Promise.resolve(true);
    }
    disconnect() {}
    activateElement() { return Promise.resolve(); }
    getCurrentState() { return Promise.resolve(null); }
    setVolume() { return Promise.resolve(); }
    getVolume() { return Promise.resolve(1); }
    pause() { return Promise.resolve(); }
    resume() { return Promise.resolve(); }
    togglePlay() { return Promise.resolve(); }
    seek() { return Promise.resolve(); }
    previousTrack() { return Promise.resolve(); }
    nextTrack() { return Promise.resolve(); }
  }
  window.Spotify = { Player };
  window.onSpotifyWebPlaybackSDKReady?.();
})();
`;

const DEVICES = {
  devices: [
    {
      id: DEVICE_ID,
      name: "iPod",
      type: "Computer",
      is_active: true,
      is_restricted: false,
      volume_percent: 100,
    },
  ],
};

const STATE_DURATION_MS = 200_000;

function requestedUri(body: string | null) {
  try {
    const parsed = JSON.parse(body ?? "{}") as { uris?: string[]; offset?: { position?: number } };
    return parsed.uris?.[parsed.offset?.position ?? 0] ?? null;
  } catch {
    return null;
  }
}

async function emitPlayingState(page: Page, uri: string) {
  await page.evaluate(
    ({ uri, duration }) => {
      const player = (window as unknown as { __visualGatePlayer?: { listeners: Record<string, (state: unknown) => void> } })
        .__visualGatePlayer;
      const track = { uri, id: uri.split(":").pop(), name: "", duration_ms: duration, artists: [], album: { name: "", images: [] } };
      player?.listeners.player_state_changed?.({
        paused: false,
        position: 0,
        duration,
        timestamp: Date.now(),
        shuffle: false,
        repeat_mode: 0,
        track_window: { current_track: track, previous_tracks: [], next_tracks: [] },
      });
    },
    { uri, duration: STATE_DURATION_MS },
  );
}

async function handle(page: Page, route: Route) {
  const request = route.request();
  const url = new URL(request.url());
  if (url.hostname === "sdk.scdn.co" && url.pathname === "/spotify-player.js") {
    return route.fulfill({ status: 200, contentType: "text/javascript", body: SDK_STUB });
  }
  if (url.hostname === "api.spotify.com" && url.pathname.startsWith("/v1/me/player")) {
    if (request.method() === "GET" && url.pathname === "/v1/me/player/devices") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DEVICES) });
    }
    if (request.method() === "PUT" && url.pathname === "/v1/me/player/play") {
      await route.fulfill({ status: 204, body: "" });
      const uri = requestedUri(request.postData());
      if (uri) await emitPlayingState(page, uri).catch(() => {});
      return;
    }
    return route.fulfill({ status: 204, body: "" });
  }
  return route.abort();
}

export async function stubSpotify(page: Page) {
  await page.route(SPOTIFY, (route) => handle(page, route));
}
