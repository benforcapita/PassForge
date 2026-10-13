import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  EntryInput,
  EntrySummary,
  Finger,
  Folder,
  FolderInput,
  ImportReport,
  Settings,
  VaultEntry,
} from "./types";

/** Wire shape of `VaultEntry.profile`: lesspass-core flattens `options`
 * into the profile and keeps `salt_fields` snake_case. */
type WireProfile = Omit<VaultEntry["profile"], "options" | "saltFields" | "crypto"> &
  VaultEntry["profile"]["options"] & {
    salt_fields?: VaultEntry["profile"]["saltFields"];
    crypto?: VaultEntry["profile"]["crypto"];
  };
type WireEntry = Omit<VaultEntry, "profile"> & { profile: WireProfile };

export function fromWireEntry(entry: WireEntry): VaultEntry {
  const { site, login, counter, lowercase, uppercase, digits, symbols, length, salt_fields, crypto } =
    entry.profile;
  return {
    ...entry,
    profile: {
      site,
      login,
      counter,
      options: { lowercase, uppercase, digits, symbols, length },
      saltFields: salt_fields ?? [],
      crypto: crypto ?? null,
    },
  };
}

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
  biometricSupported: () => Promise<boolean>;
  masterPasswordStored: () => Promise<boolean>;
  biometricUnlock: () => Promise<void>;
  rememberMasterPassword: () => Promise<void>;
  forgetMasterPassword: () => Promise<void>;
  exportVault: (path: string) => Promise<void>;
  importVault: (path: string) => Promise<ImportReport>;
};

const tauriApi: Api = {
  isLocked: () => invoke<boolean>("is_locked"),
  recordActivity: () => invoke<void>("record_activity"),
  unlockWithMasterPassword: (masterPassword: string) =>
    invoke<void>("unlock_with_master_password", { masterPassword }),
  lock: () => invoke<void>("lock"),
  createFolder: (input: FolderInput) => invoke<Folder>("create_folder", { input }),
  listFolders: () => invoke<Folder[]>("list_folders"),
  createEntry: (input: EntryInput) =>
    invoke<WireEntry>("create_entry", { input }).then(fromWireEntry),
  getEntry: (entryId: string) => invoke<WireEntry>("get_entry", { entryId }).then(fromWireEntry),
  updateEntry: (entryId: string, input: EntryInput) =>
    invoke<WireEntry>("update_entry", { entryId, input }).then(fromWireEntry),
  deleteEntry: (entryId: string) => invoke<void>("delete_entry", { entryId }),
  previewFingerprint: (masterPassword: string) =>
    invoke<Finger[]>("preview_fingerprint", { masterPassword }),
  searchEntries: (query: string) => invoke<EntrySummary[]>("search_entries", { query }),
  generatePassword: (entryId: string) => invoke<string>("generate_password", { entryId }),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  biometricSupported: () => invoke<boolean>("biometric_supported"),
  masterPasswordStored: () => invoke<boolean>("master_password_stored"),
  biometricUnlock: () => invoke<void>("biometric_unlock"),
  rememberMasterPassword: () => invoke<void>("remember_master_password"),
  forgetMasterPassword: () => invoke<void>("forget_master_password"),
  exportVault: (path: string) => invoke<void>("export_vault", { path }),
  importVault: (path: string) => invoke<ImportReport>("import_vault", { path }),
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
