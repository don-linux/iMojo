export type SlideCleanupPlan = {
  cancelDrop: boolean;
  halt: boolean;
  restorePending: boolean;
};

export function slideCleanupPlan(input: {
  dropped: boolean;
  generation: number;
  pendingGen: number | null;
}): SlideCleanupPlan {
  if (input.dropped) {
    return { cancelDrop: false, halt: false, restorePending: false };
  }
  if (input.pendingGen !== null && input.pendingGen > input.generation) {
    return { cancelDrop: true, halt: false, restorePending: false };
  }
  return { cancelDrop: true, halt: true, restorePending: input.pendingGen === null };
}

type LiveSheet = { id: number; live: boolean };

export function stackEnteringSheet<T extends LiveSheet>(
  layers: readonly T[],
  liveId: number,
  entering: T,
  leave: (layer: T) => T,
): T[] {
  return [...layers.map((layer) => (layer.id === liveId ? leave(layer) : layer)), entering];
}

/** Live sheet plus the one leaving. Older sheets stay until beginSlide has stolen their motion. */
export function pruneStaleSheets<T extends LiveSheet>(layers: readonly T[], leavingId: number): T[] {
  for (const layer of layers) {
    if (!layer.live && layer.id !== leavingId) {
      return layers.filter((item) => item.live || item.id === leavingId);
    }
  }
  return layers as T[];
}

export function dropDepartedSheet<T extends LiveSheet>(layers: readonly T[], id: number): T[] {
  for (const layer of layers) {
    if (layer.id === id && !layer.live) return layers.filter((item) => item.id !== id);
  }
  return layers as T[];
}
