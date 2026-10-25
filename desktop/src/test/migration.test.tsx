import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EntrySummary, Folder, ServerInfo, Settings, VaultEntry } from "../types";

const sealedEntry: VaultEntry = {
  id: "e-sealed",
  kind: "sealed",
  profile: {
    site: "legacy.io",
    login: "carol@example.com",
    counter: 1,
    options: { lowercase: true, uppercase: true, digits: true, symbols: true, length: 16 },
    saltFields: [],
    crypto: null,
  },
  folderId: "f1",
  groupIds: [],
  tags: [],
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  lastUsedAt: null,
};

const sealedSummary: EntrySummary = {
  id: "e-sealed",
  kind: "sealed",
  site: "legacy.io",
  login: "carol@example.com",
  counter: 1,
  folderId: "f1",
  fingerprint: null,
  lastUsedAt: null,
};

const folders: Folder[] = [{ id: "f1", parentId: null, name: "Logins" }];
const serverInfo: ServerInfo = {
  protocol: "passforge-remote-v1",
  name: "PassForge test server",
  version: "1.0.0",
  default_algorithm: "argon2id-v1",
  algorithms: [{ id: "argon2id-v1", description: "Argon2id test", portable: true }],
};
const settings: Settings = {
  defaultCrypto: { iterations: 100_000, keylen: 32, digest: "sha256" },
  idleLockSeconds: 300,
  clipboardClearSeconds: 20,
  generation: { mode: "serverless" },
  knownServers: [],
};

const { state } = vi.hoisted(() => ({ state: { migrated: 0, sealed: true } }));

vi.mock("../api", () => ({
  api: {
    isLocked: vi.fn(async () => false),
    unlockWithMasterPassword: vi.fn(async () => {}),
    lock: vi.fn(async () => {}),
    createFolder: vi.fn(async () => folders[0]),
    listFolders: vi.fn(async () => folders),
    createEntry: vi.fn(async () => sealedEntry),
    getEntry: vi.fn(async () => sealedEntry),
    updateEntry: vi.fn(async () => sealedEntry),
    deleteEntry: vi.fn(async () => {}),
    previewFingerprint: vi.fn(async () => []),
    searchEntries: vi.fn(async () => (state.sealed ? [sealedSummary] : [])),
    generatePassword: vi.fn(async () => "OldPassw0rd!"),
    backendInfo: vi.fn(async () => ({ port: 0, token: "mock" })),
    getSettings: vi.fn(async () => settings),
    saveSettings: vi.fn(async (s: Settings) => s),
    serverInfo: vi.fn(async () => serverInfo),
    recordActivity: vi.fn(async () => {}),
    biometricSupported: vi.fn(async () => false),
    masterPasswordStored: vi.fn(async () => false),
    biometricUnlock: vi.fn(async () => {}),
    rememberMasterPassword: vi.fn(async () => {}),
    forgetMasterPassword: vi.fn(async () => {}),
    exportVault: vi.fn(async () => {}),
    importVault: vi.fn(async () => ({
      foldersCreated: 0, foldersSkipped: 0, entriesCreated: 0, entriesSkipped: 0,
    })),
    importPasswords: vi.fn(async () => ({
      total: 3,
      reverseMatched: 1,
      sealed: 1,
      lessPassProfiles: 0,
      skippedDuplicate: 0,
      skippedInvalid: 1,
      skipReasons: ["empty.example: no password"],
    })),
    migrationPreview: vi.fn(async () => ({ current: "OldPassw0rd!", next: "N3w-Derived-Pass" })),
    completeMigration: vi.fn(async () => {
      state.sealed = false;
      state.migrated += 1;
      return { ...sealedEntry, kind: "generated" as const };
    }),
    listSealed: vi.fn(async () => ({
      entries: state.sealed ? [sealedSummary] : [],
      migrated: state.migrated,
    })),
  },
}));

import { api } from "../api";
import { ImportModal } from "../views/ImportModal";
import { MigrationView } from "../views/MigrationView";
import { Workbench } from "../views/Workbench";

afterEach(() => {
  cleanup();
  state.sealed = true;
  state.migrated = 0;
  vi.clearAllMocks();
});

describe("ImportModal", () => {
  it("renders the import report and the delete-file warning", async () => {
    render(<ImportModal onClose={vi.fn()} onImported={vi.fn()} />);
    const input = screen.getByTestId("import-file-input") as HTMLInputElement;
    const file = new File(["name,url,username,password\n"], "export.csv", { type: "text/csv" });
    // jsdom's File lacks .text(); the component only needs the content.
    Object.defineProperty(file, "text", {
      value: async () => "name,url,username,password\n",
    });
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByText("Imported 3 credentials");
    expect(api.importPasswords).toHaveBeenCalled();
    expect(screen.getByText(/1 sealed until migration/)).toBeTruthy();
    expect(screen.getByText(/empty\.example: no password/)).toBeTruthy();
    expect(
      screen.getByText(/Delete the CSV file now — it contains your passwords in plain text\./),
    ).toBeTruthy();
  });
});

describe("MigrationView", () => {
  it("previews, confirms and completes — badge decrements", async () => {
    render(<MigrationView clipboardClearSeconds={20} onClose={vi.fn()} onChanged={vi.fn()} />);
    const row = await screen.findByTestId("migration-row");
    expect(row.textContent).toContain("carol@example.com");
    // preview loads (copy buttons appear)
    await screen.findByTestId("copy-current");
    expect(api.migrationPreview).toHaveBeenCalledWith("e-sealed");
    // confirm flow
    fireEvent.click(screen.getByTestId("migrate-confirm-start"));
    fireEvent.click(screen.getByRole("button", { name: "I changed it" }));
    await waitFor(() => expect(api.completeMigration).toHaveBeenCalledWith("e-sealed"));
    // progress flips to done
    await screen.findByText("Nothing sealed — you're done.");
    expect(screen.getByTestId("migration-count").textContent).toBe("1/1");
  });
});

describe("Workbench sealed entry", () => {
  it("shows the sealed chip and migration badge", async () => {
    render(<Workbench onLock={vi.fn()} />);
    await screen.findByTestId("migration-badge");
    fireEvent.click(screen.getByText("carol@example.com"));
    await screen.findByTestId("sealed-chip");
    expect(screen.getByText("Legacy password (sealed)")).toBeTruthy();
    fireEvent.click(screen.getByText("Migrate…"));
    await screen.findByTestId("migration-row");
  });
});
