import assert from "node:assert/strict";
import test from "node:test";
import { defaultSettings, type Settings } from "./menus/model.ts";
import { loadSettings, parseSettings, saveSettings, settingsFromStorage, subscribeSettings } from "./settings.ts";

function legacy(partial: Record<string, unknown>) {
  return JSON.stringify(partial);
}

test("parseSettings returns defaults for empty and invalid payloads", () => {
  const base = defaultSettings();
  assert.deepEqual(parseSettings(null), base);
  assert.deepEqual(parseSettings(""), base);
  assert.deepEqual(parseSettings("{"), base);
  assert.deepEqual(parseSettings("null"), base);
  assert.deepEqual(parseSettings("true"), base);
  assert.deepEqual(parseSettings("[]"), base);
  assert.deepEqual(parseSettings("0"), base);
});

test("parseSettings accepts the legacy unversioned shape and version 1", () => {
  const legacyRaw = legacy({
    shuffle: "songs",
    repeat: "all",
    clicker: "off",
    backlight: "5sec",
    backlightChosen: true,
    volume: 12,
  });
  const versioned = JSON.stringify({
    v: 1,
    volume: 12,
    clicker: "off",
    repeat: "all",
    shuffle: "songs",
    backlightChosen: true,
    backlight: "5sec",
    extra: true,
  });
  const expected: Settings = {
    shuffle: "songs",
    repeat: "all",
    clicker: "off",
    backlight: "5sec",
    backlightChosen: true,
    volume: 12,
  };
  assert.deepEqual(parseSettings(legacyRaw), expected);
  assert.deepEqual(parseSettings(versioned), expected);
});

test("parseSettings rejects an unknown future version", () => {
  const base = defaultSettings();
  const future = JSON.stringify({
    v: 2,
    shuffle: "songs",
    repeat: "one",
    clicker: "off",
    backlight: "always_on",
    backlightChosen: true,
    volume: 1,
  });
  assert.deepEqual(parseSettings(future), base);
  assert.deepEqual(parseSettings(JSON.stringify({ v: "1", shuffle: "songs", volume: 3 })), base);
  assert.deepEqual(parseSettings(JSON.stringify({ v: null, volume: 3 })), base);
});

test("parseSettings keeps the per-field validation", () => {
  const base = defaultSettings();
  const parsed = parseSettings(
    legacy({
      shuffle: "albums",
      repeat: "nope",
      clicker: "loud",
      backlight: "5sec",
      backlightChosen: false,
      volume: 150.2,
    }),
  );
  assert.deepEqual(parsed, { ...base, volume: 100 });

  assert.equal(parseSettings(legacy({ volume: 0 })).volume, 0);
  assert.equal(parseSettings(legacy({ volume: -4 })).volume, 0);
  assert.equal(parseSettings(legacy({ volume: 49.4 })).volume, 49);
  assert.equal(parseSettings(legacy({ volume: "50" })).volume, 50);
  assert.equal(parseSettings(legacy({ clicker: "off" })).clicker, "off");
  assert.equal(parseSettings(legacy({ repeat: "one" })).repeat, "one");

  const chosen = parseSettings(
    legacy({ backlight: "always_on", backlightChosen: true, volume: 100 }),
  );
  assert.equal(chosen.backlight, "always_on");
  assert.equal(chosen.backlightChosen, true);
  assert.equal(chosen.volume, 100);

  const invalidBacklight = parseSettings(
    legacy({ backlight: "10sec", backlightChosen: true }),
  );
  assert.equal(invalidBacklight.backlight, base.backlight);
  assert.equal(invalidBacklight.backlightChosen, false);
});

test("settingsFromStorage skips the last value this tab wrote", () => {
  const written = parseSettings(
    JSON.stringify({ v: 1, shuffle: "songs", volume: 20, repeat: "one", clicker: "off" }),
  );
  const echo = JSON.stringify({
    clicker: "off",
    volume: 20.2,
    repeat: "one",
    shuffle: "songs",
    v: 1,
  });
  assert.equal(settingsFromStorage(echo, written), null);

  const next = settingsFromStorage(JSON.stringify({ v: 1, volume: 21, shuffle: "songs" }), written);
  assert.deepEqual(next, parseSettings(JSON.stringify({ v: 1, volume: 21, shuffle: "songs" })));
  assert.deepEqual(settingsFromStorage(null, null), defaultSettings());
  assert.equal(settingsFromStorage(JSON.stringify({ v: 9, volume: 1 }), defaultSettings()), null);
  assert.deepEqual(
    settingsFromStorage(JSON.stringify({ v: 9, volume: 1 }), written),
    defaultSettings(),
  );
});

test("subscribeSettings ignores echoes and other storage keys", () => {
  const storage = new Map<string, string>();
  const listeners = new Set<(event: StorageEvent) => void>();
  const store = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  };
  const previous = { window: globalThis.window, localStorage: globalThis.localStorage };
  globalThis.localStorage = store as unknown as Storage;
  globalThis.window = {
    matchMedia: () => ({ matches: false }),
    addEventListener: (_type: string, listener: EventListener) => {
      listeners.add(listener as (event: StorageEvent) => void);
    },
    removeEventListener: (_type: string, listener: EventListener) => {
      listeners.delete(listener as (event: StorageEvent) => void);
    },
  } as unknown as Window & typeof globalThis;

  const emit = (key: string | null, value: string | null, area: Storage | null = store as unknown as Storage) => {
    const event = { key, newValue: value, storageArea: area } as StorageEvent;
    for (const listener of Array.from(listeners)) listener(event);
  };

  try {
    storage.set("ipod-settings", JSON.stringify({ shuffle: "songs", volume: 8 }));
    assert.equal(loadSettings().shuffle, "songs");
    assert.equal(loadSettings().volume, 8);

    const seen: number[] = [];
    const stop = subscribeSettings((settings) => {
      seen.push(settings.volume);
    });
    saveSettings({ ...defaultSettings(), volume: 10 });
    const saved = JSON.parse(storage.get("ipod-settings") ?? "{}") as { v?: unknown; volume?: unknown };
    assert.equal(saved.v, 1);
    assert.equal(saved.volume, 10);

    emit("ipod-settings", storage.get("ipod-settings") ?? null);
    emit("other", JSON.stringify({ v: 1, volume: 3 }));
    emit("ipod-settings", JSON.stringify({ v: 1, volume: 33 }), {} as Storage);
    assert.deepEqual(seen, []);

    emit("ipod-settings", JSON.stringify({ v: 1, ...defaultSettings(), volume: 33 }));
    assert.deepEqual(seen, [33]);
    emit("ipod-settings", JSON.stringify({ v: 1, ...defaultSettings(), volume: 33 }));
    assert.deepEqual(seen, [33]);
    emit("ipod-settings", JSON.stringify({ v: 1, ...defaultSettings(), volume: 10 }));
    assert.deepEqual(seen, [33, 10]);

    stop();
    emit("ipod-settings", JSON.stringify({ v: 1, volume: 4 }));
    assert.deepEqual(seen, [33, 10]);
    assert.equal(listeners.size, 0);
  } finally {
    globalThis.window = previous.window;
    globalThis.localStorage = previous.localStorage;
  }
});
