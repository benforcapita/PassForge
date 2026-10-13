// Client for the local PassForge backend API (http://127.0.0.1, served by the
// desktop app process). The extension is severed from the algorithm by
// design: it contains no derivation code — generation and fingerprints are
// API calls. If the app isn't running, the extension can't generate.
//
// Pairing goes through the native host (`api_info` op): it reads the
// api-info.json/api-token files the app writes into the vault dir, so the
// extension never needs the token typed in by hand.

import * as host from "./host";

type Creds = { url: string; token: string };
let creds: Creds | null = null;

export type Finger = { icon: string; color: string };

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

/** Pairs with the running app and probes the API. False = app not running. */
export async function connect(): Promise<boolean> {
  creds = null;
  try {
    const info = await host.apiInfo();
    const candidate = { url: `http://127.0.0.1:${info.port}`, token: info.token };
    const res = await fetch(`${candidate.url}/api/health`, {
      headers: { authorization: `Bearer ${candidate.token}` },
    });
    if (res.ok) creds = candidate;
  } catch {
    /* offline */
  }
  return creds !== null;
}

export function connected(): boolean {
  return creds !== null;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  if (!creds) throw new Error("PassForge app is not running");
  const res = await fetch(`${creds.url}${path}`, {
    method: body === undefined ? "GET" : "POST",
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
