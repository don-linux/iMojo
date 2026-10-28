import { useEffect, useState } from "react";
import { exchangeCode, expectedAuthState, publishAuthResult } from "../api/spotify/auth.ts";
import "./connection.css";

// Module scope so StrictMode's remounted effect does not exchange the code twice.
let exchangeStarted = false;

export function CallbackPage() {
  const [message, setMessage] = useState("Signing in to Spotify…");

  useEffect(() => {
    if (exchangeStarted) return;
    exchangeStarted = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error");
    const description = params.get("error_description");
    window.history.replaceState({}, "", "/callback");

    const finish = (ok: boolean, text: string) => {
      publishAuthResult(ok, ok ? undefined : text, state ?? undefined);
      setMessage(text);
      window.setTimeout(() => {
        window.close();
        if (!window.closed) window.location.replace("/");
      }, 400);
    };

    if (error) {
      finish(false, description?.trim() || "Spotify sign-in was cancelled");
      return;
    }
    if (!code || !state || state !== expectedAuthState()) {
      finish(false, "Spotify sign-in could not be verified");
      return;
    }
    void withExchangeLock(code, () => exchangeCode(code))
      .then(() => finish(true, "Signed in. You can return to the iPod."))
      .catch((reason: unknown) => {
        const text = reason instanceof Error ? reason.message : "Spotify sign-in failed";
        finish(false, text);
      });
  }, []);

  return (
    <main className="connection-status">
      <p>{message}</p>
    </main>
  );
}

function withExchangeLock(code: string, task: () => Promise<void>) {
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) return task();
  return locks.request(`ipod.spotify.exchange:${code}`, task);
}
