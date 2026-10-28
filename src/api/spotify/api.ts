const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RATE_ATTEMPTS = 4;
const MAX_PAGES = 200;
const MAX_RETRY_WAIT_MS = 30_000;
const DEFAULT_RETRY_WAIT_MS = 1_000;

export class SpotifyRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "SpotifyRequestError";
    this.status = status;
  }
}

export class SpotifySessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpotifySessionError";
  }
}

export class SpotifyNetworkError extends Error {
  constructor(message = "You appear to be offline. Check the connection and try again.") {
    super(message);
    this.name = "SpotifyNetworkError";
  }
}

export class SpotifyRateLimitError extends SpotifyRequestError {
  constructor(message = "Spotify is rate limiting requests. Wait a moment and try again.") {
    super(429, message);
    this.name = "SpotifyRateLimitError";
  }
}

type SpotifyErrorObject = { status?: number; message?: string; reason?: string };

type SpotifyErrorBody = {
  error?: SpotifyErrorObject | string;
  error_description?: string;
};

type TokenRefresh = (options?: { force?: boolean }) => Promise<string>;

let refreshAccess: TokenRefresh | null = null;

export function bindAccessTokenRefresh(refresh: TokenRefresh) {
  refreshAccess = refresh;
}

function freshToken(force: boolean) {
  if (!refreshAccess) return Promise.reject(new SpotifySessionError("Connect Spotify to play"));
  return refreshAccess(force ? { force: true } : {});
}

function errorMessage(body: SpotifyErrorBody | null, status: number) {
  if (!body) return `Spotify request failed (${status})`;
  if (typeof body.error === "string") return body.error_description || body.error;
  return body.error?.message || `Spotify request failed (${status})`;
}

function premiumDenied(body: SpotifyErrorBody | null, message: string) {
  return (
    (typeof body?.error === "object" && body.error?.reason === "PREMIUM_REQUIRED") ||
    /premium/i.test(message)
  );
}

export function parseRetryAfter(header: string | null, now = Date.now()) {
  if (!header) return DEFAULT_RETRY_WAIT_MS;
  const value = header.trim();
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return DEFAULT_RETRY_WAIT_MS;
}

export function retryDelayMs(header: string | null, now = Date.now(), random = Math.random()) {
  const unit = Math.max(0, Math.min(1, random));
  return Math.min(MAX_RETRY_WAIT_MS, parseRetryAfter(header, now) + Math.floor(unit * 250));
}

function signalError(signal: AbortSignal) {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signalError(signal);
}

function isAbortError(reason: unknown): reason is Error {
  return reason instanceof Error && (reason.name === "AbortError" || reason.name === "TimeoutError");
}

function timeoutError() {
  if (typeof DOMException === "function") {
    return new DOMException("The operation timed out", "TimeoutError");
  }
  const error = new Error("The operation timed out");
  error.name = "TimeoutError";
  return error;
}

function startTimeout(ms: number) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return { signal: AbortSignal.timeout(ms) as AbortSignal, cancel: () => {} };
  }
  if (typeof AbortController === "undefined") return { signal: undefined, cancel: () => {} };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(timeoutError()), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

function openRequestSignal(parent?: AbortSignal) {
  const timeout = startTimeout(REQUEST_TIMEOUT_MS);
  if (parent && timeout.signal && typeof AbortSignal.any === "function") {
    return { signal: AbortSignal.any([parent, timeout.signal]), cancel: timeout.cancel };
  }
  if (!parent) return { signal: timeout.signal, cancel: timeout.cancel };
  if (!timeout.signal) return { signal: parent, cancel: timeout.cancel };
  const controller = new AbortController();
  const abortFrom = (source: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(source.reason);
  };
  const onParent = () => abortFrom(parent);
  const onTimeout = () => abortFrom(timeout.signal!);
  if (parent.aborted) abortFrom(parent);
  else parent.addEventListener("abort", onParent, { once: true });
  if (timeout.signal.aborted) abortFrom(timeout.signal);
  else timeout.signal.addEventListener("abort", onTimeout, { once: true });
  return {
    signal: controller.signal,
    cancel: () => {
      timeout.cancel();
      parent.removeEventListener("abort", onParent);
      timeout.signal?.removeEventListener("abort", onTimeout);
    },
  };
}

function transportError(reason: unknown, signal?: AbortSignal) {
  if (isAbortError(reason)) return reason;
  if (signal?.aborted) return signalError(signal);
  if (reason instanceof TypeError) return new SpotifyNetworkError();
  if (reason instanceof Error) return reason;
  return new SpotifyNetworkError();
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signalError(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signalError(signal!));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function readBody(response: Response): Promise<SpotifyErrorBody | null> {
  try {
    return (await response.json()) as SpotifyErrorBody;
  } catch {
    return null;
  }
}

async function rateLimitError(response: Response) {
  const detail = errorMessage(await readBody(response), response.status);
  if (detail.startsWith("Spotify request failed")) return new SpotifyRateLimitError();
  return new SpotifyRateLimitError(`Spotify is rate limiting requests. ${detail}`);
}

async function httpError(response: Response) {
  const parsed = await readBody(response);
  const message = errorMessage(parsed, response.status);
  if (response.status === 403 && premiumDenied(parsed, message)) {
    return new SpotifyRequestError(403, "Spotify Premium is required to play");
  }
  return new SpotifyRequestError(response.status, message);
}

function requestInit(
  method: "GET" | "PUT" | "POST",
  token: string,
  body: unknown,
  signal?: AbortSignal,
): RequestInit {
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  const init: RequestInit = { method, headers, signal };
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(body);
  }
  return init;
}

export async function spotifySend(
  method: "GET" | "PUT" | "POST",
  url: string,
  token: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  let bearer = token;
  let refreshed = false;
  let rateAttempts = 0;
  for (;;) {
    throwIfAborted(signal);
    const deadline = openRequestSignal(signal);
    let response: Response;
    try {
      response = await fetch(url, requestInit(method, bearer, body, deadline.signal));
    } catch (reason) {
      throw transportError(reason, deadline.signal);
    } finally {
      deadline.cancel();
    }
    if (response.status === 401) {
      if (refreshed) throw new SpotifySessionError("Spotify session expired. Connect again.");
      refreshed = true;
      bearer = await freshToken(true);
      continue;
    }
    if (response.status === 429) {
      throwIfAborted(signal);
      if (rateAttempts >= MAX_RATE_ATTEMPTS) throw await rateLimitError(response);
      rateAttempts += 1;
      await sleep(retryDelayMs(response.headers.get("Retry-After")), signal);
      bearer = await freshToken(false);
      continue;
    }
    if (!response.ok) throw await httpError(response);
    return response;
  }
}

export async function spotifyJson<T>(url: string, token: string, signal?: AbortSignal): Promise<T> {
  const response = await spotifySend("GET", url, token, undefined, signal);
  if (response.status === 204) return null as T;
  return (await response.json()) as T;
}

export function getJson<T>(url: string, token: string, signal?: AbortSignal): Promise<T> {
  return spotifyJson<T>(url, token, signal);
}

export async function collectPages<T>(
  url: string,
  token: () => Promise<string>,
  signal?: AbortSignal,
): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let next: string | null = url;
  let pages = 0;
  while (next) {
    if (seen.has(next) || pages >= MAX_PAGES) break;
    seen.add(next);
    pages += 1;
    throwIfAborted(signal);
    const page: { items?: T[] | null; next?: string | null } | null = await spotifyJson(
      next,
      await token(),
      signal,
    );
    if (!page) break;
    if (page.items?.length) items.push(...page.items);
    next = page.next ?? null;
  }
  return items;
}
