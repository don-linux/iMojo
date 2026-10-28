import assert from "node:assert/strict";
import test from "node:test";
import { navigationKey, screenKeyAction, type ScreenKeyTarget } from "./screenKeys.ts";
import { buttonActivationKey, mapWheelKey } from "./wheel/mapKey.ts";
import type { WheelButton, WheelScrollTarget } from "./wheel/types.ts";

const screen: ScreenKeyTarget = {
  tagName: "DIV",
  inputType: null,
  editable: false,
  inDialog: false,
  inIpod: true,
  inWheel: false,
};

test("navigation key ignores the highlighted row", () => {
  const deep = [
    { id: "main", index: 0 },
    { id: "playlist", index: 4, param: "abc" },
  ];
  const moved = [
    { id: "main", index: 3 },
    { id: "playlist", index: 1, param: "abc" },
  ];
  assert.equal(navigationKey(deep), "main:/playlist:abc");
  assert.equal(navigationKey(moved), navigationKey(deep));
  assert.notEqual(navigationKey(deep.slice(0, 1)), navigationKey(deep));
  assert.notEqual(navigationKey([{ id: "playlist", param: "other" }]), navigationKey(deep.slice(1)));
});

test("screen keys ignore text entry, the client id dialog, and anything outside the device", () => {
  assert.equal(screenKeyAction(screen), "handle");
  assert.equal(screenKeyAction({ ...screen, inIpod: false }), "ignore");
  assert.equal(screenKeyAction({ ...screen, inDialog: true, inIpod: false }), "ignore");
  assert.equal(screenKeyAction({ ...screen, inDialog: true }), "ignore");
  assert.equal(screenKeyAction({ ...screen, tagName: "INPUT", inputType: "text" }), "ignore");
  assert.equal(screenKeyAction({ ...screen, tagName: "input", inputType: null }), "ignore");
  assert.equal(screenKeyAction({ ...screen, tagName: "TEXTAREA" }), "ignore");
  assert.equal(screenKeyAction({ ...screen, tagName: "SELECT" }), "ignore");
  assert.equal(screenKeyAction({ ...screen, editable: true }), "ignore");
  assert.equal(screenKeyAction({ ...screen, tagName: "INPUT", inputType: "range" }), "handle");
  assert.equal(
    screenKeyAction({ ...screen, tagName: "INPUT", inputType: "text", inWheel: true }),
    "ignore",
  );
});

test("click-wheel targets are deferred so the wheel listener is the only handler", () => {
  assert.equal(screenKeyAction({ ...screen, inWheel: true }), "defer");
  const keys = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Enter", " ", "Escape"];
  const targets: WheelScrollTarget[] = ["list", "volume", "seek", "brick"];
  for (const target of targets) {
    for (const key of keys) {
      assert.notEqual(mapWheelKey(key, target, null, false), undefined, `${target} ${key}`);
    }
  }
  const buttons: WheelButton[] = ["menu", "back", "forward", "playpause", "select"];
  for (const button of buttons) {
    const claim = buttonActivationKey(button, null);
    const nativeClick = claim === null;
    assert.equal(nativeClick, button === "playpause" || button === "select");
  }
  assert.notEqual(buttonActivationKey("select", 5000), null);
});
