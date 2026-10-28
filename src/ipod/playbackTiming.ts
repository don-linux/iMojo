export const VOLUME_DEGREES_PER_PERCENT = 4.5;
export const VOLUME_DEGREES_PER_CLICK = 20.4545454545;
export const SEEK_DEGREES_PER_STEP = 15;
export const SEEK_COMMIT_MS = 1000;
export const NOW_PLAYING_IDLE_MS = 5000;
export const SEEK_STEP_SECONDS = 1;
export const VOLUME_KEY_STEP = 5;

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");
const PERCENT_FORMAT = new Intl.NumberFormat("en-US", { style: "percent" });

export function formatNumber(value: number) {
  return NUMBER_FORMAT.format(value);
}

export function formatPercent(value: number) {
  return PERCENT_FORMAT.format(value);
}

export function formatClock(value: number) {
  const total = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const seconds = total % 60;
  const secondText = String(seconds).padStart(2, "0");
  if (total < 3600) return `${Math.floor(total / 60)}:${secondText}`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${secondText}`;
}

export function formatRemaining(displayTime: number, duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) return "";
  return `-${formatClock(Math.ceil(duration - displayTime))}`;
}

const DURATION_UNITS = {
  hour: new Intl.NumberFormat("en-US", {
    style: "unit",
    unit: "hour",
    unitDisplay: "long",
  }),
  minute: new Intl.NumberFormat("en-US", {
    style: "unit",
    unit: "minute",
    unitDisplay: "long",
  }),
  second: new Intl.NumberFormat("en-US", {
    style: "unit",
    unit: "second",
    unitDisplay: "long",
  }),
} as const;

const DURATION_LIST = new Intl.ListFormat("en-US", {
  style: "long",
  type: "conjunction",
});

export function formatDurationWords(value: number) {
  const total = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = total % 60;
  const parts = (
    [
      [hours, "hour"],
      [minutes, "minute"],
      [seconds, "second"],
    ] as const
  )
    .filter(([amount]) => amount > 0)
    .map(([amount, unit]) => DURATION_UNITS[unit].format(amount));
  return parts.length > 0 ? DURATION_LIST.format(parts) : DURATION_UNITS.second.format(0);
}
