import { playClick, unlockClick } from "./clickPlayer.ts";

const clickSound = {
  unlock: unlockClick,
  play: playClick,
};

export function useClickSound(): { unlock: () => void; play: () => void } {
  return clickSound;
}
