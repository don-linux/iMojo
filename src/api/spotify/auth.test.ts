import assert from "node:assert/strict";
import { afterEach, before, beforeEach, test } from "node:test";
import { SpotifySessionError } from "./api.ts";
import { getAccessToken } from "./auth.ts";
import { readTokens, writeClientId, writeTokens, type StoredTokens } from "./storage.ts";

const CLIENT_ID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
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

function seed(refreshToken: string, accessToken = "access", expiresAt = Date.now() - 5_000) {
  writeClientId(CLIENT_ID);
  writeTokens({ accessToken, refreshToken, expiresAt });
}

function store(refreshToken: string, accessToken = refreshToken): StoredTokens {
  return { accessToken, refreshToken, expiresAt: Date.now() + 3_600_000 };
}

before(() => {
  installStorage();
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Reflect.deleteProperty(globalThis, "navigator");
});

test("concurrent getAccessToken calls share one refresh", async () => {
  seed("A");
  let calls = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = async () => {
    calls += 1;
    await gate;
    return jsonResponse({ access_token: "new", refresh_token: "A2", expires_in: 3600 });
  };
  const first = getAccessToken();
  const second = getAccessToken();
  assert.equal(calls, 1);
  release();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(left, "new");
  assert.equal(right, "new");
  assert.equal(calls, 1);
});

test("refresh takes the browser lock when navigator.locks exists", async () => {
  seed("A");
  const names: string[] = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      locks: {
        request: async (name: string, task: () => Promise<unknown>) => {
          names.push(name);
          return task();
        },
      },
    },
  });
  globalThis.fetch = async () =>
    jsonResponse({ access_token: "locked", refresh_token: "A2", expires_in: 3600 });
  assert.equal(await getAccessToken(), "locked");
  assert.deepEqual(names, ["ipod.spotify.refresh"]);
});

test("invalid_grant retries a newer refresh token and does not clear it", async () => {
  seed("A", "old");
  const seen: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const refreshToken = new URLSearchParams(String(init?.body ?? "")).get("refresh_token");
    seen.push(refreshToken ?? "");
    if (refreshToken === "A") {
      writeTokens(store("B", "from-other-tab"));
      return jsonResponse({ error: "invalid_grant" }, 400);
    }
    assert.equal(refreshToken, "B");
    return jsonResponse({ access_token: "fresh", refresh_token: "B2", expires_in: 3600 });
  };
  assert.equal(await getAccessToken({ force: true }), "fresh");
  assert.deepEqual(seen, ["A", "B"]);
  assert.equal(readTokens()?.refreshToken, "B2");
});

test("invalid_grant keeps a refresh token stored while the retry is in flight", async () => {
  seed("A", "old");
  globalThis.fetch = async (_input, init) => {
    const refreshToken = new URLSearchParams(String(init?.body ?? "")).get("refresh_token");
    if (refreshToken === "A") {
      writeTokens(store("B", "from-other-tab"));
      return jsonResponse({ error: "invalid_grant" }, 400);
    }
    writeTokens(store("C", "newer-still"));
    return jsonResponse({ error: "invalid_grant", error_description: "revoked" }, 400);
  };
  await assert.rejects(
    getAccessToken({ force: true }),
    (reason: unknown) => reason instanceof SpotifySessionError,
  );
  assert.equal(readTokens()?.refreshToken, "C");
});

test("invalid_grant clears the session when the failed refresh token is still stored", async () => {
  seed("A", "old");
  globalThis.fetch = async () => jsonResponse({ error: "invalid_grant" }, 400);
  await assert.rejects(getAccessToken({ force: true }), SpotifySessionError);
  assert.equal(readTokens(), null);
});
