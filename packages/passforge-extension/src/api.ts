// Thin RPC client — same names the popup/ServersTab always called, but the
// real implementation now lives in the service worker
// (src/backend-client.ts), which owns pairing, credentials and every
// password-bearing call. This file only forwards messages.

import type {
  Backend,
  EntrySummary,
  Finger,
  ServerInfo,
  Settings,
  WireProfile,
} from "./backend-client";

export type {
  Backend,
  BackendStatus,
  EntryInput,
  EntrySummary,
  Finger,
  GenerationMode,
  ServerInfo,
  Settings,
  WireProfile,
} from "./backend-client";

async function rpc<T>(method: string, ...args: unknown[]): Promise<T> {
  const res = (await chrome.runtime.sendMessage({
    type: "pf:rpc",
    method,
    args,
  })) as { ok: boolean; result?: T; error?: string };
  if (res?.ok) return res.result as T;
  throw new Error(res?.error ?? "PassForge backend call failed");
}

export async function savedIntent(): Promise<"connected" | "disconnected"> {
  return rpc("savedIntent");
}

export async function discover(): Promise<{ address: string } | null> {
  return rpc("discover");
}

export async function connect(): Promise<Backend> {
  return rpc("connect");
}

export async function disconnect(): Promise<Backend> {
  return rpc("disconnect");
}

export async function generate(profile: WireProfile, masterPassword: string): Promise<string> {
  return rpc("generate", profile, masterPassword);
}

export async function fingerprint(masterPassword: string): Promise<Finger[]> {
  return rpc("fingerprint", masterPassword);
}

export async function getSettings(): Promise<Settings> {
  return rpc("getSettings");
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  return rpc("saveSettings", settings);
}

export async function serverInfo(url: string): Promise<ServerInfo> {
  return rpc("serverInfo", url);
}

export async function autofill(url: string): Promise<EntrySummary[]> {
  return rpc("autofill", url);
}
