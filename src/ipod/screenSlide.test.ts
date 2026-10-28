import assert from "node:assert/strict";
import test from "node:test";
import { beginSlide, haltSlide } from "./screenSlide.ts";

type FakeNode = {
  clientWidth: number;
  style: { transform: string; display?: string };
  parentElement: FakeNode | null;
  matches: (selector: string) => boolean;
};

function installDom(reducedMotion = false) {
  let hidden = false;
  let nextId = 1;
  const pending = new Map<number, FrameRequestCallback>();
  const listeners = new Set<() => void>();
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
  };
  globalThis.window = {
    matchMedia: () => ({ matches: reducedMotion }),
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number) => {
      pending.delete(id);
    },
  } as unknown as Window & typeof globalThis;
  globalThis.document = {
    get hidden() {
      return hidden;
    },
    addEventListener: (_type: string, listener: EventListener) => {
      listeners.add(listener as () => void);
    },
    removeEventListener: (_type: string, listener: EventListener) => {
      listeners.delete(listener as () => void);
    },
  } as unknown as Document;
  return {
    listeners,
    pending,
    hide() {
      hidden = true;
      for (const listener of listeners) listener();
    },
    flush() {
      const queued = [...pending.entries()];
      pending.clear();
      for (const [, callback] of queued) callback(0);
    },
    restore() {
      globalThis.window = previous.window;
      globalThis.document = previous.document;
    },
  };
}

function sheet(width = 320): FakeNode {
  const parent: FakeNode = {
    clientWidth: width,
    style: { transform: "" },
    parentElement: null,
    matches: () => false,
  };
  return {
    clientWidth: width,
    style: { transform: "" },
    parentElement: parent,
    matches: () => false,
  };
}

test("a hidden document paints the end state and ends the slide", () => {
  const dom = installDom();
  try {
    let ended = 0;
    const node = sheet();
    beginSlide(node as unknown as HTMLElement, { back: false, direction: "out" }, () => {
      ended += 1;
    });
    assert.equal(node.style.transform, "translateX(0px)");
    assert.equal(dom.listeners.size, 1);
    dom.hide();
    assert.equal(ended, 1);
    assert.equal(node.style.transform, "translateX(-320px)");
    assert.equal(dom.listeners.size, 0);
    dom.flush();
    assert.equal(ended, 1);
  } finally {
    dom.restore();
  }
});

test("hiding an intro clears its transform", () => {
  const dom = installDom();
  try {
    const node = sheet();
    beginSlide(node as unknown as HTMLElement, { back: false, direction: "in" });
    dom.hide();
    assert.equal(node.style.transform, "");
    assert.equal(dom.listeners.size, 0);
  } finally {
    dom.restore();
  }
});

test("cancel removes the hide listener and does not end the slide", () => {
  const dom = installDom();
  try {
    let ended = 0;
    const node = sheet();
    const handle = beginSlide(
      node as unknown as HTMLElement,
      { back: false, direction: "out" },
      () => {
        ended += 1;
      },
    );
    handle.cancel();
    dom.hide();
    dom.flush();
    assert.equal(ended, 0);
    assert.equal(dom.listeners.size, 0);
  } finally {
    dom.restore();
  }
});

test("haltSlide removes the hide listener", () => {
  const dom = installDom();
  try {
    let ended = 0;
    const node = sheet();
    beginSlide(node as unknown as HTMLElement, { back: false, direction: "out" }, () => {
      ended += 1;
    });
    haltSlide(node as unknown as HTMLElement);
    dom.hide();
    assert.equal(ended, 0);
    assert.equal(dom.listeners.size, 0);
  } finally {
    dom.restore();
  }
});

test("reduced motion still waits a frame unless the document is already hidden", async () => {
  const dom = installDom(true);
  try {
    let ended = 0;
    const node = sheet();
    beginSlide(node as unknown as HTMLElement, { back: false, direction: "out" }, () => {
      ended += 1;
    });
    assert.equal(ended, 0);
    assert.equal(node.style.transform, "");
    dom.flush();
    assert.equal(ended, 1);
    assert.equal(dom.listeners.size, 0);

    ended = 0;
    const hiddenNode = sheet();
    Object.defineProperty(globalThis.document, "hidden", { get: () => true });
    beginSlide(hiddenNode as unknown as HTMLElement, { back: true, direction: "in" }, () => {
      ended += 1;
    });
    assert.equal(ended, 0);
    await Promise.resolve();
    assert.equal(ended, 1);
    dom.flush();
    assert.equal(ended, 1);
  } finally {
    dom.restore();
  }
});
