import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { loadSettings, saveSettings } from "../settings.ts";
import { BACKLIGHTS, type Settings } from "../menus.ts";
import { unlockClick } from "../click.ts";

export function useSavedSettings(settings: Settings, settingsRef: RefObject<Settings>) {
  useEffect(() => {
    const timer = window.setTimeout(() => saveSettings(settings), 200);
    return () => window.clearTimeout(timer);
  }, [settings]);

  useEffect(() => () => saveSettings(settingsRef.current), [settingsRef]);
}

export function useBacklight(
  settings: Settings,
  setSettings: Dispatch<SetStateAction<Settings>>,
  settingsRef: RefObject<Settings>,
) {
  const [lit, setLit] = useState(() => loadSettings().backlight === "always_on");
  const litRef = useRef(lit);
  const latchRef = useRef(false);
  const wasLitRef = useRef(false);
  const firstBacklightRef = useRef(true);
  const lightTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(lightTimer.current), []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (settingsRef.current.backlightChosen) return;
      setSettings((current) => ({
        ...current,
        backlight: media.matches ? "always_on" : "off",
      }));
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [setSettings]);

  useEffect(() => {
    latchRef.current = false;
    wasLitRef.current = false;
    if (firstBacklightRef.current) {
      firstBacklightRef.current = false;
      if (settings.backlight === "always_on") setLitState(true);
      else if (settings.backlight === "off") setLitState(false);
      return;
    }
    applyBacklight(settings.backlight);
  }, [settings.backlight, settings.backlightChosen]);

  function setLitState(value: boolean) {
    litRef.current = value;
    setLit(value);
  }

  function applyBacklight(mode: Settings["backlight"]) {
    window.clearTimeout(lightTimer.current);
    if (mode === "always_on") {
      setLitState(true);
      return;
    }
    if (mode === "off") {
      setLitState(false);
      return;
    }
    const ms = BACKLIGHTS.find((entry) => entry.id === mode)?.ms;
    setLitState(true);
    if (ms) lightTimer.current = window.setTimeout(() => setLitState(false), ms);
  }

  function notify() {
    if (latchRef.current) return;
    if (wasLitRef.current) {
      wasLitRef.current = false;
      if (settingsRef.current.backlight === "always_on") {
        setLitState(true);
        return;
      }
    }
    applyBacklight(settingsRef.current.backlight);
  }

  function toggleBacklight() {
    const next = !litRef.current;
    latchRef.current = next;
    wasLitRef.current = litRef.current;
    setLitState(next);
  }

  function pressOnly() {
    notify();
    unlockClick();
  }

  return { lit, notify, toggleBacklight, pressOnly };
}
