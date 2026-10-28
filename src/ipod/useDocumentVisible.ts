import { useSyncExternalStore } from "react";

function subscribe(onStoreChange: () => void) {
  document.addEventListener("visibilitychange", onStoreChange);
  return () => document.removeEventListener("visibilitychange", onStoreChange);
}

function visibleNow() {
  return document.visibilityState === "visible";
}

function visibleOnServer() {
  return true;
}

export function useDocumentVisible() {
  return useSyncExternalStore(subscribe, visibleNow, visibleOnServer);
}
