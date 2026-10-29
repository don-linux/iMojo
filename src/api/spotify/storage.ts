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

export type AuthSignal = {
  ok: boolean;
  error: string | null;
  state: string | null;
  at: number;
};

const CLIENT_ID_PATTERN = /^[0-9a-f]{32}$/i;

function readRaw(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeRaw(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Safari private mode and disabled storage throw on remove as well as set.
  }
}

function readJson<T>(key: string): T | null {
  const raw = readRaw(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function isSpotifyClientId(value: string) {
  return CLIENT_ID_PATTERN.test(value.trim());
}

export function readClientId() {
  return readRaw(CLIENT_ID_KEY)?.trim() || "";
}

export function writeClientId(clientId: string) {
  const next = clientId.trim();
  const current = readClientId();
  if (!writeRaw(CLIENT_ID_KEY, next)) return false;
  if (current && current !== next) clearSession();
  return true;
}

export function readTokens(): StoredTokens | null {
  const tokens = readJson<StoredTokens>(TOKENS_KEY);
  if (!tokens?.accessToken || !tokens.refreshToken) return null;
  return tokens;
}

export function writeTokens(tokens: StoredTokens) {
  return writeRaw(TOKENS_KEY, JSON.stringify(tokens));
}

export function readProfile(): StoredProfile | null {
  const profile = readJson<StoredProfile>(PROFILE_KEY);
  if (!profile?.id) return null;
  return profile;
}

export function writeProfile(profile: StoredProfile) {
  return writeRaw(PROFILE_KEY, JSON.stringify(profile));
}

export function readVerifier() {
  return readRaw(VERIFIER_KEY) ?? "";
}

export function writeVerifier(verifier: string) {
  return writeRaw(VERIFIER_KEY, verifier);
}

export function readAuthState() {
  return readRaw(STATE_KEY) ?? "";
}

export function writeAuthState(state: string) {
  return writeRaw(STATE_KEY, state);
}

export function clearAuthTransaction() {
  removeRaw(VERIFIER_KEY);
  removeRaw(STATE_KEY);
}

export function readCachedLibrary(): MusicLibrary | null {
  const library = readJson<MusicLibrary>(LIBRARY_KEY);
  if (!library || library.provider !== "spotify" || !library.tracks) return null;
  return library;
}

export function writeCachedLibrary(library: MusicLibrary) {
  try {
    if (writeRaw(LIBRARY_KEY, JSON.stringify(library))) return true;
  } catch {
    // Keep the false return below for a payload that cannot be serialized.
  }
  removeRaw(LIBRARY_KEY);
  return false;
}

export function parseAuthSignal(raw: string | null): AuthSignal | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<AuthSignal>;
    if (typeof data.ok !== "boolean") return null;
    return {
      ok: data.ok,
      error: data.error ?? null,
      state: data.state ?? null,
      at: typeof data.at === "number" ? data.at : 0,
    };
  } catch {
    return null;
  }
}

export function readAuthSignal() {
  return parseAuthSignal(readRaw(AUTH_SIGNAL_KEY));
}

export function signalAuth(ok: boolean, error?: string, state?: string) {
  return writeRaw(
    AUTH_SIGNAL_KEY,
    JSON.stringify({ ok, error: error ?? null, state: state ?? null, at: Date.now() }),
  );
}

export function clearSession() {
  removeRaw(TOKENS_KEY);
  removeRaw(PROFILE_KEY);
  removeRaw(LIBRARY_KEY);
  removeRaw(AUTH_SIGNAL_KEY);
  clearAuthTransaction();
}

export function disconnectSpotify() {
  clearSession();
  removeRaw(CLIENT_ID_KEY);
}
