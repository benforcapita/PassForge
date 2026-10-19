export const INVALID_SERVER_URL = "Enter a valid http:// or https:// server URL.";
export const INSECURE_SERVER_URL =
  "Remote algorithm servers must use https:// — plain http:// is allowed for loopback only.";

const isLoopbackHost = (hostname: string) =>
  hostname === "localhost" || hostname === "[::1]" || /^127(\.\d{1,3}){3}$/.test(hostname);

/** Mirrors the backend's `normalize_server_url` policy; returns an error message or null. */
export function serverUrlError(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return INVALID_SERVER_URL;
  }
  if (!parsed.hostname) return INVALID_SERVER_URL;
  if (parsed.protocol === "https:") return null;
  if (parsed.protocol !== "http:") return INVALID_SERVER_URL;
  return isLoopbackHost(parsed.hostname) ? null : INSECURE_SERVER_URL;
}
