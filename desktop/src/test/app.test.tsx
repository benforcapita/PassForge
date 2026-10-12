import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntrySummary, Folder, Settings, VaultEntry } from "../types";

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
  const settings: Settings = {
    defaultCrypto: { iterations: 100_000, keylen: 32, digest: "sha256" },
    idleLockSeconds: 300,
    clipboardClearSeconds: 20,
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
    },
  };
});

import { api } from "../api";
import { LockScreen } from "../views/LockScreen";
import { Workbench } from "../views/Workbench";
import { CharChip } from "../components/ui/CharChip";

beforeEach(() => {
  vi.clearAllMocks();
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
