// Real backend client — runs inside the service worker, which owns pairing.
// Frontend pages (popup, autofill frame) never see the token; they call
// these through `api.ts`'s message RPC. The architecture rule holds: the
// extension contains no derivation code — every password comes from
// http://127.0.0.1 served by the PassForge app.
//
// Credentials live in chrome.storage.session: they survive service-worker
// restarts and are wiped when the browser exits. The *intent* to be
// connected persists in chrome.storage.local as before; on a cold start the
// SW re-pairs lazily on first need.

import * as host from "./host";

export type Creds = { url: string; token: string };

export type Finger = { icon: string; color: string };

export type BackendStatus = "disconnected" | "connecting" | "connected" | "unreachable";

export type Backend = {
  status: BackendStatus;
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

export type EntrySummary = {
  id: string;
  kind?: "generated" | "sealed";
  site: string;
  login: string;
  counter: number;
  folderId: string;
  fingerprint?: Finger[] | null;
  lastUsedAt?: string | null;
};

export type EntryInput = {
  site: string;
  login: string;
  counter: number;
  options: {
    lowercase: boolean;
    uppercase: boolean;
    digits: boolean;
    symbols: boolean;
    length: number;
  };
  saltFields: unknown[];
  crypto: unknown | null;
  folderId: string;
  groupIds: string[];
  tags: string[];
};

export type Health = { version?: string; locked?: boolean };

// lesspass-core's PasswordProfile wire shape flattens `options` into the
// profile and uses snake_case for `salt_fields`.
function toWireProfile(p: WireProfile) {
  return { ...p, salt_fields: [] };
}

const INTENT_KEY = "backendIntent";
const CREDS_KEY = "pf:creds";

/** Whether the user last chose to be connected to the backend. */
export async function savedIntent(): Promise<"connected" | "disconnected"> {
  const stored = await chrome.storage.local.get(INTENT_KEY);
  return stored[INTENT_KEY] === "connected" ? "connected" : "disconnected";
}

async function saveIntent(intent: "connected" | "disconnected") {
  await chrome.storage.local.set({ [INTENT_KEY]: intent });
}

async function loadCreds(): Promise<Creds | null> {
  const stored = await chrome.storage.session.get(CREDS_KEY);
  return (stored[CREDS_KEY] as Creds | undefined) ?? null;
}

async function storeCreds(creds: Creds | null) {
  if (creds) await chrome.storage.session.set({ [CREDS_KEY]: creds });
  else await chrome.storage.session.remove(CREDS_KEY);
}

/** Credentials for the next API call, re-pairing lazily when the intent says
 * the user is connected (e.g. first call after a service-worker restart). */
export async function ensureCreds(): Promise<Creds | null> {
  const existing = await loadCreds();
  if (existing) return existing;
  if ((await savedIntent()) !== "connected") return null;
  const next = await connect();
  return next.status === "connected" ? loadCreds() : null;
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
  await storeCreds(null);
  try {
    const info = await host.apiInfo();
    const candidate = { url: `http://127.0.0.1:${info.port}`, token: info.token };
    const res = await fetch(`${candidate.url}/api/health`, {
      headers: { authorization: `Bearer ${candidate.token}` },
    });
    if (!res.ok) throw new Error(`health check failed (${res.status})`);
    const health = (await res.json()) as Health;
    await storeCreds(candidate);
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
  await storeCreds(null);
  await saveIntent("disconnected");
  return { status: "disconnected", address: null, version: null, locked: null, error: null };
}

export async function connected(): Promise<boolean> {
  return (await loadCreds()) !== null;
}

/** Lock-state probe used by the badge. Null when disconnected/unreachable. */
export async function health(): Promise<Health | null> {
  const creds = await ensureCreds();
  if (!creds) return null;
  try {
    const res = await fetch(`${creds.url}/api/health`, {
      headers: { authorization: `Bearer ${creds.token}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as Health;
  } catch {
    return null;
  }
}

export async function call<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const creds = await ensureCreds();
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
export async function passkeyCreate(body: unknown): Promise<Record<string, unknown>> {
  return call("/api/passkeys/create", body, "POST");
}
export async function passkeyCandidates(body: unknown): Promise<Record<string, unknown>[]> {
  return call("/api/passkeys/candidates", body, "POST");
}
export async function passkeyGet(body: unknown): Promise<Record<string, unknown>> {
  return call("/api/passkeys/get", body, "POST");
}
export async function listPasskeys(): Promise<Record<string, unknown>[]> {
  return call("/api/passkeys");
}
export async function deletePasskey(id: string): Promise<void> {
  await call(`/api/passkeys/${id}`, undefined, "DELETE");
}
export async function migrationPreview(entryId: string): Promise<{ current: string; next: string }> {
  return call(`/api/entries/${entryId}/migration-preview`, undefined, "POST");
}

export async function migrate(entryId: string): Promise<unknown> {
  return call(`/api/entries/${entryId}/migrate`, undefined, "POST");
}

export async function serverInfo(url: string): Promise<ServerInfo> {
  return call<ServerInfo>("/api/server-info", { url });
}

/** Entries matching a page URL — the SW is the only place this is called. */
export async function autofill(url: string): Promise<EntrySummary[]> {
  return call<EntrySummary[]>(`/api/autofill?url=${encodeURIComponent(url)}`);
}

/** Password for a vault entry via the unlocked app session. */
export async function generateEntry(entryId: string): Promise<string> {
  const { password } = await call<{ password: string }>(
    `/api/entries/${encodeURIComponent(entryId)}/generate`,
    undefined,
    "POST",
  );
  return password;
}

export async function createEntry(input: EntryInput): Promise<{ id: string }> {
  return call<{ id: string }>("/api/entries", input);
}
