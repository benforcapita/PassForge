import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EntrySummary,
  Folder,
  ImportReport,
  ServerInfo,
  Settings,
  VaultEntry,
} from "../types";

vi.mock("../api", () => {
  const entry: VaultEntry = {
    id: "e1",
    profile: {
      site: "github.com",
      login: "dev@passforge.io",
      counter: 2,
      options: { lowercase: true, uppercase: true, digits: true, symbols: true, length: 16 },
      saltFields: [],
      crypto: null,
    },
    folderId: "f1",
    groupIds: [],
    tags: ["dev"],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    lastUsedAt: null,
  };
  const summary: EntrySummary = {
    id: "e1",
    site: "github.com",
    login: "dev@passforge.io",
    counter: 2,
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
    algorithms: [
      { id: "argon2id-v1", description: "Argon2id test", portable: true },
      { id: "pbkdf2-sha512-v1", description: "PBKDF2 test", portable: true },
      { id: "hmac-pepper-v1", description: "Pepper test", portable: false },
    ],
  };
  const settings: Settings = {
    defaultCrypto: { iterations: 100_000, keylen: 32, digest: "sha256" },
    idleLockSeconds: 300,
    clipboardClearSeconds: 20,
    generation: { mode: "serverless" },
  };
  return {
    api: {
      isLocked: vi.fn(async () => false),
      unlockWithMasterPassword: vi.fn(async (_pw: string) => {}),
      lock: vi.fn(async () => {}),
      createFolder: vi.fn(async (input: { name: string }) => ({
        id: "f-new",
        parentId: null,
        name: input.name,
      })),
      listFolders: vi.fn(async () => folders),
      createEntry: vi.fn(async () => entry),
      getEntry: vi.fn(async () => entry),
      updateEntry: vi.fn(async () => entry),
      deleteEntry: vi.fn(async () => {}),
      previewFingerprint: vi.fn(async () => []),
      searchEntries: vi.fn(async () => [summary]),
      generatePassword: vi.fn(async () => "S3cret-Value!"),
      getSettings: vi.fn(async () => settings),
      saveSettings: vi.fn(async (s: Settings) => s),
      serverInfo: vi.fn(async (_url: string) => serverInfo),
      recordActivity: vi.fn(async () => {}),
      biometricSupported: vi.fn(async () => false),
      masterPasswordStored: vi.fn(async () => false),
      biometricUnlock: vi.fn(async () => {}),
      rememberMasterPassword: vi.fn(async () => {}),
      forgetMasterPassword: vi.fn(async () => {}),
      exportVault: vi.fn(async (_path: string) => {}),
      importVault: vi.fn(async (_path: string): Promise<ImportReport> => ({
        foldersCreated: 0,
        foldersSkipped: 0,
        entriesCreated: 0,
        entriesSkipped: 0,
      })),
    },
  };
});

import { api } from "../api";
import { LockScreen } from "../views/LockScreen";
import { Workbench } from "../views/Workbench";
import { CharChip } from "../components/ui/CharChip";

const settingsFixture: Settings = {
  defaultCrypto: { iterations: 100_000, keylen: 32, digest: "sha256" },
  idleLockSeconds: 300,
  clipboardClearSeconds: 20,
  generation: { mode: "serverless" },
};
const entryFixture: VaultEntry = {
  id: "e1",
  profile: {
    site: "github.com",
    login: "dev@passforge.io",
    counter: 2,
    options: { lowercase: true, uppercase: true, digits: true, symbols: true, length: 16 },
    saltFields: [],
    crypto: null,
  },
  folderId: "f1",
  groupIds: [],
  tags: ["dev"],
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  lastUsedAt: null,
};
const summaryFixture: EntrySummary = {
  id: "e1",
  site: "github.com",
  login: "dev@passforge.io",
  counter: 2,
  folderId: "f1",
  fingerprint: null,
  lastUsedAt: null,
};
const foldersFixture: Folder[] = [{ id: "f1", parentId: null, name: "Logins" }];
const serverInfoFixture: ServerInfo = {
  protocol: "passforge-remote-v1",
  name: "PassForge test server",
  version: "1.0.0",
  default_algorithm: "argon2id-v1",
  algorithms: [
    { id: "argon2id-v1", description: "Argon2id test", portable: true },
    { id: "pbkdf2-sha512-v1", description: "PBKDF2 test", portable: true },
    { id: "hmac-pepper-v1", description: "Pepper test", portable: false },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.isLocked).mockResolvedValue(false);
  vi.mocked(api.unlockWithMasterPassword).mockResolvedValue(undefined);
  vi.mocked(api.lock).mockResolvedValue(undefined);
  vi.mocked(api.createFolder).mockResolvedValue({
    id: "f-new",
    parentId: null,
    name: "New folder",
  });
  vi.mocked(api.listFolders).mockResolvedValue(foldersFixture);
  vi.mocked(api.createEntry).mockResolvedValue(entryFixture);
  vi.mocked(api.getEntry).mockResolvedValue(entryFixture);
  vi.mocked(api.updateEntry).mockResolvedValue(entryFixture);
  vi.mocked(api.deleteEntry).mockResolvedValue(undefined);
  vi.mocked(api.previewFingerprint).mockResolvedValue([]);
  vi.mocked(api.searchEntries).mockResolvedValue([summaryFixture]);
  vi.mocked(api.generatePassword).mockResolvedValue("S3cret-Value!");
  vi.mocked(api.getSettings).mockResolvedValue(settingsFixture);
  vi.mocked(api.saveSettings).mockImplementation(async (settings) => settings);
  vi.mocked(api.serverInfo).mockResolvedValue(serverInfoFixture);
  vi.mocked(api.recordActivity).mockResolvedValue(undefined);
  vi.mocked(api.biometricSupported).mockResolvedValue(false);
  vi.mocked(api.masterPasswordStored).mockResolvedValue(false);
  vi.mocked(api.biometricUnlock).mockResolvedValue(undefined);
  vi.mocked(api.rememberMasterPassword).mockResolvedValue(undefined);
  vi.mocked(api.forgetMasterPassword).mockResolvedValue(undefined);
  vi.mocked(api.exportVault).mockResolvedValue(undefined);
  vi.mocked(api.importVault).mockResolvedValue({
    foldersCreated: 0,
    foldersSkipped: 0,
    entriesCreated: 0,
    entriesSkipped: 0,
  });
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: vi.fn(async () => {}),
      readText: vi.fn(async () => "S3cret-Value!"),
    },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("LockScreen", () => {
  it("submits master password and unlocks", async () => {
    const onUnlock = vi.fn();
    render(<LockScreen onUnlock={onUnlock} />);
    fireEvent.change(screen.getByPlaceholderText("Master password"), {
      target: { value: "hunter2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock Vault" }));
    await waitFor(() => expect(api.unlockWithMasterPassword).toHaveBeenCalledWith("hunter2"));
    await waitFor(() => expect(onUnlock).toHaveBeenCalled());
  });

  it("shows inline error on unlock rejection", async () => {
    vi.mocked(api.unlockWithMasterPassword).mockRejectedValueOnce({
      message: "Authentication failed. Master key does not match local vault signature.",
    });
    render(<LockScreen onUnlock={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("Master password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock Vault" }));
    await screen.findByText(
      "Authentication failed. Master key does not match local vault signature.",
    );
  });

  it("offers Touch ID when supported and a password is stored", async () => {
    vi.mocked(api.biometricSupported).mockResolvedValue(true);
    vi.mocked(api.masterPasswordStored).mockResolvedValue(true);
    const onUnlock = vi.fn();
    render(<LockScreen onUnlock={onUnlock} />);
    fireEvent.click(await screen.findByRole("button", { name: /Unlock with Touch ID/ }));
    await waitFor(() => expect(api.biometricUnlock).toHaveBeenCalled());
    await waitFor(() => expect(onUnlock).toHaveBeenCalled());
  });

  it("offers remember-on-this-Mac when supported but nothing stored", async () => {
    vi.mocked(api.biometricSupported).mockResolvedValue(true);
    vi.mocked(api.masterPasswordStored).mockResolvedValue(false);
    const onUnlock = vi.fn();
    render(<LockScreen onUnlock={onUnlock} />);
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.change(screen.getByPlaceholderText("Master password"), {
      target: { value: "hunter2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock Vault" }));
    await waitFor(() => expect(onUnlock).toHaveBeenCalled());
    await waitFor(() => expect(api.rememberMasterPassword).toHaveBeenCalled());
  });
});

describe("Workbench", () => {
  it("lists entries; selecting one does not call generatePassword", async () => {
    render(<Workbench onLock={vi.fn()} />);
    fireEvent.click(await screen.findByText("github.com"));
    await waitFor(() => expect(api.getEntry).toHaveBeenCalledWith("e1"));
    expect(api.generatePassword).not.toHaveBeenCalled();
  });

  it("copy generates password, writes clipboard, shows toast, wipes after timeout", async () => {
    render(<Workbench onLock={vi.fn()} />);
    fireEvent.click(await screen.findByText("github.com"));
    await waitFor(() => expect(api.getEntry).toHaveBeenCalled());

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.generatePassword).toHaveBeenCalledWith("e1");
    const writeText = vi.mocked(navigator.clipboard.writeText);
    expect(writeText).toHaveBeenCalledWith("S3cret-Value!");
    expect(screen.getByText(/Password copied to clipboard/)).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(20_000);
    expect(writeText).toHaveBeenCalledWith("");
  });

  it("wipe leaves the clipboard alone if the user copied something else", async () => {
    render(<Workbench onLock={vi.fn()} />);
    fireEvent.click(await screen.findByText("github.com"));
    await waitFor(() => expect(api.getEntry).toHaveBeenCalled());

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
    await vi.advanceTimersByTimeAsync(0);

    // user copies something else before the timer fires
    vi.mocked(navigator.clipboard.readText).mockResolvedValue("something-else");
    const writeText = vi.mocked(navigator.clipboard.writeText);
    writeText.mockClear();

    await vi.advanceTimersByTimeAsync(20_000);
    expect(writeText).not.toHaveBeenCalledWith("");
  });

  it("shows the configured server in the status bar", async () => {
    vi.mocked(api.getSettings).mockResolvedValue({
      ...settingsFixture,
      generation: {
        mode: "server",
        url: "http://localhost:8787/",
        algorithm: "pbkdf2-sha512-v1",
      },
    });
    render(<Workbench onLock={vi.fn()} />);

    expect(await screen.findByText("server · localhost:8787 · pbkdf2-sha512-v1")).toBeInTheDocument();
  });

  it("surfaces generation failures without displaying a password", async () => {
    vi.mocked(api.generatePassword).mockRejectedValueOnce(
      new Error("algorithm server unreachable"),
    );
    render(<Workbench onLock={vi.fn()} />);
    fireEvent.click(await screen.findByText("github.com"));
    await waitFor(() => expect(api.getEntry).toHaveBeenCalledWith("e1"));
    fireEvent.click(screen.getByRole("button", { name: "Copy password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("algorithm server unreachable");
    expect(screen.queryByText("S3cret-Value!")).not.toBeInTheDocument();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalledWith("S3cret-Value!");
  });
});

describe("PreferencesModal generation mode", () => {
  const openPreferences = async () => {
    render(<Workbench onLock={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Preferences/ }));
  };

  it("tests a server connection and renders its algorithm options", async () => {
    await openPreferences();
    fireEvent.click(screen.getByText("Algorithm server"));
    fireEvent.change(screen.getByLabelText("Server URL"), {
      target: { value: "http://localhost:8787" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await screen.findByText("PassForge test server · 1.0.0");
    expect(api.serverInfo).toHaveBeenCalledWith("http://localhost:8787");
    expect(
      screen.getByRole("option", { name: /^argon2id-v1.*Argon2id test$/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /pbkdf2-sha512-v1.*PBKDF2 test/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /hmac-pepper-v1.*server-bound/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Algorithm"), {
      target: { value: "hmac-pepper-v1" },
    });
    expect(
      screen.getByText("Only this server can reproduce these passwords."),
    ).toBeInTheDocument();
  });

  it("saves the selected server algorithm", async () => {
    await openPreferences();
    fireEvent.click(screen.getByText("Algorithm server"));
    fireEvent.change(screen.getByLabelText("Server URL"), {
      target: { value: "http://localhost:8787" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await screen.findByText("PassForge test server · 1.0.0");
    fireEvent.change(screen.getByLabelText("Algorithm"), {
      target: { value: "pbkdf2-sha512-v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));

    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith({
        defaultCrypto: { iterations: 100_000, keylen: 32, digest: "sha256" },
        idleLockSeconds: 300,
        clipboardClearSeconds: 20,
        generation: {
          mode: "server",
          url: "http://localhost:8787",
          algorithm: "pbkdf2-sha512-v1",
        },
      }),
    );
  });

  it("saves serverless mode explicitly", async () => {
    await openPreferences();
    fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));

    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith({
        defaultCrypto: { iterations: 100_000, keylen: 32, digest: "sha256" },
        idleLockSeconds: 300,
        clipboardClearSeconds: 20,
        generation: { mode: "serverless" },
      }),
    );
  });

  it("blocks saving server mode without a valid URL", async () => {
    await openPreferences();
    fireEvent.click(screen.getByText("Algorithm server"));
    fireEvent.change(screen.getByLabelText("Server URL"), {
      target: { value: "not-a-url" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));

    expect(await screen.findByText("Enter a valid http:// or https:// server URL.")).toBeInTheDocument();
    expect(api.saveSettings).not.toHaveBeenCalled();
  });
});

describe("DeleteEntryModal", () => {
  it("keeps confirm disabled until DELETE is typed", async () => {
    const onConfirm = vi.fn();
    const { DeleteEntryModal } = await import("../views/DeleteEntryModal");
    render(<DeleteEntryModal site="github.com" onCancel={vi.fn()} onConfirm={onConfirm} />);

    const confirm = screen.getByRole("button", { name: "Delete Entry" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("DELETE"), { target: { value: "DELETE" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalled();
  });
});

describe("fingerprintIcon", () => {
  const ALL_FINGERPRINT_ICONS = [
    "fa-hashtag", "fa-heart", "fa-hotel", "fa-university", "fa-plug",
    "fa-ambulance", "fa-bus", "fa-car", "fa-plane", "fa-rocket", "fa-ship",
    "fa-subway", "fa-truck", "fa-jpy", "fa-eur", "fa-btc", "fa-usd", "fa-gbp",
    "fa-archive", "fa-area-chart", "fa-bed", "fa-beer", "fa-bell",
    "fa-binoculars", "fa-birthday-cake", "fa-bomb", "fa-briefcase", "fa-bug",
    "fa-camera", "fa-cart-plus", "fa-certificate", "fa-coffee", "fa-cloud",
    "fa-comment", "fa-cube", "fa-cutlery", "fa-database", "fa-diamond",
    "fa-exclamation-circle", "fa-eye", "fa-flag", "fa-flask", "fa-futbol-o",
    "fa-gamepad", "fa-graduation-cap",
  ];

  it("maps every LessPass fa-* icon to a defined non-fallback lucide component", async () => {
    const { fingerprintIcon } = await import("../components/ui/FingerprintGlyphs");
    const { Circle } = await import("lucide-react");
    expect(ALL_FINGERPRINT_ICONS).toHaveLength(45);
    for (const name of ALL_FINGERPRINT_ICONS) {
      const icon = fingerprintIcon(name);
      expect(icon, name).toBeDefined();
      expect(icon, name).not.toBe(Circle);
    }
  });
});

describe("CharChip", () => {
  it("prevents deactivating the last active set", () => {
    const onToggle = vi.fn();
    render(<CharChip label="A-Z" active canDeactivate={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: "A-Z" }));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("toggles when other sets remain active", () => {
    const onToggle = vi.fn();
    render(<CharChip label="A-Z" active canDeactivate onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: "A-Z" }));
    expect(onToggle).toHaveBeenCalled();
  });
});
