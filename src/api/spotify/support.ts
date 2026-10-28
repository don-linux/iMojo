const DESKTOP_REASON = "Spotify playback needs a desktop browser";
const SECURE_REASON = "Spotify playback needs a secure page";
const DRM_REASON = "Spotify playback needs DRM support";
const MOBILE_UA = /Android|iPhone|iPad|iPod/i;
const MAC_UA = /Macintosh/;

export type SpotifySupportNavigator = {
  userAgent?: string;
  maxTouchPoints?: number;
  userAgentData?: { mobile?: boolean } | null;
  requestMediaKeySystemAccess?: unknown;
};

/** Plain inputs so the support decision can be tested without a browser. */
export type SpotifySupportProbe = {
  isSecureContext?: boolean;
  navigator?: SpotifySupportNavigator | null;
};

export type SpotifyPlaybackSupport = { ok: true } | { ok: false; reason: string };

function isMobile(nav: SpotifySupportNavigator) {
  const hinted = nav.userAgentData?.mobile;
  if (typeof hinted === "boolean") return hinted;
  const ua = nav.userAgent ?? "";
  if (MOBILE_UA.test(ua)) return true;
  return (nav.maxTouchPoints ?? 0) > 1 && MAC_UA.test(ua);
}

export function spotifyPlaybackSupport(probe?: SpotifySupportProbe): SpotifyPlaybackSupport {
  const env = probe ?? browserProbe();
  if (env.isSecureContext !== true) return { ok: false, reason: SECURE_REASON };
  const nav = env.navigator ?? {};
  if (typeof nav.requestMediaKeySystemAccess !== "function") {
    return { ok: false, reason: DRM_REASON };
  }
  if (isMobile(nav)) return { ok: false, reason: DESKTOP_REASON };
  return { ok: true };
}

function browserProbe(): SpotifySupportProbe {
  if (typeof window === "undefined") return { isSecureContext: false, navigator: {} };
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return {
    isSecureContext: window.isSecureContext,
    navigator: {
      userAgent: nav.userAgent,
      maxTouchPoints: nav.maxTouchPoints,
      userAgentData: nav.userAgentData,
      requestMediaKeySystemAccess: nav.requestMediaKeySystemAccess,
    },
  };
}
