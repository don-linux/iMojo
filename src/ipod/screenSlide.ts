// Port of Apple's screen transition (Kl). A CSS animation always restarts at
// the keyframe edge; this keeps the in-flight motion and picks it up.

const SLIDE_MS = 240;

type Easing = (t: number) => number;

type Motion = {
  node: HTMLElement | null;
  startedAt: number;
  from: number;
  to: number;
  duration: number;
  easing: Easing;
  frame?: number;
  onEnd?: () => void;
};

const intros = new WeakMap<HTMLElement, Motion>();
const queues = new WeakMap<HTMLElement, Map<number, Motion[]>>();

function cosineInOut(t: number) {
  return -0.5 * (Math.cos(Math.PI * t) - 1);
}

function sineOut(t: number) {
  return Math.sin((t * Math.PI) / 2);
}

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function queueFor(parent: HTMLElement, sign: number) {
  let bySign = queues.get(parent);
  if (!bySign) {
    bySign = new Map();
    queues.set(parent, bySign);
  }
  let list = bySign.get(sign);
  if (!list) {
    list = [];
    bySign.set(sign, list);
  }
  return list;
}

function halt(motion: Motion | undefined) {
  if (!motion?.frame) return;
  window.cancelAnimationFrame(motion.frame);
  motion.frame = undefined;
}

/** Position while the motion is still running. Finished motions return undefined. */
function mathPosition(motion: Motion | undefined) {
  if (!motion || motion.duration <= 0) return;
  const t = (performance.now() - motion.startedAt) / motion.duration;
  if (t >= 1) return;
  return motion.from + (motion.to - motion.from) * motion.easing(t);
}

function readTranslateX(node: HTMLElement) {
  const { transform } = getComputedStyle(node);
  if (!transform || transform === "none" || typeof DOMMatrixReadOnly === "undefined") return;
  try {
    return new DOMMatrixReadOnly(transform).m41;
  } catch {
    return;
  }
}

function paint(node: HTMLElement, motion: Motion, t: number) {
  const eased = motion.easing(Math.min(1, Math.max(0, t)));
  const x = motion.from + (motion.to - motion.from) * eased;
  node.style.transform = motion.to === 0 && t >= 1 ? "" : `translateX(${x}px)`;
}

function finish(motion: Motion) {
  motion.frame = undefined;
  motion.onEnd?.();
  motion.onEnd = undefined;
}

function start(motion: Motion) {
  const node = motion.node;
  if (!node) return;
  if (motion.duration <= 0) {
    paint(node, motion, 1);
    motion.frame = window.requestAnimationFrame(() => finish(motion));
    return;
  }
  paint(node, motion, 0);
  const step = () => {
    const t = (performance.now() - motion.startedAt) / motion.duration;
    if (t >= 1) {
      paint(node, motion, 1);
      finish(motion);
      return;
    }
    paint(node, motion, t);
    motion.frame = window.requestAnimationFrame(step);
  };
  motion.frame = window.requestAnimationFrame(step);
}

export type SlideOptions = {
  back: boolean;
  direction: "in" | "out";
};

export type SlideHandle = {
  stolen: HTMLElement | null;
  cancel: () => void;
};

/**
 * Starts a sheet slide. Outro must run before intro in the same frame, or the
 * incoming sheet will not find the motion it is supposed to continue.
 */
export function beginSlide(
  node: HTMLElement,
  options: SlideOptions,
  onEnd?: () => void,
): SlideHandle {
  const parent = node.parentElement;
  const width = parent?.clientWidth ?? 0;
  if (reducedMotion() || width === 0) {
    node.style.transform = "";
    if (!onEnd) return { stolen: null, cancel: () => {} };
    const frame = window.requestAnimationFrame(onEnd);
    return { stolen: null, cancel: () => window.cancelAnimationFrame(frame) };
  }

  const rtl = node.matches(":dir(rtl)");
  const offset = (options.back === rtl ? 1 : -1) * width;

  if (options.direction === "in") {
    const sign = Math.sign(offset);
    const list = parent ? queueFor(parent, sign) : undefined;
    const stolen = list?.pop();
    const math = mathPosition(stolen);
    const painted =
      math !== undefined && stolen?.node ? (readTranslateX(stolen.node) ?? math) : math;
    if (stolen?.node) {
      stolen.node.style.display = "none";
      halt(stolen);
    }
    const from = painted ?? offset;
    const motion: Motion = {
      node,
      startedAt: performance.now(),
      from,
      to: 0,
      // Hold the speed, not the duration, so a pickup does not crawl.
      duration: SLIDE_MS * (Math.abs(from) / width),
      easing: painted === undefined ? cosineInOut : sineOut,
      onEnd,
    };
    intros.set(node, motion);
    start(motion);
    return { stolen: stolen?.node ?? null, cancel: () => halt(motion) };
  }

  const previous = intros.get(node);
  halt(previous);
  const from = mathPosition(previous) ?? 0;
  intros.delete(node);
  const to = -offset;
  const motion: Motion = {
    node,
    startedAt: performance.now(),
    from,
    to,
    // Capped so a screen caught at the far edge does not crawl.
    duration: SLIDE_MS * Math.min(1, Math.abs(to - from) / width),
    easing: from === 0 ? cosineInOut : sineOut,
    onEnd,
  };
  if (parent) {
    const list = queueFor(parent, Math.sign(to));
    for (const item of list) {
      if (mathPosition(item) === undefined) item.node = null;
    }
    list.push(motion);
  }
  start(motion);
  return { stolen: null, cancel: () => halt(motion) };
}

export function haltSlide(node: HTMLElement | null | undefined) {
  if (!node) return;
  const intro = intros.get(node);
  if (intro) {
    halt(intro);
    intros.delete(node);
  }
  const parent = node.parentElement;
  const bySign = parent ? queues.get(parent) : undefined;
  if (!bySign) return;
  for (const list of bySign.values()) {
    for (let index = list.length - 1; index >= 0; index -= 1) {
      if (list[index]?.node !== node) continue;
      halt(list[index]);
      list.splice(index, 1);
    }
  }
}
