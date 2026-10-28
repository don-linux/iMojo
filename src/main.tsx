import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { openedAsLocalhost } from "./api/spotify/redirect.ts";
import { CallbackPage } from "./connection/CallbackPage.tsx";
import { ConnectionDocs } from "./connection/ConnectionDocs.tsx";
import "./index.css";

if (openedAsLocalhost()) {
  const next = new URL(window.location.href);
  next.hostname = "127.0.0.1";
  window.location.replace(next.href);
} else {
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  const page =
    path === "/callback" ? <CallbackPage /> : path === "/connection" ? <ConnectionDocs /> : <App />;

  createRoot(document.getElementById("root")!).render(<StrictMode>{page}</StrictMode>);
}
