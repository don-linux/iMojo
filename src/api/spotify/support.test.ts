import assert from "node:assert/strict";
import test from "node:test";
import { spotifyPlaybackSupport, type SpotifySupportProbe } from "./support.ts";

const SECURE = "Spotify playback needs a secure page";
const DRM = "Spotify playback needs DRM support";

function desktop(): SpotifySupportProbe {
  return {
    isSecureContext: true,
    navigator: {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      maxTouchPoints: 0,
      requestMediaKeySystemAccess: () => undefined,
    },
  };
}

test("allows a secure desktop browser with encrypted media support", () => {
  assert.deepEqual(spotifyPlaybackSupport(desktop()), { ok: true });
});

test("rejects a page that is not a secure context", () => {
  const probe = desktop();
  probe.isSecureContext = false;
  assert.deepEqual(spotifyPlaybackSupport(probe), { ok: false, reason: SECURE });
});

test("rejects a browser without requestMediaKeySystemAccess", () => {
  const probe = desktop();
  probe.navigator = { ...probe.navigator, requestMediaKeySystemAccess: undefined };
  assert.deepEqual(spotifyPlaybackSupport(probe), { ok: false, reason: DRM });
});

test("allows a secure mobile client hint when DRM is present", () => {
  const probe = desktop();
  probe.navigator = { ...probe.navigator, userAgentData: { mobile: true } };
  assert.deepEqual(spotifyPlaybackSupport(probe), { ok: true });
});

test("allows an iPhone user agent when the client hint says it is not mobile", () => {
  const probe = desktop();
  probe.navigator = {
    ...probe.navigator,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    maxTouchPoints: 5,
    userAgentData: { mobile: false },
  };
  assert.deepEqual(spotifyPlaybackSupport(probe), { ok: true });
});

test("allows Android, iPhone, iPad, and iPod user agents", () => {
  for (const token of ["Android", "iPhone", "iPad", "iPod"]) {
    const probe = desktop();
    probe.navigator = { ...probe.navigator, userAgent: `Mozilla/5.0 (${token})`, maxTouchPoints: 1 };
    assert.deepEqual(spotifyPlaybackSupport(probe), { ok: true });
  }
});

test("allows iPadOS desktop mode", () => {
  const probe = desktop();
  probe.navigator = {
    ...probe.navigator,
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    maxTouchPoints: 5,
  };
  assert.deepEqual(spotifyPlaybackSupport(probe), { ok: true });
});

test("keeps a desktop Mac with a single touch point", () => {
  const probe = desktop();
  probe.navigator = { ...probe.navigator, maxTouchPoints: 1 };
  assert.deepEqual(spotifyPlaybackSupport(probe), { ok: true });
});

test("reports the secure-page failure before other navigator checks", () => {
  const probe = desktop();
  probe.isSecureContext = false;
  probe.navigator = { ...probe.navigator, userAgent: "Mozilla/5.0 (iPhone)" };
  assert.deepEqual(spotifyPlaybackSupport(probe), { ok: false, reason: SECURE });
});
