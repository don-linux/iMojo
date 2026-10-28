import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { CallbackPage } from "./connection/CallbackPage.tsx";
import { ConnectionDocs } from "./connection/ConnectionDocs.tsx";
import "./index.css";

const path = window.location.pathname.replace(/\/$/, "") || "/";
const page =
  path === "/callback" ? <CallbackPage /> : path === "/connection" ? <ConnectionDocs /> : <App />;

createRoot(document.getElementById("root")!).render(<StrictMode>{page}</StrictMode>);
