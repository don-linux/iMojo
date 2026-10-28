import { useState } from "react";
import { copyText, openedAsLocalhost, spotifyRedirectUri } from "../api/spotify/redirect.ts";
import "./connection.css";

export function ConnectionDocs() {
  const redirect = spotifyRedirectUri();
  const [copied, setCopied] = useState(false);
  const localhost = openedAsLocalhost();

  async function copyRedirect() {
    await copyText(redirect);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <main className="connection-page">
      <article className="connection-sheet">
        <h1>Connection docs</h1>
        <p className="connection-lead">
          Create your own Spotify app, then sign in from the iPod. Spotify generates the Client ID
          after the app exists. This page never sees your Spotify password.
        </p>
        <div className="connection-uri">
          <code>{redirect}</code>
          <button type="button" onClick={() => void copyRedirect()}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        {localhost ? (
          <p>Spotify rejects localhost. Open this iPod at 127.0.0.1 with the same port.</p>
        ) : null}

        <h2>1. Developer app</h2>
        <ol>
          <li>On the iPod, open Settings, then Spotify, then Copy Redirect URI.</li>
          <li>
            Choose Create personal app. In the dashboard, choose Create app. The account that
            creates it needs Premium.
          </li>
          <li>App name and App description can be anything. Website can stay empty.</li>
          <li>
            Under Redirect URIs, paste the copied address and press Add. It must match exactly,
            including https on Vercel.
          </li>
          <li>Check Web API and Web Playback SDK. Accept the terms and create the app.</li>
          <li>
            On the next page, copy the Client ID Spotify shows. The form you just filled does not
            ask for it. Leave the Client Secret there.
          </li>
          <li>Back on the iPod, open Client ID, paste that value, and save it.</li>
        </ol>

        <h2>2. Connect</h2>
        <p>
          Connect is the Spotify login. It stays on the same Spotify screen, after the developer app
          steps.
        </p>
        <ol start={8}>
          <li>
            Press the center of the click wheel on Connect. A Spotify window opens. Sign in with
            your account and approve access.
          </li>
          <li>
            Spotify returns here. The iPod stores the session in this browser and shows the account.
            Playlists, Artists, and Songs come from that session.
          </li>
          <li>
            The same account works in every browser where you paste that Client ID and press Connect
            again. The dashboard limit is five Spotify accounts on that app, not five phones.
          </li>
        </ol>

        <div className="connection-note">
          <p>
            Without Premium you can browse the library, and playback says that Premium is required.
          </p>
          <p>
            A followed playlist you do not own can show Unavailable. Your own playlists and Liked
            Songs still open.
          </p>
          <p>
            <a className="connection-back" href="/">
              Back to iPod
            </a>
          </p>
        </div>
      </article>
    </main>
  );
}
