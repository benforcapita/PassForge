// Client for the local PassForge backend API (http://127.0.0.1, served by the
// desktop app process). The extension is severed from the algorithm by
// design: it contains no derivation code — generation and fingerprints are
// API calls. If the extension is not connected to the backend, it cannot
// generate. Period.
//
// Pairing goes through the native host (`api_info` op): it reads the
// api-info.json/api-token files the app writes into the vault dir, so the
// extension never needs the token typed in by hand.
//
// The *intent* to be connected is persisted (chrome.storage.local) so the
// popup — which is torn down every time it closes — comes back in the state
// the user left it: disconnected until they connect once, connected after.

import * as host from "./host";

type Creds = { url: string; token: string };
let creds: Creds | null = null;

export type Finger = { icon: string; color: string };

export type BackendStatus = "disconnected" | "connecting" | "connected" | "unreachable";

export type Backend = {
  status: BackendStatus;
  /** `127.0.0.1:<port>` once discovered. */
  address: string | null;
  version: string | null;
  locked: boolean | null;
  error: string | null;
};

export type GenerationMode =
  | { mode: "serverless" }
  | { mode: "server"; url: string; algorithm: string | null };

export type Settings = {
  defaultCrypto: { iterations: number; keylen: number; digest: string };
  idleLockSeconds: number;
  clipboardClearSeconds: number;
  generation: GenerationMode;
  knownServers: string[];
};

export type ServerInfo = {
  protocol: string;
  name: string;
  version: string;
  default_algorithm: string;
  algorithms: { id: string; description: string; portable: boolean }[];
};

export type WireProfile = {
  site: string;
  login: string;
  counter: number;
  lowercase: boolean;
  uppercase: boolean;
  digits: boolean;
  symbols: boolean;
  length: number;
};

// lesspass-core's PasswordProfile wire shape flattens `options` into the
// profile and uses snake_case for `salt_fields`.
function toWireProfile(p: WireProfile) {
  return { ...p, salt_fields: [] };
}

const INTENT_KEY = "backendIntent";

/** Whether the user last chose to be connected to the backend. */
export async function savedIntent(): Promise<"connected" | "disconnected"> {
  const stored = await chrome.storage.local.get(INTENT_KEY);
  return stored[INTENT_KEY] === "connected" ? "connected" : "disconnected";
}

async function saveIntent(intent: "connected" | "disconnected") {
  await chrome.storage.local.set({ [INTENT_KEY]: intent });
}

/** Where the backend would be, without connecting (for the Servers tab). */
export async function discover(): Promise<{ address: string } | null> {
  try {
    const info = await host.apiInfo();
    return { address: `127.0.0.1:${info.port}` };
  } catch {
    return null;
  }
}

/** Pairs with the running app, probes the API and records the intent. */
export async function connect(): Promise<Backend> {
  creds = null;
  try {
    const info = await host.apiInfo();
    const candidate = { url: `http://127.0.0.1:${info.port}`, token: info.token };
    const res = await fetch(`${candidate.url}/api/health`, {
      headers: { authorization: `Bearer ${candidate.token}` },
    });
    if (!res.ok) throw new Error(`health check failed (${res.status})`);
    const health = (await res.json()) as { version?: string; locked?: boolean };
    creds = candidate;
    await saveIntent("connected");
    return {
      status: "connected",
      address: `127.0.0.1:${info.port}`,
      version: health.version ?? null,
      locked: health.locked ?? null,
      error: null,
    };
  } catch (e) {
    return {
      status: "unreachable",
      address: null,
      version: null,
      locked: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Drops credentials and records the intent. Nothing can generate after this. */
export async function disconnect(): Promise<Backend> {
  creds = null;
  await saveIntent("disconnected");
  return { status: "disconnected", address: null, version: null, locked: null, error: null };
}

export function connected(): boolean {
  return creds !== null;
}

async function call<T>(path: string, body?: unknown, method?: string): Promise<T> {
  if (!creds) throw new Error("Not connected to the PassForge backend. Open Servers to connect.");
  const res = await fetch(`${creds.url}${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      authorization: `Bearer ${creds.token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `api error ${res.status}`);
  return data as T;
}

export async function generate(profile: WireProfile, masterPassword: string): Promise<string> {
  const { password } = await call<{ password: string }>("/api/generate", {
    masterPassword,
    profile: toWireProfile(profile),
  });
  return password;
}

export async function fingerprint(masterPassword: string): Promise<Finger[]> {
  return call<Finger[]>("/api/fingerprint", { masterPassword });
}

/** Backend settings (requires the app to be unlocked). */
export async function getSettings(): Promise<Settings> {
  return call<Settings>("/api/settings");
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  return call<Settings>("/api/settings", settings, "PUT");
}

/** Probe an algorithm server *through* the backend (we can't reach it ourselves). */
export async function serverInfo(url: string): Promise<ServerInfo> {
  return call<ServerInfo>("/api/server-info", { url });
}
