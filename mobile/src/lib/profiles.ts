import type { PasswordOptions } from "passforge-protocol";
import { readJson, writeJson, type KeyValueStore } from "./storage";

/** Generation parameters only — never a password or the master password. */
export type SavedProfile = PasswordOptions & {
  id: string;
  site: string;
  login: string;
  counter: number;
};

const KEY = "passforge.profiles";

export function loadProfiles(store: KeyValueStore): Promise<SavedProfile[]> {
  return readJson<SavedProfile[]>(store, KEY, []);
}

/** Upserts by site + login (case-insensitive). */
export async function saveProfile(
  store: KeyValueStore,
  profile: Omit<SavedProfile, "id">,
): Promise<SavedProfile[]> {
  const site = profile.site.trim();
  const login = profile.login.trim();
  if (!site) throw new Error("site is required");
  const same = (p: SavedProfile) =>
    p.site.toLowerCase() === site.toLowerCase() && p.login.toLowerCase() === login.toLowerCase();
  const profiles = await loadProfiles(store);
  const existing = profiles.find(same);
  const next: SavedProfile = { ...profile, site, login, id: existing?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}` };
  const list = [...profiles.filter((p) => !same(p)), next].sort((a, b) => a.site.localeCompare(b.site));
  await writeJson(store, KEY, list);
  return list;
}

export async function deleteProfile(store: KeyValueStore, id: string): Promise<SavedProfile[]> {
  const list = (await loadProfiles(store)).filter((p) => p.id !== id);
  await writeJson(store, KEY, list);
  return list;
}
