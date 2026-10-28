import { defaultSettings, isBacklight, type Settings } from "./menus.ts";

const STORAGE_KEY = "ipod-settings";

function clampVolume(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(100, Math.max(0, Math.round(value)))
    : 50;
}

export function loadSettings(): Settings {
  const base = defaultSettings();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return base;
    const data = parsed as Partial<Settings>;
    const chosen = data.backlightChosen === true && isBacklight(data.backlight);
    return {
      shuffle: data.shuffle === "songs" ? "songs" : "off",
      repeat: data.repeat === "one" || data.repeat === "all" ? data.repeat : "off",
      clicker: data.clicker === "off" ? "off" : "on",
      backlight: chosen ? data.backlight! : base.backlight,
      backlightChosen: chosen,
      volume: clampVolume(data.volume),
    };
  } catch {
    return base;
  }
}

export function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing can reject storage. The device still works for the session.
  }
}
