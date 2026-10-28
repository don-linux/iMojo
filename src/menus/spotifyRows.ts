import type { MenuData, Row } from "./types.ts";

function spotifyStatusLabel(status: MenuData["connection"]["status"]) {
  if (status === "setup") return "Setup required";
  if (status === "connecting") return "Connecting…";
  if (status === "connected") return "Connected";
  if (status === "error") return "Error";
  return "Not connected";
}

export function spotifyRows(connection: MenuData["connection"]): Row[] {
  const base: Row[] = [
    {
      id: "spotify-status",
      title: "Status",
      value: spotifyStatusLabel(connection.status),
      action: "info",
    },
    { id: "spotify-source", title: "Source", value: connection.sourceLabel, action: "info" },
    {
      id: "spotify-account",
      title: "Account",
      value: connection.account ?? "—",
      action: "info",
    },
  ];
  const setup: Row[] = [
    {
      id: "spotify-copy-redirect",
      title: "Copy Redirect URI",
      value: connection.redirectCopied ? "Copied" : undefined,
      action: "spotify-copy-redirect",
    },
    {
      id: "spotify-create-app",
      title: "Create personal app",
      action: "spotify-create-app",
    },
    { id: "spotify-docs", title: "Connection docs", action: "spotify-docs" },
    {
      id: "spotify-client-id",
      title: "Client ID",
      value: connection.status === "setup" ? "Not set" : "Saved",
      action: "spotify-client-id",
    },
  ];
  const actions: Row[] =
    connection.status === "connected"
      ? [
          { id: "spotify-refresh", title: "Refresh Library", action: "spotify-refresh" },
          { id: "spotify-disconnect", title: "Disconnect", action: "spotify-disconnect" },
        ]
      : [{ id: "spotify-connect", title: "Connect", action: "spotify-connect" }];
  if (connection.error) {
    actions.push({
      id: "spotify-error",
      title: "Error",
      value: connection.error,
      action: "info",
    });
  }
  return [...base, ...setup, ...actions];
}
