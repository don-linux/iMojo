import type { MusicLibrary } from "../types.ts";

const CLIENT_ID_KEY = "ipod.spotify.clientId";
const TOKENS_KEY = "ipod.spotify.tokens";
const PROFILE_KEY = "ipod.spotify.profile";
const VERIFIER_KEY = "ipod.spotify.verifier";
const STATE_KEY = "ipod.spotify.state";
const LIBRARY_KEY = "ipod.spotify.library";
export const AUTH_SIGNAL_KEY = "ipod.spotify.authSignal";

export type StoredTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export type StoredProfile = {
  id: string;
  name: string;
  product: string;
};

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function readClientId() {
  return localStorage.getItem(CLIENT_ID_KEY)?.trim() || "";
}

export function writeClientId(clientId: string) {
  const next = clientId.trim();
  const current = readClientId();
  if (current && current !== next) clearSession();
  localStorage.setItem(CLIENT_ID_KEY, next);
}

export function readTokens(): StoredTokens | null {
  const tokens = readJson<StoredTokens>(TOKENS_KEY);
  if (!tokens?.accessToken || !tokens.refreshToken) return null;
  return tokens;
}

export function writeTokens(tokens: StoredTokens) {
  localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
}

export function readProfile(): StoredProfile | null {
  const profile = readJson<StoredProfile>(PROFILE_KEY);
  if (!profile?.id) return null;
  return profile;
}

export function writeProfile(profile: StoredProfile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function readVerifier() {
  return localStorage.getItem(VERIFIER_KEY) ?? "";
}

export function writeVerifier(verifier: string) {
  localStorage.setItem(VERIFIER_KEY, verifier);
}

export function readAuthState() {
  return localStorage.getItem(STATE_KEY) ?? "";
}

export function writeAuthState(state: string) {
  localStorage.setItem(STATE_KEY, state);
}

export function clearAuthTransaction() {
  localStorage.removeItem(VERIFIER_KEY);
  localStorage.removeItem(STATE_KEY);
}

export function readCachedLibrary(): MusicLibrary | null {
  const library = readJson<MusicLibrary>(LIBRARY_KEY);
  if (!library || library.provider !== "spotify" || !library.tracks) return null;
  return library;
}

export function writeCachedLibrary(library: MusicLibrary) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
  } catch {
    localStorage.removeItem(LIBRARY_KEY);
  }
}

export function signalAuth(ok: boolean, error?: string) {
  localStorage.setItem(
    AUTH_SIGNAL_KEY,
    JSON.stringify({ ok, error: error ?? null, at: Date.now() }),
  );
}

export function clearSession() {
  localStorage.removeItem(TOKENS_KEY);
  localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem(LIBRARY_KEY);
  localStorage.removeItem(AUTH_SIGNAL_KEY);
  clearAuthTransaction();
}

export function disconnectSpotify() {
  clearSession();
  localStorage.removeItem(CLIENT_ID_KEY);
}
