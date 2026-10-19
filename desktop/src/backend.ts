// Connection to the local PassForge backend (the loopback HTTP API embedded
// in the app process). The desktop UI is a *client* of that backend: password
// generation goes over HTTP here, not over IPC, so when this module is
// disconnected the UI has no way to produce a password — same severance the
// browser extension lives under.
//
// Outside Tauri (Vite dev in a browser, vitest) there is no HTTP backend;
// the transport then routes to the in-memory mock so the UI stays testable.

import { isTauri } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import { api } from "./api";

export type BackendStatus = "disconnected" | "connecting" | "connected" | "unreachable";

export type BackendState = {
  status: BackendStatus;
  /** `127.0.0.1:<port>` once discovered. */
  address: string | null;
  version: string | null;
  error: string | null;
};

export class BackendDisconnectedError extends Error {
  constructor() {
    super("Not connected to the PassForge backend. Open Servers to connect.");
    this.name = "BackendDisconnectedError";
  }
}

type Creds = { url: string; token: string };

let creds: Creds | null = null;
let state: BackendState = { status: "disconnected", address: null, version: null, error: null };
const listeners = new Set<() => void>();

function set(next: Partial<BackendState>) {
  state = { ...state, ...next };
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useBackend(): BackendState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export function backendState(): BackendState {
  return state;
}

export function isConnected(): boolean {
  return state.status === "connected";
}

const errText = (err: unknown) =>
  err && typeof err === "object" && "message" in err ? String(err.message) : String(err);

async function http<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  if (!creds || state.status !== "connected") throw new BackendDisconnectedError();
  const method = init?.method ?? (init?.body === undefined ? "GET" : "POST");
  const res = await fetch(`${creds.url}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${creds.token}`,
      ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `backend error ${res.status}`);
  return data;
}

/** Pair with the running backend (port + token via IPC) and probe health. */
export async function connect(): Promise<boolean> {
  set({ status: "connecting", error: null });
  try {
    const info = await api.backendInfo();
    const candidate = { url: `http://127.0.0.1:${info.port}`, token: info.token };
    let version = "mock";
    if (isTauri()) {
      const res = await fetch(`${candidate.url}/api/health`, {
        headers: { authorization: `Bearer ${candidate.token}` },
      });
      if (!res.ok) throw new Error(`health check failed (${res.status})`);
      version = String(((await res.json()) as { version?: string }).version ?? "?");
    }
    creds = candidate;
    set({ status: "connected", address: `127.0.0.1:${info.port}`, version, error: null });
    return true;
  } catch (err) {
    creds = null;
    set({ status: "unreachable", version: null, error: errText(err) });
    return false;
  }
}

/** Drop credentials. From here on nothing in the UI can generate. */
export function disconnect() {
  creds = null;
  set({ status: "disconnected", version: null, error: null });
}

/** `POST /api/entries/{id}/generate` — the UI's only route to a password. */
export async function generate(entryId: string): Promise<string> {
  if (!isConnected()) throw new BackendDisconnectedError();
  if (!isTauri()) return api.generatePassword(entryId);
  const { password } = await http<{ password: string }>(
    `/api/entries/${encodeURIComponent(entryId)}/generate`,
    { method: "POST" },
  );
  return password;
}
