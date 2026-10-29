import { defaultSettings, isBacklight, type Settings } from "./menus/model.ts";

const STORAGE_KEY = "ipod-settings";
const SETTINGS_VERSION = 1;

const listeners = new Set<(settings: Settings) => void>();
let lastWritten: Settings | null = null;

function clampVolume(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(100, Math.max(0, Math.round(value)))
    : 50;
}

function sameSettings(a: Settings, b: Settings) {
  return (
    a.shuffle === b.shuffle &&
    a.repeat === b.repeat &&
    a.clicker === b.clicker &&
    a.backlight === b.backlight &&
    a.backlightChosen === b.backlightChosen &&
    a.volume === b.volume
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Missing `v` is the legacy unversioned blob. Any other version is a future schema.
function acceptsVersion(data: Record<string, unknown>) {
  if (!Object.hasOwn(data, "v")) return true;
  return data.v === SETTINGS_VERSION;
}

export function parseSettings(raw: string | null): Settings {
  const base = defaultSettings();
  if (raw == null) return base;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !acceptsVersion(parsed)) return base;
    let backlight = base.backlight;
    let backlightChosen = false;
    if (parsed.backlightChosen === true && isBacklight(parsed.backlight)) {
      backlight = parsed.backlight;
      backlightChosen = true;
    }
    return {
      shuffle: parsed.shuffle === "songs" ? "songs" : "off",
      repeat: parsed.repeat === "one" || parsed.repeat === "all" ? parsed.repeat : "off",
      clicker: parsed.clicker === "off" ? "off" : "on",
      backlight,
      backlightChosen,
      volume: clampVolume(parsed.volume),
    };
  } catch {
    return base;
  }
}

/** Parsed storage value, or null when it matches the last value this tab wrote. */
export function settingsFromStorage(raw: string | null, written: Settings | null): Settings | null {
  const next = parseSettings(raw);
  if (written && sameSettings(next, written)) return null;
  return next;
}

export function loadSettings(): Settings {
  try {
    return parseSettings(localStorage.getItem(STORAGE_KEY));
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings: Settings) {
  const raw = JSON.stringify({ v: SETTINGS_VERSION, ...settings });
  try {
    localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // Private browsing can reject storage. The device still works for the session.
    return;
  }
  lastWritten = parseSettings(raw);
}

function onStorage(event: StorageEvent) {
  if (event.key !== STORAGE_KEY) return;
  if (event.storageArea != null && event.storageArea !== localStorage) return;
  const next = settingsFromStorage(event.newValue, lastWritten);
  if (!next) return;
  // Adopt the external value so a later edit back to an older write still notifies.
  lastWritten = next;
  for (const listener of Array.from(listeners)) listener(next);
}

export function subscribeSettings(onChange: (settings: Settings) => void): () => void {
  listeners.add(onChange);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}
