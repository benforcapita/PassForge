import { info as probeInfo, normalizeServerUrl, type ServerInfo } from "passforge-protocol";
import { readJson, writeJson, type KeyValueStore } from "./storage";

export type KnownServer = { url: string; info: ServerInfo };
export type ActiveServer = { url: string; algorithm: string | null };
export type ServerState = { servers: KnownServer[]; active: ActiveServer | null };

const KEY = "passforge.servers";
const EMPTY: ServerState = { servers: [], active: null };

export function loadServers(store: KeyValueStore): Promise<ServerState> {
  return readJson(store, KEY, EMPTY);
}

async function save(store: KeyValueStore, state: ServerState): Promise<ServerState> {
  await writeJson(store, KEY, state);
  return state;
}

/** Probes the server (must speak passforge-remote-v1) before remembering it. */
export async function addServer(
  store: KeyValueStore,
  rawUrl: string,
  probe: (url: string) => Promise<ServerInfo> = probeInfo,
): Promise<ServerState> {
  const url = normalizeServerUrl(rawUrl);
  const info = await probe(url);
  const state = await loadServers(store);
  const servers = [...state.servers.filter((s) => s.url !== url), { url, info }];
  return save(store, { servers, active: state.active ?? { url, algorithm: info.default_algorithm } });
}

export async function useServer(store: KeyValueStore, active: ActiveServer): Promise<ServerState> {
  const state = await loadServers(store);
  if (!state.servers.some((s) => s.url === active.url)) throw new Error("unknown server");
  return save(store, { ...state, active });
}

export async function removeServer(store: KeyValueStore, url: string): Promise<ServerState> {
  const state = await loadServers(store);
  return save(store, {
    servers: state.servers.filter((s) => s.url !== url),
    active: state.active?.url === url ? null : state.active,
  });
}
