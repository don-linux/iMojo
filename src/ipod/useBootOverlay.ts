import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Player } from "../api/player.ts";
import type { LoadStatus } from "../api/types.ts";
import { BOOT_MAX_MS, BOOT_MIN_MS, type Overlay } from "./model.ts";

type BootInput = {
  musicStatus: LoadStatus;
  errorDismissed: boolean;
};

export function useBootOverlay({ musicStatus, errorDismissed }: BootInput) {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [minDisplayElapsed, setMinDisplayElapsed] = useState(false);
  const [maxHoldElapsed, setMaxHoldElapsed] = useState(false);
  const bootedRef = useRef(false);
  const overlayRef = useRef<Overlay>(null);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (!online) {
      if (!bootedRef.current) {
        setMinDisplayElapsed(false);
        setMaxHoldElapsed(false);
      }
      return;
    }
    if (bootedRef.current) {
      setMaxHoldElapsed(true);
      return;
    }
    setMinDisplayElapsed(false);
    setMaxHoldElapsed(false);
    const minTimer = window.setTimeout(() => setMinDisplayElapsed(true), BOOT_MIN_MS);
    const maxTimer = window.setTimeout(() => setMaxHoldElapsed(true), BOOT_MAX_MS);
    return () => {
      window.clearTimeout(minTimer);
      window.clearTimeout(maxTimer);
    };
  }, [online]);

  const isBootLoading = (!maxHoldElapsed && musicStatus === "loading") || !minDisplayElapsed;
  const isInert = isBootLoading || !online;

  useEffect(() => {
    if (!isInert) bootedRef.current = true;
  }, [isInert]);

  const overlay: Overlay = !online
    ? "offline"
    : isBootLoading
      ? "loading"
      : musicStatus === "error" && !errorDismissed
        ? "library-error"
        : null;

  useLayoutEffect(() => {
    overlayRef.current = overlay;
  });

  return { online, isInert, overlay, overlayRef };
}

export function usePauseWhenOffline(online: boolean, player: Player) {
  useEffect(() => {
    if (!online) player.pause();
  }, [online, player.pause]);
}

export function useErrorDismiss(
  musicStatus: LoadStatus,
  setErrorDismissed: Dispatch<SetStateAction<boolean>>,
) {
  useEffect(() => {
    if (musicStatus !== "error") setErrorDismissed(false);
  }, [musicStatus, setErrorDismissed]);
}
