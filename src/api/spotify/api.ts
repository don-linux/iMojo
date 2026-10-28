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

type SpotifyErrorBody = {
  error?: { status?: number; message?: string } | string;
  error_description?: string;
};

function errorMessage(body: SpotifyErrorBody | null, status: number) {
  if (!body) return `Spotify request failed (${status})`;
  if (typeof body.error === "string") return body.error_description || body.error;
  return body.error?.message || `Spotify request failed (${status})`;
}

function retryDelay(header: string | null) {
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  return 1000;
}

export async function spotifySend(
  method: "GET" | "PUT" | "POST",
  url: string,
  token: string,
  body?: unknown,
  attempt = 0,
): Promise<Response> {
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(body);
  }
  const response = await fetch(url, init);
  if (response.status === 429 && attempt < 4) {
    await new Promise((resolve) =>
      setTimeout(resolve, retryDelay(response.headers.get("Retry-After"))),
    );
    return spotifySend(method, url, token, body, attempt + 1);
  }
  if (response.status === 401) {
    throw new SpotifySessionError("Spotify session expired. Connect again.");
  }
  if (!response.ok) {
    let parsed: SpotifyErrorBody | null = null;
    try {
      parsed = (await response.json()) as SpotifyErrorBody;
    } catch {
      parsed = null;
    }
    const message = errorMessage(parsed, response.status);
    if (response.status === 403 && /premium/i.test(message)) {
      throw new SpotifyRequestError(response.status, "Spotify Premium is required to play");
    }
    throw new SpotifyRequestError(response.status, message);
  }
  return response;
}

export async function spotifyJson<T>(url: string, token: string): Promise<T> {
  const response = await spotifySend("GET", url, token);
  if (response.status === 204) return null as T;
  return (await response.json()) as T;
}

export async function collectPages<T>(url: string, token: () => Promise<string>): Promise<T[]> {
  const items: T[] = [];
  let next: string | null = url;
  while (next) {
    const page: { items?: T[]; next?: string | null } = await spotifyJson(next, await token());
    items.push(...(page.items ?? []));
    next = page.next ?? null;
  }
  return items;
}
