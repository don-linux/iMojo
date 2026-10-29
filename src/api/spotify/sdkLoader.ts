import {
  PLAYER_NOT_LOADED,
  SDK_LOAD_TIMEOUT_MS,
  SDK_SCRIPT_SELECTOR,
  SDK_SCRIPT_URL,
  type SdkTimer,
  type SpotifySdk,
} from "./sdkTypes.ts";

export type SdkScript = {
  src: string;
  async: boolean;
  dataset: { spotifySdk?: string };
  onerror: ((event?: unknown) => void) | null;
  remove: () => void;
};

export type SdkLoaderDocument = {
  querySelector: (selector: string) => SdkScript | null;
  createElement: (tag: "script") => SdkScript;
  body: { appendChild: (node: SdkScript) => void };
};

export type SdkLoaderWindow = {
  Spotify?: SpotifySdk;
  onSpotifyWebPlaybackSDKReady?: () => void;
};

export type SdkLoaderDeps = {
  doc: SdkLoaderDocument;
  win: SdkLoaderWindow;
  timer: SdkTimer;
  timeoutMs?: number;
};

const flights = new WeakMap<object, Promise<void>>();

function loadError() {
  return new Error(PLAYER_NOT_LOADED);
}

function abortError(signal: AbortSignal) {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function browserDeps(): SdkLoaderDeps {
  return {
    doc: document,
    win: window,
    timer: {
      setTimeout: (handler: () => void, ms: number) => window.setTimeout(handler, ms),
      clearTimeout: (handle: unknown) => window.clearTimeout(handle as number),
    },
  } as unknown as SdkLoaderDeps;
}

function bindSignal(promise: Promise<void>, signal?: AbortSignal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      () => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) reject(abortError(signal));
        else resolve();
      },
      (reason: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(reason);
      },
    );
  });
}

function begin(env: SdkLoaderDeps) {
  const timeoutMs = env.timeoutMs ?? SDK_LOAD_TIMEOUT_MS;
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let script: SdkScript | null = null;
    const previous = env.win.onSpotifyWebPlaybackSDKReady;

    const restore = () => {
      if (env.win.onSpotifyWebPlaybackSDKReady === onReady) {
        env.win.onSpotifyWebPlaybackSDKReady = previous;
      }
    };

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      env.timer.clearTimeout(timer);
      restore();
      if (error) {
        script?.remove();
        reject(error);
        return;
      }
      resolve();
    };

    const onReady = () => {
      try {
        previous?.();
      } catch {
        // A hook installed before ours must not strand the load.
      }
      if (env.win.Spotify) finish();
      else finish(loadError());
    };

    const timer = env.timer.setTimeout(() => finish(loadError()), timeoutMs);
    env.win.onSpotifyWebPlaybackSDKReady = onReady;

    script = env.doc.querySelector(SDK_SCRIPT_SELECTOR);
    if (!script) {
      script = env.doc.createElement("script");
      script.src = SDK_SCRIPT_URL;
      script.async = true;
      script.dataset.spotifySdk = "true";
      script.onerror = () => finish(loadError());
      env.doc.body.appendChild(script);
    } else {
      script.onerror = () => finish(loadError());
    }
  });
}

export function loadSpotifySdk(signal?: AbortSignal, deps?: SdkLoaderDeps) {
  const env = deps ?? browserDeps();
  if (signal?.aborted) return Promise.reject(abortError(signal));
  if (env.win.Spotify) return Promise.resolve();

  let flight = flights.get(env.win);
  if (!flight) {
    flight = begin(env);
    flights.set(env.win, flight);
    void flight.catch(() => undefined).finally(() => {
      if (flights.get(env.win) === flight) flights.delete(env.win);
    });
  }
  return bindSignal(flight, signal);
}
