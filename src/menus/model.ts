export const SHUFFLE = ["off", "songs"] as const;
export const REPEAT = ["off", "one", "all"] as const;
export const CLICKER = ["off", "on"] as const;

export const BACKLIGHTS = [
  { id: "off", title: "Off", ms: null },
  { id: "1sec", title: "1 second", ms: 1000 },
  { id: "2sec", title: "2 seconds", ms: 2000 },
  { id: "3sec", title: "3 seconds", ms: 3000 },
  { id: "5sec", title: "5 seconds", ms: 5000 },
  { id: "always_on", title: "Always On", ms: null },
] as const;

export type Shuffle = (typeof SHUFFLE)[number];
export type Repeat = (typeof REPEAT)[number];
export type Clicker = (typeof CLICKER)[number];
export type BacklightMode = (typeof BACKLIGHTS)[number]["id"];

export type Settings = {
  shuffle: Shuffle;
  repeat: Repeat;
  clicker: Clicker;
  backlight: BacklightMode;
  backlightChosen: boolean;
  volume: number;
};

export const SHUFFLE_LABEL: Record<Shuffle, string> = { off: "Off", songs: "Songs" };
export const REPEAT_LABEL: Record<Repeat, string> = { off: "Off", one: "One", all: "All" };
export const CLICKER_LABEL: Record<Clicker, string> = { off: "Off", on: "On" };

export function defaultSettings(): Settings {
  const dark =
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return {
    shuffle: "off",
    repeat: "off",
    clicker: "on",
    backlight: dark ? "always_on" : "off",
    backlightChosen: false,
    volume: 50,
  };
}

export function isBacklight(value: unknown): value is BacklightMode {
  return BACKLIGHTS.some((entry) => entry.id === value);
}

export function nextValue<T extends string>(order: readonly T[], current: T): T {
  const index = order.indexOf(current);
  return order[(index + 1) % order.length] ?? order[0];
}

export function cycleSetting(settings: Settings, id: string): Settings {
  if (id === "shuffle") return { ...settings, shuffle: nextValue(SHUFFLE, settings.shuffle) };
  if (id === "repeat") return { ...settings, repeat: nextValue(REPEAT, settings.repeat) };
  if (id === "clicker") return { ...settings, clicker: nextValue(CLICKER, settings.clicker) };
  return settings;
}
