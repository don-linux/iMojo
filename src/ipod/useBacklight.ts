import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore, type Dispatch, type RefObject, type SetStateAction } from "react";
import { unlockClick } from "../audio/clickPlayer.ts";
import type { Settings } from "../menus/model.ts";
import { loadSettings, saveSettings, subscribeSettings } from "../settings.ts";
import { createBacklightController } from "./backlightController.ts";

let externalEcho: Settings | null = null;

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

export function useSavedSettings(settings: Settings, settingsRef: RefObject<Settings>) {
  useEffect(() => {
    if (externalEcho && sameSettings(externalEcho, settings)) return;
    externalEcho = null;
    const timer = window.setTimeout(() => saveSettings(settings), 200);
    return () => window.clearTimeout(timer);
  }, [settings]);

  useEffect(
    () => () => {
      const latest = settingsRef.current;
      if (externalEcho && sameSettings(externalEcho, latest)) return;
      saveSettings(latest);
    },
    [settingsRef],
  );
}

export function useBacklight(
  settings: Settings,
  setSettings: Dispatch<SetStateAction<Settings>>,
  settingsRef: RefObject<Settings>,
) {
  const [controller] = useState(() => createBacklightController(loadSettings().backlight));
  const lit = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot);
  const opening = useRef(true);

  const followScheme = useEffectEvent((matches: boolean) => {
    if (settingsRef.current.backlightChosen) return;
    setSettings((current) => ({
      ...current,
      backlight: matches ? "always_on" : "off",
    }));
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => followScheme(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => controller.mount(), [controller]);

  // StrictMode replays this effect. Reset so the replay does not arm a timed backlight.
  useEffect(() => {
    return () => {
      opening.current = true;
    };
  }, []);

  useEffect(() => {
    if (opening.current) {
      opening.current = false;
      controller.syncInitial(settings.backlight);
      return;
    }
    controller.applyMode(settings.backlight);
  }, [controller, settings.backlight, settings.backlightChosen]);

  const acceptExternal = useEffectEvent((next: Settings) => {
    setSettings((current) => {
      if (sameSettings(current, next)) return current;
      externalEcho = next;
      return next;
    });
  });

  useEffect(() => subscribeSettings(acceptExternal), []);

  function notify() {
    controller.activity(settingsRef.current.backlight);
  }

  function toggleBacklight() {
    controller.toggle();
  }

  function pressOnly() {
    notify();
    unlockClick();
  }

  return { lit, notify, toggleBacklight, pressOnly };
}
