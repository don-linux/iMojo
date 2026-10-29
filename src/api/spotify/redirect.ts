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
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // The async clipboard API rejects without a gesture; the legacy path can still work.
  }
  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  } catch {
    return false;
  }
}
