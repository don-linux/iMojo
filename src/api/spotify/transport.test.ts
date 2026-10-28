import assert from "node:assert/strict";
import { test } from "node:test";
import { playRequestBody } from "./transport.ts";

test("play requests address duplicates by window position", () => {
  assert.deepEqual(
    playRequestBody({
      uris: ["spotify:track:a", "spotify:track:a"],
      queueIndices: [0, 2],
      offset: 1,
      positionMs: 0,
    }),
    { uris: ["spotify:track:a", "spotify:track:a"], offset: { position: 1 } },
  );
});
