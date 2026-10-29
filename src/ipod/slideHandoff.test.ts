import assert from "node:assert/strict";
import test from "node:test";
import {
  dropDepartedSheet,
  pruneStaleSheets,
  slideCleanupPlan,
  stackEnteringSheet,
} from "./slideHandoff.ts";

test("a finished drop leaves the incoming sheet moving", () => {
  assert.deepEqual(slideCleanupPlan({ dropped: true, generation: 1, pendingGen: null }), {
    cancelDrop: false,
    halt: false,
    restorePending: false,
  });
});

test("a newer slide keeps the motion and blocks the old drop", () => {
  assert.deepEqual(slideCleanupPlan({ dropped: false, generation: 1, pendingGen: 2 }), {
    cancelDrop: true,
    halt: false,
    restorePending: false,
  });
});

test("an already-dropped generation does not halt for a newer slide", () => {
  assert.deepEqual(slideCleanupPlan({ dropped: true, generation: 1, pendingGen: 4 }), {
    cancelDrop: false,
    halt: false,
    restorePending: false,
  });
});

test("strict mode restarts only when no newer slide is queued", () => {
  assert.deepEqual(slideCleanupPlan({ dropped: false, generation: 4, pendingGen: null }), {
    cancelDrop: true,
    halt: true,
    restorePending: true,
  });
  assert.deepEqual(slideCleanupPlan({ dropped: false, generation: 4, pendingGen: 4 }), {
    cancelDrop: true,
    halt: true,
    restorePending: false,
  });
  assert.deepEqual(slideCleanupPlan({ dropped: false, generation: 4, pendingGen: 1 }), {
    cancelDrop: true,
    halt: true,
    restorePending: false,
  });
});

test("prune keeps the live sheet and the one that is leaving", () => {
  const layers = [
    { id: 1, live: false },
    { id: 2, live: false },
    { id: 3, live: true },
  ];
  assert.deepEqual(pruneStaleSheets(layers, 2), [
    { id: 2, live: false },
    { id: 3, live: true },
  ]);
  const held = [
    { id: 2, live: false },
    { id: 3, live: true },
  ];
  assert.equal(pruneStaleSheets(held, 2), held);
});

test("drop removes only a sheet that has already left", () => {
  const layers = [
    { id: 1, live: false },
    { id: 2, live: true },
  ];
  assert.equal(dropDepartedSheet(layers, 2), layers);
  assert.equal(dropDepartedSheet(layers, 9), layers);
  assert.deepEqual(dropDepartedSheet(layers, 1), [{ id: 2, live: true }]);
});

test("rapid push and pop never keep more than the live sheet and one leaving", () => {
  type Sheet = { id: number; live: boolean };
  let layers: Sheet[] = [{ id: 1, live: true }];
  let nextId = 1;
  for (let step = 0; step < 8; step += 1) {
    const live = layers.find((layer) => layer.live);
    if (!live) throw new Error("missing live sheet");
    nextId += 1;
    const stacked = stackEnteringSheet(layers, live.id, { id: nextId, live: true }, (layer) => ({
      ...layer,
      live: false,
    }));
    if (layers.some((layer) => !layer.live)) assert.ok(stacked.length > 2);
    layers = pruneStaleSheets(stacked, live.id);
    assert.ok(layers.length <= 2);
    assert.equal(layers.filter((layer) => layer.live).length, 1);
    const departed = layers.filter((layer) => !layer.live);
    assert.ok(departed.length <= 1);
    if (departed[0]) assert.equal(departed[0].id, live.id);
    if (step % 3 === 2) {
      const leaving = layers.find((layer) => !layer.live);
      if (leaving) layers = dropDepartedSheet(layers, leaving.id);
      assert.equal(layers.length, 1);
    }
  }
});
