import assert from "node:assert/strict";
import { afterEach, before, beforeEach, test } from "node:test";
import {
  collectPages,
  parseRetryAfter,
  retryDelayMs,
  SpotifyNetworkError,
  SpotifyRateLimitError,
  SpotifyRequestError,
  SpotifySessionError,
  spotifyJson,
  spotifySend,
} from "./api.ts";
import { getAccessToken } from "./auth.ts";
import { readTokens, writeClientId, writeTokens } from "./storage.ts";

const CLIENT_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const NOW = Date.parse("Wed, 21 Oct 2015 07:28:00 GMT");
const originalFetch = globalThis.fetch;

function installStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, String(value));
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() {
        return values.size;
      },
    },
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

before(() => {
  installStorage();
});

beforeEach(() => {
  localStorage.clear();
  writeClientId(CLIENT_ID);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("parseRetryAfter accepts delta-seconds, HTTP dates, and garbage", () => {
  assert.equal(parseRetryAfter("2"), 2_000);
  assert.equal(parseRetryAfter(" 1.5 "), 1_500);
  assert.equal(parseRetryAfter("0"), 0);
  assert.equal(parseRetryAfter("Wed, 21 Oct 2015 07:28:05 GMT", NOW), 5_000);
  assert.equal(parseRetryAfter("Wed, 21 Oct 2015 07:27:00 GMT", NOW), 0);
  assert.equal(parseRetryAfter("nope"), 1_000);
  assert.equal(parseRetryAfter(""), 1_000);
  assert.equal(parseRetryAfter(null), 1_000);
  assert.equal(retryDelayMs("120", NOW, 1), 30_000);
  assert.equal(retryDelayMs("1", NOW, 0), 1_000);
  assert.equal(retryDelayMs("1", NOW, 0.5), 1_125);
});

test("a 401 refreshes once and retries the original request", async () => {
  writeTokens({
    accessToken: "stale",
    refreshToken: "A",
    expiresAt: Date.now() + 3_600_000,
  });
  let apiCalls = 0;
  let refreshCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("accounts.spotify.com")) {
      refreshCalls += 1;
      const params = new URLSearchParams(String(init?.body ?? ""));
      assert.equal(params.get("refresh_token"), "A");
      return jsonResponse({ access_token: "fresh", refresh_token: "A2", expires_in: 3600 });
    }
    apiCalls += 1;
    const authorization = new Headers(init?.headers).get("authorization");
    if (apiCalls === 1) {
      assert.equal(authorization, "Bearer stale");
      return new Response("{}", { status: 401 });
    }
    assert.equal(authorization, "Bearer fresh");
    return jsonResponse({ id: "me" });
  };

  const me = await spotifyJson<{ id: string }>("https://api.spotify.com/v1/me", "stale");
  assert.equal(me.id, "me");
  assert.equal(apiCalls, 2);
  assert.equal(refreshCalls, 1);
  assert.equal(await getAccessToken(), "fresh");
  assert.equal(refreshCalls, 1);
});

test("a second 401 after refresh does not refresh again", async () => {
  writeTokens({
    accessToken: "stale",
    refreshToken: "A",
    expiresAt: Date.now() + 3_600_000,
  });
  let refreshCalls = 0;
  globalThis.fetch = async (input) => {
    if (String(input).includes("accounts.spotify.com")) {
      refreshCalls += 1;
      return jsonResponse({ access_token: "fresh", refresh_token: "A2", expires_in: 3600 });
    }
    return new Response("{}", { status: 401 });
  };
  await assert.rejects(
    spotifyJson("https://api.spotify.com/v1/me", "stale"),
    (reason: unknown) => reason instanceof SpotifySessionError,
  );
  assert.equal(refreshCalls, 1);
  assert.equal(readTokens()?.accessToken, "fresh");
});

test("a 429 retries with a stored token and then reports a rate limit", async () => {
  writeTokens({
    accessToken: "stored",
    refreshToken: "A",
    expiresAt: Date.now() + 3_600_000,
  });
  const seen: string[] = [];
  globalThis.fetch = async (_input, init) => {
    seen.push(new Headers(init?.headers).get("authorization") ?? "");
    return new Response(null, { status: 429, headers: { "Retry-After": "0" } });
  };
  await assert.rejects(
    spotifySend("GET", "https://api.spotify.com/v1/me", "passed"),
    (reason: unknown) => {
      assert.ok(reason instanceof SpotifyRateLimitError);
      assert.match(reason.message, /rate limiting/i);
      return true;
    },
  );
  assert.equal(seen.length, 5);
  assert.equal(seen[0], "Bearer passed");
  assert.ok(seen.slice(1).every((header) => header === "Bearer stored"));
});

test("abort stops a rate-limit retry", async () => {
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    controller.abort();
    return new Response(null, { status: 429, headers: { "Retry-After": "30" } });
  };
  await assert.rejects(
    spotifySend("GET", "https://api.spotify.com/v1/me", "token", undefined, controller.signal),
    (reason: unknown) => reason instanceof Error && reason.name === "AbortError",
  );
  assert.equal(calls, 1);
});

test("offline fetch TypeError becomes a network error", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(
    spotifySend("GET", "https://api.spotify.com/v1/me", "token"),
    (reason: unknown) => reason instanceof SpotifyNetworkError,
  );
});

test("403 PREMIUM_REQUIRED maps to the premium message", async () => {
  globalThis.fetch = async () =>
    jsonResponse(
      { error: { status: 403, message: "Player command failed", reason: "PREMIUM_REQUIRED" } },
      403,
    );
  await assert.rejects(
    spotifySend("PUT", "https://api.spotify.com/v1/me/player/play", "token", { uris: [] }),
    (reason: unknown) =>
      reason instanceof SpotifyRequestError &&
      reason.message === "Spotify Premium is required to play",
  );
});

test("collectPages stops when next repeats and ignores an empty page", async () => {
  const seen: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    seen.push(url);
    if (url.endsWith("/empty")) return new Response(null, { status: 204 });
    if (url.endsWith("/p1")) {
      return jsonResponse({ items: ["a"], next: "https://api.spotify.com/p2" });
    }
    return jsonResponse({ items: ["b"], next: "https://api.spotify.com/p1" });
  };
  const items = await collectPages("https://api.spotify.com/p1", async () => "token");
  assert.deepEqual(items, ["a", "b"]);
  assert.deepEqual(seen, ["https://api.spotify.com/p1", "https://api.spotify.com/p2"]);
  assert.deepEqual(await collectPages("https://api.spotify.com/empty", async () => "token"), []);
});
