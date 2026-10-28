import { SpotifySessionError } from "./api.ts";
import { codeChallenge, randomString, SPOTIFY_SCOPES } from "./pkce.ts";
import { spotifyRedirectUri } from "./redirect.ts";
import {
  clearAuthTransaction,
  clearSession,
  readClientId,
  readTokens,
  readVerifier,
  readAuthState,
  signalAuth,
  writeAuthState,
  writeTokens,
  writeVerifier,
  type StoredTokens,
} from "./storage.ts";

const TOKEN_URL = "https://accounts.spotify.com/api/token";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

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
  writeTokens(tokens);
  return tokens;
}

async function postToken(body: URLSearchParams) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await response.json()) as TokenResponse;
  if (!response.ok) {
    if (payload.error === "invalid_grant") {
      clearSession();
      throw new SpotifySessionError("Spotify session expired. Connect again.");
    }
    throw new SpotifySessionError(
      payload.error_description || payload.error || "Spotify sign-in failed",
    );
  }
  return payload;
}

let refreshing: Promise<string> | null = null;

export function getAccessToken(force = false) {
  const clientId = readClientId();
  const tokens = readTokens();
  if (!clientId || !tokens)
    return Promise.reject(new SpotifySessionError("Connect Spotify to play"));
  if (!force && tokens.expiresAt > Date.now() + 30_000) return Promise.resolve(tokens.accessToken);
  refreshing ??= postToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      client_id: clientId,
    }),
  )
    .then((payload) => storeTokenResponse(payload, tokens.refreshToken).accessToken)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function exchangeCode(code: string) {
  const clientId = readClientId();
  const verifier = readVerifier();
  if (!clientId || !verifier)
    throw new SpotifySessionError("Spotify sign-in expired. Try Connect again.");
  const payload = await postToken(
    new URLSearchParams({
      client_id: clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: spotifyRedirectUri(),
      code_verifier: verifier,
    }),
  );
  clearAuthTransaction();
  storeTokenResponse(payload, "");
}

export async function beginLogin() {
  const clientId = readClientId();
  if (!clientId) throw new SpotifySessionError("Paste your Client ID first");
  const verifier = randomString(64);
  const state = randomString(24);
  writeVerifier(verifier);
  writeAuthState(state);
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
  const url = `https://accounts.spotify.com/authorize?${params.toString()}`;
  const popup = window.open(url, "ipod-spotify", "width=480,height=720");
  if (!popup) {
    window.location.assign(url);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const finish = (error?: string) => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("storage", onStorage);
      window.clearInterval(timer);
      if (readTokens()) resolve();
      else reject(new SpotifySessionError(error || "Spotify sign-in was cancelled"));
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; ok?: boolean; error?: string } | null;
      if (data?.type !== "ipod-spotify-auth") return;
      finish(data.ok ? undefined : data.error || "Spotify sign-in failed");
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === "ipod.spotify.authSignal") finish();
    };
    const timer = window.setInterval(() => {
      if (popup.closed) finish();
    }, 400);
    window.addEventListener("message", onMessage);
    window.addEventListener("storage", onStorage);
  });
}

export function expectedAuthState() {
  return readAuthState();
}

export function publishAuthResult(ok: boolean, error?: string) {
  signalAuth(ok, error);
  const payload = { type: "ipod-spotify-auth", ok, error: error ?? null };
  window.opener?.postMessage(payload, window.location.origin);
}
