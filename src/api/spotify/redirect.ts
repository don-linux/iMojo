export function spotifyRedirectUri(location: Location = window.location) {
  const hostname = location.hostname === "localhost" ? "127.0.0.1" : location.hostname;
  const port = location.port ? `:${location.port}` : "";
  return `${location.protocol}//${hostname}${port}/callback`;
}

export function openedAsLocalhost(location: Location = window.location) {
  return location.hostname === "localhost";
}

export async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}
