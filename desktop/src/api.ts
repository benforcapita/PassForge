import { invoke } from "@tauri-apps/api/core";
import type { EntryInput, EntrySummary, Folder, FolderInput, Settings, VaultEntry } from "./types";

export const api = {
  isLocked: () => invoke<boolean>("is_locked"),
  unlockWithMasterPassword: (masterPassword: string) =>
    invoke<void>("unlock_with_master_password", { masterPassword }),
  lock: () => invoke<void>("lock"),
  createFolder: (input: FolderInput) => invoke<Folder>("create_folder", { input }),
  createEntry: (input: EntryInput) => invoke<VaultEntry>("create_entry", { input }),
  searchEntries: (query: string) => invoke<EntrySummary[]>("search_entries", { query }),
  generatePassword: (entryId: string) => invoke<string>("generate_password", { entryId }),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
};
