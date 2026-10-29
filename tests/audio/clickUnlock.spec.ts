import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { boot, waitForLibrary } from "../visual/seed.ts";

/**
 * Proves the click player's AudioContext is constructed from a real user gesture
 * and that the page never builds a second one.
 *
 * Touch `pointerdown` may construct the context so the click buffer can decode,
 * but resume and the silent prime wait for a real activation: trusted `pointerup`
 * or `touchend`. The context must be running within 1s of that first touchend.
 * A mouse `pointerdown` is activation, so the same work happens there.
 *
 * `src/settings.ts` defaults `clicker` to "on" (`defaultSettings` / `parseSettings`),
 * and `tests/visual/library.ts` `settingsSeed` stores the same value. Boot uses that
 * seed, so rotating the wheel calls `playClick()`.
 *
 * Headless Chrome can lack an audio output device. This file does not pass
 * `--autoplay-policy`.
 */

const VIEWPORT = { width: 390, height: 844 };
// Outside the center button (dead zone ~0.36 of the ring radius) and inside the disc.
const RING_RADIUS_RATIO = 0.62;
const ARC_DEGREES = 120;
const STEP_DEGREES = 10;

type GestureHit = { trusted: boolean; type: string | null };
type ResumeRecord = GestureHit & { state: string };
type BuiltDuring = { type: string | null; trusted: boolean };

type Probe = {
  ctxCount: number;
  clickStarts: number;
  silentStarts: number;
  states: string[];
  resumes: ResumeRecord[];
  silentMarks: GestureHit[];
  state: string | null;
  bufferFrames: number[];
  trusted: string[];
  builtDuring: BuiltDuring | null;
};

type RingBox = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };

declare global {
  interface Window {
    __ctxCount: number;
    __clickStarts: number;
    __silentStarts: number;
    __states: string[];
    __resumes: ResumeRecord[];
    __silentMarks: GestureHit[];
    __audioState: string | null;
    __bufferFrames: number[];
    __trusted: string[];
    __activeGesture: { type: string; trusted: boolean } | null;
    __builtDuring: BuiltDuring | null;
  }
}

async function installAudioProbe(page: Page) {
  await page.addInitScript(() => {
    const host = window;
    host.__ctxCount = 0;
    host.__clickStarts = 0;
    host.__silentStarts = 0;
    host.__states = [];
    host.__resumes = [];
    host.__silentMarks = [];
    host.__audioState = null;
    host.__bufferFrames = [];
    host.__trusted = [];
    host.__activeGesture = null;
    host.__builtDuring = null;

    const nativeAdd = EventTarget.prototype.addEventListener;
    const nativeRemove = EventTarget.prototype.removeEventListener;
    const wrapped = new WeakMap<EventListener, EventListener>();

    function track(listener: EventListenerOrEventListenerObject) {
      if (typeof listener !== "function") return listener;
      const existing = wrapped.get(listener);
      if (existing) return existing;
      const fn: EventListener = function (this: EventTarget, event: Event) {
        const prev = host.__activeGesture;
        host.__activeGesture = { type: event.type, trusted: event.isTrusted };
        try {
          return listener.call(this, event);
        } finally {
          host.__activeGesture = prev;
        }
      };
      wrapped.set(listener, fn);
      return fn;
    }

    EventTarget.prototype.addEventListener = function (type, listener, options) {
      return nativeAdd.call(this, type, track(listener), options);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      return nativeRemove.call(this, type, track(listener), options);
    };

    function noteTrusted(event: Event) {
      if (!event.isTrusted || host.__trusted.length > 80) return;
      host.__trusted.push(event.type);
    }
    nativeAdd.call(document, "pointerdown", noteTrusted, true);
    nativeAdd.call(document, "pointerup", noteTrusted, true);
    nativeAdd.call(document, "touchend", noteTrusted, true);

    function instrument(ctx: AudioContext) {
      host.__ctxCount += 1;
      if (!host.__builtDuring) {
        host.__builtDuring = host.__activeGesture
          ? { type: host.__activeGesture.type, trusted: host.__activeGesture.trusted }
          : { type: null, trusted: false };
      }
      host.__audioState = ctx.state;
      host.__states.push(ctx.state);
      nativeAdd.call(ctx, "statechange", () => {
        host.__audioState = ctx.state;
        host.__states.push(ctx.state);
      });

      const resume = ctx.resume.bind(ctx);
      ctx.resume = () => {
        const active = host.__activeGesture;
        host.__resumes.push({
          trusted: active?.trusted === true,
          type: active?.type ?? null,
          state: ctx.state,
        });
        return resume();
      };

      const createBuffer = ctx.createBuffer.bind(ctx);
      ctx.createBuffer = (channels: number, length: number, sampleRate: number) => {
        host.__bufferFrames.push(length);
        return createBuffer(channels, length, sampleRate);
      };

      const createBufferSource = ctx.createBufferSource.bind(ctx);
      ctx.createBufferSource = () => {
        const source = createBufferSource();
        const start = source.start.bind(source);
        source.start = ((...args: Parameters<AudioBufferSourceNode["start"]>) => {
          const length = source.buffer?.length ?? 0;
          const active = host.__activeGesture;
          if (length > 1) host.__clickStarts += 1;
          else if (length === 1) {
            host.__silentStarts += 1;
            if (host.__silentMarks.length < 40) {
              host.__silentMarks.push({
                trusted: active?.trusted === true,
                type: active?.type ?? null,
              });
            }
          }
          return start(...args);
        }) as AudioBufferSourceNode["start"];
        return source;
      };
    }

    function wrapCtor(Native: typeof AudioContext): typeof AudioContext {
      class Wrapped extends Native {
        constructor(options?: AudioContextOptions) {
          super(options);
          instrument(this);
        }
      }
      return Wrapped;
    }

    const nativeAudio = window.AudioContext;
    const nativeWebkit = window.webkitAudioContext;
    if (typeof nativeAudio === "function") {
      window.AudioContext = wrapCtor(nativeAudio);
    }
    if (typeof nativeWebkit === "function") {
      window.webkitAudioContext = nativeWebkit === nativeAudio ? window.AudioContext : wrapCtor(nativeWebkit);
    }
  });
}

async function readProbe(page: Page): Promise<Probe> {
  return page.evaluate(() => ({
    ctxCount: window.__ctxCount,
    clickStarts: window.__clickStarts,
    silentStarts: window.__silentStarts,
    states: window.__states.slice(),
    resumes: window.__resumes.map((entry) => ({ ...entry })),
    silentMarks: window.__silentMarks.map((entry) => ({ ...entry })),
    state: window.__audioState,
    bufferFrames: window.__bufferFrames.slice(),
    trusted: window.__trusted.slice(),
    builtDuring: window.__builtDuring ? { ...window.__builtDuring } : null,
  }));
}

function probeText(probe: Probe) {
  return JSON.stringify(probe);
}

async function becameRunning(page: Page) {
  try {
    await page.waitForFunction(() => window.__audioState === "running", undefined, { timeout: 1000 });
    return true;
  } catch {
    return false;
  }
}

function assertTrustedResume(probe: Probe, type: string) {
  const matched = probe.resumes.some((entry) => entry.trusted && entry.type === type);
  expect(matched, `resume() inside trusted ${type}: ${probeText(probe)}`).toBe(true);
}

function duringTouchUnlock(marks: GestureHit[]) {
  return marks.some((mark) => mark.trusted && (mark.type === "pointerup" || mark.type === "touchend"));
}

async function ringBox(page: Page): Promise<RingBox> {
  const box = await page.getByTestId("wheel-ring").boundingBox();
  if (!box) throw new Error("wheel ring has no bounding box");
  return box;
}

function pointOnRing(box: RingBox, angleDeg: number): Point {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const radius = (Math.min(box.width, box.height) / 2) * RING_RADIUS_RATIO;
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: Math.round(cx + Math.cos(rad) * radius),
    y: Math.round(cy + Math.sin(rad) * radius),
  };
}

function arcPoints(box: RingBox, sweep: number): Point[] {
  const steps = Math.round(Math.abs(sweep) / STEP_DEGREES);
  const sign = sweep < 0 ? -1 : 1;
  const startDeg = -160;
  const points: Point[] = [];
  for (let index = 0; index <= steps; index += 1) {
    points.push(pointOnRing(box, startDeg + sign * STEP_DEGREES * index));
  }
  return points;
}

async function hitTest(page: Page, point: Point) {
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return "none";
    return el.getAttribute("data-testid") ?? el.className.toString();
  }, point);
}

async function selectionIndex(page: Page) {
  return page.getByTestId("menu-items").evaluate((el) => {
    const active = el.getAttribute("aria-activedescendant") ?? "";
    const match = /-(\d+)$/.exec(active);
    return {
      index: match ? Number(match[1]) : 0,
      count: el.querySelectorAll("[data-testid='menu-item']").length,
    };
  });
}

async function touchDrag(page: Page, client: CDPSession, sweep: number) {
  const box = await ringBox(page);
  const points = arcPoints(box, sweep);
  const start = points[0];
  if (!start) throw new Error("arc produced no points");
  expect(await hitTest(page, start), `touch start hit`).toBe("wheel-ring");
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: start.x, y: start.y, id: 1, radiusX: 1, radiusY: 1 }],
  });
  await expect(page.getByTestId("click-wheel")).toHaveClass(/dragging/);
  for (const point of points.slice(1)) {
    await page.waitForTimeout(32);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: point.x, y: point.y, id: 1, radiusX: 1, radiusY: 1 }],
    });
  }
  await page.waitForTimeout(32);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

async function mouseMoveArc(page: Page, sweep: number) {
  const box = await ringBox(page);
  const points = arcPoints(box, sweep);
  for (const point of points.slice(1)) {
    await page.waitForTimeout(32);
    await page.mouse.move(point.x, point.y);
  }
}

async function waitForClickBuffer(page: Page) {
  await page.waitForFunction(
    () => window.__bufferFrames.some((length) => length > 1),
    undefined,
    { timeout: 2000 },
  );
}

async function hideAndShow(page: Page, client: CDPSession) {
  await client.send("Emulation.setFocusEmulationEnabled", { enabled: false });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(50);
  await client.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(50);
}

async function prepare(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installAudioProbe(page);
  await boot(page, { backlight: "always_on", library: true });
  await waitForLibrary(page);
  await expect(page.getByTestId("menu-items")).toBeVisible();
  const probe = await readProbe(page);
  expect(probe.ctxCount, `AudioContext constructed before a gesture ${probeText(probe)} ${errors.join(" | ")}`).toBe(0);
  return errors;
}

test.describe("touch unlock", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
  });

  test("a real touch drag unlocks one AudioContext and later drags still click", async ({ page }) => {
    const errors = await prepare(page);
    const client = await page.context().newCDPSession(page);

    await test.step("first touch arc unlocks", async () => {
      await touchDrag(page, client, ARC_DEGREES);
      const probe = await readProbe(page);
      expect(probe.ctxCount, probeText(probe)).toBe(1);
      expect(probe.builtDuring, probeText(probe)).toEqual({ type: "pointerdown", trusted: true });
      expect(probe.trusted, probeText(probe)).toContain("pointerdown");
      expect(probe.trusted, probeText(probe)).toContain("touchend");
      expect(duringTouchUnlock(probe.resumes), `resume() inside trusted pointerup/touchend: ${probeText(probe)}`).toBe(true);
      expect(duringTouchUnlock(probe.silentMarks), `silent start inside trusted pointerup/touchend: ${probeText(probe)}`).toBe(true);
      expect(probe.resumes.some((entry) => entry.type === "pointerdown"), probeText(probe)).toBe(false);
      expect(probe.silentMarks.some((entry) => entry.type === "pointerdown"), probeText(probe)).toBe(false);

      const running = await becameRunning(page);
      const after = await readProbe(page);
      test.info().annotations.push({
        type: "audio",
        description: running ? "touch context running" : `touch context ${after.state ?? "missing"}`,
      });
      expect(running, probeText(after)).toBe(true);
      expect(after.state, probeText(after)).toBe("running");
      await waitForClickBuffer(page);
      expect(errors, probeText(after)).toEqual([]);
    });

    const running = (await readProbe(page)).state === "running";

    await test.step("second touch arc schedules clicks on the same context", async () => {
      const before = await readProbe(page);
      const selected = await selectionIndex(page);
      const sweep = selected.index <= 0 ? ARC_DEGREES : -ARC_DEGREES;
      await touchDrag(page, client, sweep);
      const after = await readProbe(page);
      expect(after.ctxCount, probeText(after)).toBe(1);
      if (running) {
        expect(after.clickStarts, `selection ${JSON.stringify(selected)} ${probeText(after)}`).toBeGreaterThan(
          before.clickStarts,
        );
      }
    });

    await test.step("hide, show, and a third arc keep the same context", async () => {
      await hideAndShow(page, client);
      const hidden = await readProbe(page);
      expect(hidden.ctxCount, probeText(hidden)).toBe(1);
      const before = hidden.clickStarts;
      const selected = await selectionIndex(page);
      const sweep = selected.index <= 0 ? ARC_DEGREES : -ARC_DEGREES;
      await touchDrag(page, client, sweep);
      const after = await readProbe(page);
      expect(after.ctxCount, probeText(after)).toBe(1);
      if (running) {
        expect(after.clickStarts, `selection ${JSON.stringify(selected)} ${probeText(after)}`).toBeGreaterThan(before);
      }
    });
  });
});

test.describe("mouse unlock", () => {
  test.use({
    hasTouch: false,
    isMobile: false,
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 1,
  });

  test("a mouse drag starts clicks on the first drag and builds one AudioContext", async ({ page }) => {
    await prepare(page);
    const box = await ringBox(page);
    const points = arcPoints(box, ARC_DEGREES);
    const start = points[0];
    if (!start) throw new Error("arc produced no points");
    expect(await hitTest(page, start)).toBe("wheel-ring");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await expect(page.getByTestId("click-wheel")).toHaveClass(/dragging/);

    const running = await becameRunning(page);
    const unlocked = await readProbe(page);
    expect(unlocked.builtDuring, probeText(unlocked)).toEqual({ type: "pointerdown", trusted: true });
    test.info().annotations.push({
      type: "audio",
      description: running ? "mouse context running" : `mouse context ${unlocked.state ?? "missing"}`,
    });
    expect(unlocked.ctxCount, probeText(unlocked)).toBe(1);
    expect(unlocked.silentStarts, probeText(unlocked)).toBeGreaterThanOrEqual(1);
    expect(unlocked.trusted, probeText(unlocked)).toContain("pointerdown");

    if (running) {
      expect(unlocked.state).toBe("running");
      await waitForClickBuffer(page);
      const before = (await readProbe(page)).clickStarts;
      await mouseMoveArc(page, ARC_DEGREES);
      const during = await readProbe(page);
      expect(during.clickStarts, probeText(during)).toBeGreaterThan(before);
      expect(during.ctxCount, probeText(during)).toBe(1);
    } else {
      assertTrustedResume(unlocked, "pointerdown");
    }

    await page.mouse.up();
    const done = await readProbe(page);
    expect(done.ctxCount, probeText(done)).toBe(1);
  });
});
