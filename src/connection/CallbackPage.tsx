import { useEffect, useState } from "react";
import { exchangeCode, expectedAuthState, publishAuthResult } from "../api/spotify/auth.ts";
import "./connection.css";

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
    window.history.replaceState({}, "", "/callback");

    const finish = (ok: boolean, text: string) => {
      publishAuthResult(ok, ok ? undefined : text);
      setMessage(text);
      window.setTimeout(() => {
        window.close();
        if (!window.closed) window.location.replace("/");
      }, 400);
    };

    if (error) {
      finish(false, "Spotify sign-in was cancelled");
      return;
    }
    if (!code || !state || state !== expectedAuthState()) {
      finish(false, "Spotify sign-in could not be verified");
      return;
    }
    void exchangeCode(code)
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
