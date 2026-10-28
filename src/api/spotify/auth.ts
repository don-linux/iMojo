import { bindAccessTokenRefresh, SpotifyNetworkError, SpotifySessionError } from "./api.ts";
import { codeChallenge, randomString, SPOTIFY_SCOPES } from "./pkce.ts";
import { spotifyRedirectUri } from "./redirect.ts";
import {
  AUTH_SIGNAL_KEY,
  clearAuthTransaction,
  clearSession,
  isSpotifyClientId,
  parseAuthSignal,
  readAuthSignal,
  readAuthState,
  readClientId,
  readTokens,
  readVerifier,
  signalAuth,
  writeAuthState,
  writeTokens,
  writeVerifier,
  type StoredTokens,
} from "./storage.ts";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const REFRESH_LOCK = "ipod.spotify.refresh";
const STORAGE_BLOCKED = "This browser is blocking site storage";
const SECURE_PAGE = "Spotify sign-in needs a secure page (https or localhost).";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type AuthPayload = { type?: string; ok?: boolean; error?: string | null; state?: string | null };

function storeTokenResponse(response: TokenResponse, previousRefresh: string) {
  if (!response.access_token) {
    throw new SpotifySessionError(
      response.error_description || response.error || "Spotify sign-in failed",
    );
  }
  const tokens: StoredTokens = {
    accessToken: response.access_token,
    refreshToken: response.refresh_token || previousRefresh,
    expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
  };
  if (!writeTokens(tokens)) throw new SpotifySessionError(STORAGE_BLOCKED);
  return tokens;
}

async function requestToken(body: URLSearchParams): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (reason) {
    if (reason instanceof TypeError) throw new SpotifyNetworkError();
    throw reason;
  }
  let payload: TokenResponse = {};
  try {
    payload = (await response.json()) as TokenResponse;
  } catch {
    payload = {};
  }
  if (!response.ok && payload.error !== "invalid_grant") {
    throw new SpotifySessionError(
      payload.error_description || payload.error || "Spotify sign-in failed",
    );
  }
  return payload;
}

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) return task();
  return locks.request(REFRESH_LOCK, task);
}

async function redeem(clientId: string, refreshToken: string, allowRetry: boolean): Promise<string> {
  const payload = await requestToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }),
  );
  if (payload.error === "invalid_grant") {
    const stored = readTokens();
    if (allowRetry && stored && stored.refreshToken !== refreshToken) {
      return redeem(clientId, stored.refreshToken, false);
    }
    const latest = readTokens();
    if (!latest || latest.refreshToken === refreshToken) clearSession();
    throw new SpotifySessionError("Spotify session expired. Connect again.");
  }
  return storeTokenResponse(payload, refreshToken).accessToken;
}

async function refreshNow(force: boolean, seenAccess: string) {
  const clientId = readClientId();
  const tokens = readTokens();
  if (!clientId || !tokens) throw new SpotifySessionError("Connect Spotify to play");
  const fresh = tokens.expiresAt > Date.now() + 30_000;
  const rotated = tokens.accessToken !== seenAccess;
  if (fresh && (!force || rotated)) return tokens.accessToken;
  return redeem(clientId, tokens.refreshToken, true);
}

let refreshing: Promise<string> | null = null;

export function getAccessToken(options?: { force?: boolean }) {
  if (refreshing) return refreshing;
  const clientId = readClientId();
  const tokens = readTokens();
  if (!clientId || !tokens) return Promise.reject(new SpotifySessionError("Connect Spotify to play"));
  if (!options?.force && tokens.expiresAt > Date.now() + 30_000) {
    return Promise.resolve(tokens.accessToken);
  }
  const force = options?.force === true;
  const seen = tokens.accessToken;
  const flight = withLock(() => refreshNow(force, seen)).finally(() => {
    if (refreshing === flight) refreshing = null;
  });
  refreshing = flight;
  return flight;
}

bindAccessTokenRefresh((options) => getAccessToken(options));

export async function exchangeCode(code: string) {
  const clientId = readClientId();
  const verifier = readVerifier();
  if (!clientId || !verifier) {
    throw new SpotifySessionError("Spotify sign-in expired. Try Connect again.");
  }
  const before = readTokens();
  const payload = await requestToken(
    new URLSearchParams({
      client_id: clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: spotifyRedirectUri(),
      code_verifier: verifier,
    }),
  );
  if (payload.error === "invalid_grant") {
    const after = readTokens();
    const replaced = Boolean(
      after &&
        (!before ||
          after.accessToken !== before.accessToken ||
          after.refreshToken !== before.refreshToken),
    );
    if (replaced) {
      clearAuthTransaction();
      return;
    }
    throw new SpotifySessionError(
      payload.error_description || "Spotify session expired. Connect again.",
    );
  }
  storeTokenResponse(payload, "");
  clearAuthTransaction();
}

let pendingLogin: Promise<void> | null = null;

export function beginLogin() {
  if (pendingLogin) return pendingLogin;
  const flight = startLogin().finally(() => {
    if (pendingLogin === flight) pendingLogin = null;
  });
  pendingLogin = flight;
  return flight;
}

async function startLogin() {
  const clientId = readClientId();
  if (!clientId) throw new SpotifySessionError("Paste your Client ID first");
  if (!isSpotifyClientId(clientId)) {
    throw new SpotifySessionError("Client ID must be 32 hex characters");
  }
  if (!globalThis.crypto?.getRandomValues || !globalThis.crypto.subtle?.digest) {
    throw new SpotifySessionError(SECURE_PAGE);
  }
  const verifier = randomString(64);
  const state = randomString(24);
  if (!writeVerifier(verifier) || !writeAuthState(state)) {
    throw new SpotifySessionError(STORAGE_BLOCKED);
  }
  const challenge = await codeChallenge(verifier);
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: spotifyRedirectUri(),
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
    scope: SPOTIFY_SCOPES,
  });
  const popup = window.open(
    `https://accounts.spotify.com/authorize?${params.toString()}`,
    "ipod-spotify",
    "width=480,height=720",
  );
  if (!popup) {
    window.location.assign(`https://accounts.spotify.com/authorize?${params.toString()}`);
    return;
  }
  await waitForLogin(state, popup);
}

function waitForLogin(state: string, popup: Window) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      settled = true;
      window.removeEventListener("message", onMessage);
      window.removeEventListener("storage", onStorage);
      window.clearInterval(timer);
    };
    const succeed = () => {
      if (settled) return;
      cleanup();
      resolve();
    };
    const fail = (message: string) => {
      if (settled) return;
      cleanup();
      reject(new SpotifySessionError(message));
    };
    const accept = (
      ok: boolean | undefined,
      error: string | null | undefined,
      nonce: string | null | undefined,
    ) => {
      if (nonce !== state) return;
      if (ok) succeed();
      else fail(error || "Spotify sign-in failed");
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as AuthPayload | null;
      if (!data || data.type !== "ipod-spotify-auth") return;
      accept(data.ok, data.error, data.state);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== AUTH_SIGNAL_KEY) return;
      const data = parseAuthSignal(event.newValue);
      if (!data) return;
      accept(data.ok, data.error, data.state);
    };
    const timer = window.setInterval(() => {
      let closed = false;
      try {
        closed = popup.closed;
      } catch {
        return;
      }
      if (!closed) return;
      const data = readAuthSignal();
      if (data?.state === state) accept(data.ok, data.error, data.state);
      else fail("Spotify sign-in was cancelled");
    }, 400);
    window.addEventListener("message", onMessage);
    window.addEventListener("storage", onStorage);
  });
}

export function expectedAuthState() {
  return readAuthState();
}

export function publishAuthResult(ok: boolean, error?: string, state?: string) {
  signalAuth(ok, error, state);
  window.opener?.postMessage(
    { type: "ipod-spotify-auth", ok, error: error ?? null, state: state ?? null },
    window.location.origin,
  );
}
