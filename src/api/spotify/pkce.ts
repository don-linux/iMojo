const VERIFIER_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const VERIFIER_LIMIT = 256 - (256 % VERIFIER_ALPHABET.length);
const SECURE_PAGE = "Spotify sign-in needs a secure page (https or localhost).";

export const SPOTIFY_SCOPES = [
  "user-read-private",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-library-read",
  "user-follow-read",
  "streaming",
  "user-modify-playback-state",
  "user-read-playback-state",
].join(" ");

export function randomString(length: number) {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.getRandomValues) throw new Error(SECURE_PAGE);
  let text = "";
  const bytes = new Uint8Array(Math.max(length, 1));
  while (text.length < length) {
    cryptoObj.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= VERIFIER_LIMIT) continue;
      text += VERIFIER_ALPHABET[byte % VERIFIER_ALPHABET.length];
      if (text.length === length) break;
    }
  }
  return text;
}

export async function codeChallenge(verifier: string) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle?.digest) throw new Error(SECURE_PAGE);
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
