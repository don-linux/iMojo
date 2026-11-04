const SECURE_REASON = "Spotify playback needs a secure page";
const DRM_REASON = "Spotify playback needs DRM support";

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

export function spotifyPlaybackSupport(probe?: SpotifySupportProbe): SpotifyPlaybackSupport {
  const env = probe ?? browserProbe();
  if (env.isSecureContext !== true) return { ok: false, reason: SECURE_REASON };
  const nav = env.navigator ?? {};
  if (typeof nav.requestMediaKeySystemAccess !== "function") {
    return { ok: false, reason: DRM_REASON };
  }
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
