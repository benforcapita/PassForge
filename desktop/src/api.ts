import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  EntryInput,
  EntrySummary,
  Finger,
  Folder,
  FolderInput,
  Settings,
  VaultEntry,
} from "./types";

export type Api = {
  isLocked: () => Promise<boolean>;
  unlockWithMasterPassword: (masterPassword: string) => Promise<void>;
  lock: () => Promise<void>;
  createFolder: (input: FolderInput) => Promise<Folder>;
  listFolders: () => Promise<Folder[]>;
  createEntry: (input: EntryInput) => Promise<VaultEntry>;
  getEntry: (entryId: string) => Promise<VaultEntry>;
  updateEntry: (entryId: string, input: EntryInput) => Promise<VaultEntry>;
  deleteEntry: (entryId: string) => Promise<void>;
  previewFingerprint: (masterPassword: string) => Promise<Finger[]>;
  searchEntries: (query: string) => Promise<EntrySummary[]>;
  generatePassword: (entryId: string) => Promise<string>;
  getSettings: () => Promise<Settings>;
  saveSettings: (settings: Settings) => Promise<Settings>;
  recordActivity: () => Promise<void>;
};

const tauriApi: Api = {
  isLocked: () => invoke<boolean>("is_locked"),
  recordActivity: () => invoke<void>("record_activity"),
  unlockWithMasterPassword: (masterPassword: string) =>
    invoke<void>("unlock_with_master_password", { masterPassword }),
  lock: () => invoke<void>("lock"),
  createFolder: (input: FolderInput) => invoke<Folder>("create_folder", { input }),
  listFolders: () => invoke<Folder[]>("list_folders"),
  createEntry: (input: EntryInput) => invoke<VaultEntry>("create_entry", { input }),
  getEntry: (entryId: string) => invoke<VaultEntry>("get_entry", { entryId }),
  updateEntry: (entryId: string, input: EntryInput) =>
    invoke<VaultEntry>("update_entry", { entryId, input }),
  deleteEntry: (entryId: string) => invoke<void>("delete_entry", { entryId }),
  previewFingerprint: (masterPassword: string) =>
    invoke<Finger[]>("preview_fingerprint", { masterPassword }),
  searchEntries: (query: string) => invoke<EntrySummary[]>("search_entries", { query }),
  generatePassword: (entryId: string) => invoke<string>("generate_password", { entryId }),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
};

async function resolveApi(): Promise<Api> {
  if (import.meta.env.DEV && !isTauri()) {
    const mod = await import("./api-mock");
    return mod.mockApi;
  }
  return tauriApi;
}

const apiPromise = resolveApi();

export const api: Api = new Proxy({} as Api, {
  get(_target, prop: keyof Api) {
    return (...args: unknown[]) =>
      apiPromise.then((impl) => (impl[prop] as (...a: unknown[]) => unknown)(...args));
  },
});
