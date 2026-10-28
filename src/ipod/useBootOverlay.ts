import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import type { Player } from "../api/player.ts";
import type { LoadStatus } from "../api/types.ts";
import { createBootClock } from "./bootClock.ts";
import type { Overlay } from "./model.ts";

type BootInput = {
  musicStatus: LoadStatus;
  errorDismissed: boolean;
};

export function useBootOverlay({ musicStatus, errorDismissed }: BootInput) {
  const [clock] = useState(() => createBootClock());
  const snap = useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getServerSnapshot);
  const markBooted = useEffectEvent(() => {
    clock.markBooted();
  });

  const isBootLoading = (!snap.maxHoldElapsed && musicStatus === "loading") || !snap.minDisplayElapsed;
  const isInert = isBootLoading || !snap.online;

  useEffect(() => {
    if (!isInert) markBooted();
  }, [isInert]);

  const overlay: Overlay = !snap.online
    ? "offline"
    : isBootLoading
      ? "loading"
      : musicStatus === "error" && !errorDismissed
        ? "library-error"
        : null;

  const overlayRef = useRef<Overlay>(overlay);
  useLayoutEffect(() => {
    overlayRef.current = overlay;
  });

  return { online: snap.online, isInert, overlay, overlayRef };
}

export function usePauseWhenOffline(online: boolean, player: Player) {
  const pause = useEffectEvent(() => {
    player.pause();
  });

  useEffect(() => {
    if (!online) pause();
  }, [online]);
}

export function useErrorDismiss(
  musicStatus: LoadStatus,
  setErrorDismissed: Dispatch<SetStateAction<boolean>>,
) {
  const [tracked, setTracked] = useState(musicStatus);
  if (tracked !== musicStatus) {
    setTracked(musicStatus);
    if (musicStatus !== "error") setErrorDismissed(false);
  }
}
