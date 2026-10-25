// HTTP side of passforge-remote-v1. URL rule mirrors
// desktop/src-tauri/src/remote.rs `normalize_server_url`.

export type AlgorithmInfo = { id: string; description: string; portable: boolean };

export type ServerInfo = {
  protocol: string;
  name: string;
  version: string;
  default_algorithm: string;
  algorithms: AlgorithmInfo[];
};

export type DeriveResponse = { algorithm: string; output: string };

const PROTOCOL = "passforge-remote-v1";

function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "::1" || /^127\.\d+\.\d+\.\d+$/.test(host);
}

export function normalizeServerUrl(url: string): string {
  const normalized = url.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("algorithm server URL must be a valid http:// or https:// URL");
  }
  if (parsed.protocol === "https:" && parsed.hostname) return normalized;
  if (parsed.protocol === "http:" && parsed.hostname) {
    if (isLoopback(parsed.hostname)) return normalized;
    throw new Error(
      "algorithm servers must use https:// (plain http:// is allowed for loopback only)",
    );
  }
  throw new Error("algorithm server URL must be a valid http:// or https:// URL");
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `algorithm server error ${res.status}`);
  return body as T;
}

export async function info(url: string): Promise<ServerInfo> {
  const result = await request<ServerInfo>(`${normalizeServerUrl(url)}/v1/info`);
  if (result.protocol !== PROTOCOL) {
    throw new Error(`not a ${PROTOCOL} server (protocol: ${String(result.protocol)})`);
  }
  return result;
}

export async function derive(
  url: string,
  algorithm: string | null,
  inputHex: string,
): Promise<DeriveResponse> {
  const result = await request<DeriveResponse>(`${normalizeServerUrl(url)}/v1/derive`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ algorithm, input: inputHex }),
  });
  if (typeof result.output !== "string" || !/^([0-9a-fA-F]{2}){32,}$/.test(result.output)) {
    throw new Error("algorithm server returned invalid output");
  }
  return result;
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
