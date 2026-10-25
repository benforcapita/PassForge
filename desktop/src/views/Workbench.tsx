import {
  Copy,
  FolderPlus,
  Lock,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Server,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import * as backend from "../backend";
import { Button } from "../components/ui/Button";
import { CharChip } from "../components/ui/CharChip";
import { FingerprintGlyphs } from "../components/ui/FingerprintGlyphs";
import { Kbd } from "../components/ui/Kbd";
import { CounterBadge, TagPill } from "../components/ui/Pills";
import { SecretWell } from "../components/ui/SecretWell";
import { Select } from "../components/ui/Select";
import { Slider } from "../components/ui/Slider";
import { TextInput } from "../components/ui/TextInput";
import { Toast } from "../components/ui/Toast";
import { Toggle } from "../components/ui/Toggle";
import { useClipboard } from "../hooks/useClipboard";
import { useHotkeys } from "../hooks/useHotkeys";
import { useIdleLock } from "../hooks/useIdleLock";
import type {
  CryptoConfig,
  EntryInput,
  EntrySummary,
  Folder,
  PasswordOptions,
  SaltField,
  Settings,
  VaultEntry,
} from "../types";
import { DeleteEntryModal } from "./DeleteEntryModal";
import { NewProfileModal } from "./NewProfileModal";
import { ImportModal } from "./ImportModal";
import { MigrationView } from "./MigrationView";
import { PreferencesModal } from "./PreferencesModal";
import { ServersModal } from "./ServersModal";

const CHAR_SETS: { key: keyof Pick<PasswordOptions, "uppercase" | "lowercase" | "digits" | "symbols">; label: string }[] = [
  { key: "uppercase", label: "A-Z" },
  { key: "lowercase", label: "a-z" },
  { key: "digits", label: "0-9" },
  { key: "symbols", label: "!@#" },
];

const DIGESTS = ["sha256", "sha512", "sha1"] as const;

const DEFAULT_SETTINGS: Settings = {
  defaultCrypto: { iterations: 100_000, keylen: 32, digest: "sha256" },
  idleLockSeconds: 300,
  clipboardClearSeconds: 20,
  generation: { mode: "serverless" },
  knownServers: [],
};

type Draft = {
  site: string;
  login: string;
  counter: number;
  options: PasswordOptions;
  saltFields: SaltField[];
  crypto: CryptoConfig | null;
  folderId: string;
  tags: string[];
};

function draftFrom(entry: VaultEntry): Draft {
  return {
    site: entry.profile.site,
    login: entry.profile.login,
    counter: entry.profile.counter,
    options: { ...entry.profile.options },
    saltFields: entry.profile.saltFields.map((f) => ({ ...f })),
    crypto: entry.profile.crypto ? { ...entry.profile.crypto } : null,
    folderId: entry.folderId,
    tags: [...entry.tags],
  };
}

function inputFrom(entryId: string, draft: Draft): EntryInput {
  return {
    site: draft.site,
    login: draft.login,
    counter: draft.counter,
    options: draft.options,
    saltFields: draft.saltFields,
    crypto: draft.crypto,
    folderId: draft.folderId,
    groupIds: [],
    tags: draft.tags,
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function Workbench({ onLock }: { onLock: () => void }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [entries, setEntries] = useState<EntrySummary[]>([]);
  const [query, setQuery] = useState("");
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sealedCount = entries.filter((e) => e.kind === "sealed").length;
  const [detail, setDetail] = useState<VaultEntry | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [modal, setModal] = useState<
    "none" | "new" | "prefs" | "servers" | "delete" | "import" | "migration" | "migrate-entry"
  >("none");
  const [newTag, setNewTag] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);
  const be = backend.useBackend();

  const { copied, toast, copy, dismiss } = useClipboard(settings.clipboardClearSeconds);
  const handleLock = useCallback(() => {
    void api.lock().finally(() => {
      setPassword(null);
      setDetail(null);
      setDraft(null);
      onLock();
    });
  }, [onLock]);
  const { secondsUntilLock, idleWarning } = useIdleLock(settings.idleLockSeconds, handleLock);

  const refreshFolders = useCallback(async () => {
    setFolders(await api.listFolders());
  }, []);

  const refreshEntries = useCallback(async () => {
    setEntries(await api.searchEntries(query));
  }, [query]);

  useEffect(() => {
    void api.getSettings().then(setSettings).catch(() => {});
    void refreshFolders();
    // Pair with the local backend on open. The user can Disconnect from the
    // Servers panel; from then on Reveal/Copy have no way to a password.
    if (backend.backendState().status === "disconnected") void backend.connect();
  }, [refreshFolders]);

  // Losing the backend also drops any password it produced earlier.
  useEffect(() => {
    if (be.status !== "connected") setPassword(null);
  }, [be.status]);

  useEffect(() => {
    const id = window.setTimeout(() => void refreshEntries(), 150);
    return () => window.clearTimeout(id);
  }, [refreshEntries]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDraft(null);
      setPassword(null);
      setGenerationError(null);
      return;
    }
    setPassword(null);
    setGenerationError(null);
    api
      .getEntry(selectedId)
      .then((entry) => {
        setDetail(entry);
        setDraft(draftFrom(entry));
      })
      .catch(() => {
        setDetail(null);
        setDraft(null);
      });
  }, [selectedId]);

  const visibleEntries = useMemo(
    () => entries.filter((e) => !folderFilter || e.folderId === folderFilter),
    [entries, folderFilter],
  );

  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) counts.set(e.folderId, (counts.get(e.folderId) ?? 0) + 1);
    return counts;
  }, [entries]);

  const dirty = detail != null && draft != null && !sameDraft(draft, draftFrom(detail));

  const ensurePassword = useCallback(async (): Promise<string | null> => {
    if (password) return password;
    if (!detail) return null;
    setGenerationError(null);
    try {
      const generated = await backend.generate(detail.id);
      setPassword(generated);
      return generated;
    } catch (err) {
      setPassword(null);
      setGenerationError(
        err && typeof err === "object" && "message" in err
          ? String(err.message)
          : String(err),
      );
      return null;
    }
  }, [password, detail]);

  const copyPassword = useCallback(async () => {
    if (!detail) return;
    try {
      const value = await ensurePassword();
      if (value == null) return;
      await copy(value, () => setPassword(null));
    } catch (err) {
      setGenerationError(
        err && typeof err === "object" && "message" in err
          ? String(err.message)
          : String(err),
      );
    }
  }, [detail, ensurePassword, copy]);

  const copyLogin = useCallback(async () => {
    if (!detail) return;
    await navigator.clipboard.writeText(detail.profile.login);
  }, [detail]);

  const saveDraft = useCallback(async () => {
    if (!detail || !draft) return;
    const updated = await api.updateEntry(detail.id, inputFrom(detail.id, draft));
    setDetail(updated);
    setDraft(draftFrom(updated));
    setPassword(null);
    setGenerationError(null);
    await refreshEntries();
  }, [detail, draft, refreshEntries]);

  const bumpCounter = useCallback(async () => {
    if (!detail || !draft) return;
    const next = { ...draft, counter: draft.counter + 1 };
    const updated = await api.updateEntry(detail.id, inputFrom(detail.id, next));
    setDetail(updated);
    setDraft(draftFrom(updated));
    setPassword(null);
    setGenerationError(null);
    await refreshEntries();
  }, [detail, draft, refreshEntries]);

  const deleteSelected = useCallback(async () => {
    if (!detail) return;
    await api.deleteEntry(detail.id);
    setModal("none");
    setSelectedId(null);
    setPassword(null);
    setGenerationError(null);
    await refreshEntries();
  }, [detail, refreshEntries]);

  const isFormElement = (target: EventTarget | null) =>
    target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);

  useHotkeys(
    [
      { key: "k", handler: () => filterRef.current?.focus() },
      { key: "n", handler: () => setModal("new") },
      { key: ",", handler: () => setModal("prefs") },
      { key: "s", shift: true, handler: () => setModal("servers") },
      { key: "l", handler: () => handleLock() },
      {
        key: "c",
        shift: true,
        handler: (e) => {
          if (isFormElement(e.target)) return;
          void copyLogin();
        },
      },
      {
        key: "c",
        handler: (e) => {
          if (isFormElement(e.target)) return;
          void copyPassword();
        },
      },
      {
        key: "s",
        handler: (e) => {
          if (isFormElement(e.target)) return;
          void saveDraft();
        },
      },
      {
        key: "r",
        handler: (e) => {
          if (isFormElement(e.target)) return;
          void bumpCounter();
        },
      },
    ],
    modal === "none",
  );

  const activeSetCount = draft ? CHAR_SETS.filter((s) => draft.options[s.key]).length : 0;
  const algo = draft?.crypto ?? settings.defaultCrypto;
  const generationStatus =
    settings.generation.mode === "serverless"
      ? "serverless"
      : `server · ${
          (() => {
            try {
              return new URL(settings.generation.url).host;
            } catch {
              return settings.generation.url;
            }
          })()
        } · ${settings.generation.algorithm ?? "default"}`;

  return (
    <div className="flex h-full flex-col bg-pf-canvas">
      {/* TopBar */}
      <header
        data-tauri-drag-region
        className="flex h-10 shrink-0 items-center gap-3 border-b border-pf-border-subtle pl-[72px] pr-3"
      >
        <span className="text-[13px] font-semibold text-pf-text-primary">PassForge</span>
        <div className="mx-auto flex w-full max-w-md items-center">
          <div className="relative w-full">
            <Search
              size={14}
              strokeWidth={1.5}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-pf-text-muted"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search vault"
              className="h-7 w-full rounded-sm border border-pf-border-subtle bg-pf-input pl-8 pr-10 text-[13px] text-pf-text-primary placeholder:text-pf-text-muted outline-none focus:border-pf-border-focus"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2">
              <Kbd>⌘K</Kbd>
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setModal("servers")}
          title="Servers"
          aria-label={`Backend ${be.status}`}
          className={`flex h-6 items-center gap-1.5 rounded-sm border px-2 font-mono text-[11px] ${
            be.status === "connected"
              ? "border-pf-accent/40 bg-pf-accent-muted text-pf-accent"
              : be.status === "connecting"
                ? "border-pf-border-subtle text-pf-text-muted"
                : "border-pf-warning/40 bg-pf-warning-bg text-pf-warning"
          }`}
        >
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full ${
              be.status === "connected"
                ? "bg-pf-accent"
                : be.status === "connecting"
                  ? "bg-pf-text-muted animate-pulse"
                  : "bg-pf-warning"
            }`}
          />
          backend {be.status}
        </button>
        <Button
          variant="icon"
          aria-label="Lock vault"
          title="Lock vault (⌘L)"
          onClick={handleLock}
          className="w-7"
        >
          <Lock size={16} strokeWidth={1.5} />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <aside className="flex w-[220px] shrink-0 flex-col border-r border-pf-border-subtle bg-pf-base p-3">
          <nav className="flex flex-col gap-0.5">
            <button
              type="button"
              onClick={() => setFolderFilter(null)}
              className={`flex h-8 items-center justify-between rounded-sm px-2 text-[13px] ${
                folderFilter === null
                  ? "bg-pf-accent-muted font-medium text-pf-text-primary"
                  : "text-pf-text-secondary hover:bg-pf-raised hover:text-pf-text-primary"
              }`}
            >
              <span>All Entries</span>
              <span className="font-mono text-[11px] text-pf-text-muted">{entries.length}</span>
            </button>
            {folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => setFolderFilter(folder.id)}
                className={`flex h-8 items-center justify-between rounded-sm px-2 text-[13px] ${
                  folderFilter === folder.id
                    ? "bg-pf-accent-muted font-medium text-pf-text-primary"
                    : "text-pf-text-secondary hover:bg-pf-raised hover:text-pf-text-primary"
                }`}
              >
                <span className="truncate">{folder.name}</span>
                <span className="font-mono text-[11px] text-pf-text-muted">
                  {folderCounts.get(folder.id) ?? 0}
                </span>
              </button>
            ))}
            {sealedCount > 0 && (
              <button
                type="button"
                onClick={() => setModal("migration")}
                className="flex h-8 items-center justify-between rounded-sm px-2 text-[13px] text-pf-text-secondary hover:bg-pf-raised hover:text-pf-text-primary"
              >
                <span>Migration</span>
                <span
                  className="rounded-sm bg-pf-warning-bg px-1.5 font-mono text-[11px] text-pf-warning"
                  data-testid="migration-badge"
                >
                  {sealedCount}
                </span>
              </button>
            )}
            {newFolderMode ? (
              <div className="mt-1 flex gap-1">
                <TextInput
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && newFolderName.trim()) {
                      await api.createFolder({ parentId: null, name: newFolderName.trim() });
                      setNewFolderName("");
                      setNewFolderMode(false);
                      await refreshFolders();
                    } else if (e.key === "Escape") {
                      setNewFolderMode(false);
                    }
                  }}
                  placeholder="Folder name"
                  className="h-7 flex-1 text-[12px]"
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setNewFolderMode(true)}
                className="mt-1 flex h-7 items-center gap-1.5 rounded-sm px-2 text-[12px] text-pf-text-muted hover:text-pf-text-primary"
              >
                <FolderPlus size={14} strokeWidth={1.5} />
                New folder
              </button>
            )}
          </nav>

          <div className="mt-auto flex flex-col gap-1 border-t border-pf-border-subtle pt-2">
            <button
              type="button"
              onClick={() => setModal("new")}
              className="flex h-8 items-center justify-between rounded-sm bg-pf-overlay px-2 text-[12px] font-medium text-pf-text-primary hover:bg-pf-raised"
            >
              <span className="flex items-center gap-1.5">
                <Plus size={14} strokeWidth={1.5} className="text-pf-accent" />
                New Profile
              </span>
              <Kbd>⌘N</Kbd>
            </button>
            <button
              type="button"
              onClick={() => setModal("servers")}
              className="flex h-7 items-center justify-between rounded-sm px-2 text-[12px] text-pf-text-secondary hover:text-pf-text-primary"
            >
              <span className="flex items-center gap-1.5">
                <Server size={14} strokeWidth={1.5} />
                Servers
              </span>
              <Kbd>⌘⇧S</Kbd>
            </button>
            <button
              type="button"
              onClick={() => setModal("prefs")}
              className="flex h-7 items-center justify-between rounded-sm px-2 text-[12px] text-pf-text-secondary hover:text-pf-text-primary"
            >
              <span className="flex items-center gap-1.5">
                <SlidersHorizontal size={14} strokeWidth={1.5} />
                Preferences
              </span>
              <Kbd>⌘,</Kbd>
            </button>
          </div>
        </aside>

        {/* Entry list */}
        <section
          className="flex w-[320px] shrink-0 flex-col border-r border-pf-border-subtle bg-pf-base"
          onKeyDown={(e) => {
            if (!visibleEntries.length) return;
            const idx = visibleEntries.findIndex((e) => e.id === selectedId);
            if (e.key === "ArrowDown") {
              e.preventDefault();
              const next = visibleEntries[Math.min(idx + 1, visibleEntries.length - 1)] ?? visibleEntries[0];
              setSelectedId(next.id);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              const prev = visibleEntries[Math.max(idx - 1, 0)] ?? visibleEntries[0];
              setSelectedId(prev.id);
            }
          }}
        >
          <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-pf-border-subtle px-2">
            <Search size={14} strokeWidth={1.5} className="shrink-0 text-pf-text-muted" />
            <input
              ref={filterRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter entries..."
              className="h-7 w-full bg-transparent text-[13px] text-pf-text-primary placeholder:text-pf-text-muted outline-none"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {visibleEntries.length === 0 && (
              <p className="px-3 py-6 text-center text-[12px] text-pf-text-muted">
                No entries match. Create a profile with ⌘N.
              </p>
            )}
            {visibleEntries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSelectedId(entry.id)}
                className={`flex h-[54px] w-full items-center gap-3 border-b border-pf-raised px-3 py-2 text-left ${
                  entry.id === selectedId
                    ? "border-l-2 border-l-pf-accent bg-pf-accent-muted"
                    : "border-l-2 border-l-transparent hover:bg-pf-raised"
                }`}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-pf-border-subtle bg-pf-input font-mono text-[11px] font-medium text-pf-text-secondary">
                  {entry.site.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-pf-text-primary">
                    {entry.site}
                  </span>
                  <span className="block truncate text-[11px] text-pf-text-secondary">
                    {entry.login}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <FingerprintGlyphs fingers={entry.fingerprint} />
                  <CounterBadge counter={entry.counter} />
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* Detail pane */}
        <main className="min-w-[440px] flex-1 overflow-y-auto bg-pf-base p-6">
          {detail && draft ? (
            <div className="flex max-w-[720px] flex-col gap-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-[16px] font-semibold leading-[22px] tracking-[-0.015em] text-pf-text-primary">
                    {detail.profile.site}
                  </h1>
                  <p className="font-mono text-[12px] text-pf-text-secondary">{detail.profile.login}</p>
                  {detail.kind === "sealed" && (
                    <div className="mt-2 flex items-center gap-2" data-testid="sealed-chip">
                      <span className="inline-flex items-center gap-1 rounded-sm bg-pf-warning-bg px-2 py-0.5 text-[11px] font-medium text-pf-warning">
                        Legacy password (sealed)
                      </span>
                      <Button variant="ghost" className="h-7" onClick={() => setModal("migrate-entry")}>
                        Migrate…
                      </Button>
                    </div>
                  )}
                  <p className="mt-1 text-[11px] text-pf-text-muted">
                    Last used:{" "}
                    {detail.lastUsedAt ? new Date(detail.lastUsedAt).toLocaleString() : "never"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <FingerprintGlyphs
                    fingers={entries.find((e) => e.id === detail.id)?.fingerprint}
                    size={14}
                  />
                </div>
              </div>

              <section className="rounded-md border border-pf-border-moderate bg-pf-raised p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-[13px] font-medium text-pf-text-secondary">Secret</h2>
                  <button
                    type="button"
                    onClick={() => void copyPassword()}
                    className="flex items-center gap-1 text-[11px] text-pf-text-secondary hover:text-pf-text-primary"
                  >
                    <Copy size={12} strokeWidth={1.5} />
                    Copy Password <Kbd>⌘C</Kbd>
                  </button>
                </div>
                <SecretWell
                  value={password}
                  copied={copied}
                  onReveal={() => void ensurePassword()}
                  onCopy={() => void copyPassword()}
                />
                {be.status !== "connected" && (
                  <p
                    role="note"
                    data-testid="backend-gate"
                    className="mt-2 flex items-center justify-between gap-2 rounded-sm bg-pf-warning-bg px-2 py-1.5 text-[11px] text-pf-warning"
                  >
                    <span className="flex items-center gap-1">
                      <TriangleAlert size={11} strokeWidth={1.5} />
                      Backend {be.status} — this frontend cannot generate passwords.
                    </span>
                    <button
                      type="button"
                      className="font-medium underline-offset-2 hover:underline"
                      onClick={() => setModal("servers")}
                    >
                      Open Servers
                    </button>
                  </p>
                )}
                {generationError && (
                  <p role="alert" className="mt-2 text-[11px] text-pf-text-error">
                    {generationError}
                  </p>
                )}
              </section>

              <section className="rounded-md border border-pf-border-moderate bg-pf-raised p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-[13px] font-medium text-pf-text-secondary">Parameters</h2>
                  <div className="flex items-center gap-2">
                    {dirty && (
                      <span className="inline-flex items-center gap-1 rounded-sm bg-pf-warning-bg px-2 py-0.5 text-[11px] font-medium text-pf-warning">
                        <TriangleAlert size={11} strokeWidth={1.5} />
                        Unsaved parameters
                      </span>
                    )}
                    {dirty && (
                      <>
                        <Button variant="ghost" className="h-7" onClick={() => setDraft(draftFrom(detail))}>
                          <RotateCcw size={12} strokeWidth={1.5} /> Revert
                        </Button>
                        <Button className="h-7" onClick={() => void saveDraft()}>
                          <Save size={12} strokeWidth={1.5} /> Save <Kbd>⌘S</Kbd>
                        </Button>
                      </>
                    )}
                    <Button
                      variant="icon"
                      title="Bump counter (⌘R)"
                      aria-label="Bump counter"
                      onClick={() => void bumpCounter()}
                    >
                      <RefreshCw size={14} strokeWidth={1.5} className="text-pf-accent-secondary" />
                    </Button>
                    <Button
                      variant="icon"
                      title="Delete entry"
                      aria-label="Delete entry"
                      onClick={() => setModal("delete")}
                    >
                      <Trash2 size={14} strokeWidth={1.5} className="text-pf-error" />
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[13px] font-medium text-pf-text-secondary">Site</label>
                    <TextInput
                      value={draft.site}
                      onChange={(e) => setDraft({ ...draft, site: e.target.value })}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[13px] font-medium text-pf-text-secondary">Login</label>
                    <TextInput
                      value={draft.login}
                      onChange={(e) => setDraft({ ...draft, login: e.target.value })}
                      className="w-full"
                    />
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[13px] font-medium text-pf-text-secondary">Counter</label>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        className="w-9 px-0"
                        aria-label="Decrement counter"
                        onClick={() => setDraft({ ...draft, counter: Math.max(1, draft.counter - 1) })}
                      >
                        <Minus size={13} strokeWidth={1.5} />
                      </Button>
                      <span className="w-10 text-center font-mono text-[13px] text-pf-text-primary">
                        {draft.counter}
                      </span>
                      <Button
                        variant="ghost"
                        className="w-9 px-0"
                        aria-label="Increment counter"
                        onClick={() => setDraft({ ...draft, counter: draft.counter + 1 })}
                      >
                        <Plus size={13} strokeWidth={1.5} />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-[13px] font-medium text-pf-text-secondary">Folder</label>
                    <Select
                      value={draft.folderId}
                      onChange={(e) => setDraft({ ...draft, folderId: e.target.value })}
                    >
                      {folders.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                <div className="mt-3">
                  <label className="mb-1 block text-[13px] font-medium text-pf-text-secondary">
                    Length
                  </label>
                  <Slider
                    label="Length"
                    value={draft.options.length}
                    onChange={(length) => setDraft({ ...draft, options: { ...draft.options, length } })}
                  />
                </div>

                <div className="mt-3">
                  <label className="mb-1 block text-[13px] font-medium text-pf-text-secondary">
                    Character sets
                  </label>
                  <div className="flex gap-2">
                    {CHAR_SETS.map((s) => (
                      <CharChip
                        key={s.key}
                        label={s.label}
                        active={Boolean(draft.options[s.key])}
                        canDeactivate={activeSetCount > 1}
                        onToggle={() =>
                          setDraft({ ...draft, options: { ...draft.options, [s.key]: !draft.options[s.key] } })
                        }
                      />
                    ))}
                  </div>
                </div>

                <div className="mt-4">
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-[13px] font-medium text-pf-text-secondary">Salt fields</label>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({ ...draft, saltFields: [...draft.saltFields, { key: "", value: "" }] })
                      }
                      className="flex items-center gap-1 text-[11px] text-pf-text-secondary hover:text-pf-text-primary"
                    >
                      <Plus size={12} strokeWidth={1.5} /> Add field
                    </button>
                  </div>
                  {draft.saltFields.length === 0 && (
                    <p className="text-[11px] text-pf-text-muted">No salt fields.</p>
                  )}
                  {draft.saltFields.map((field, i) => (
                    <div key={i} className="mb-1.5 flex items-center gap-2">
                      <TextInput
                        value={field.key}
                        onChange={(e) => {
                          const saltFields = draft.saltFields.map((f, j) =>
                            j === i ? { ...f, key: e.target.value } : f,
                          );
                          setDraft({ ...draft, saltFields });
                        }}
                        placeholder="key"
                        className="h-7 flex-1 font-mono text-[12px]"
                      />
                      <TextInput
                        value={field.value}
                        onChange={(e) => {
                          const saltFields = draft.saltFields.map((f, j) =>
                            j === i ? { ...f, value: e.target.value } : f,
                          );
                          setDraft({ ...draft, saltFields });
                        }}
                        placeholder="value"
                        className="h-7 flex-1 font-mono text-[12px]"
                      />
                      <Button
                        variant="icon"
                        aria-label="Remove salt field"
                        onClick={() =>
                          setDraft({ ...draft, saltFields: draft.saltFields.filter((_, j) => j !== i) })
                        }
                      >
                        <Minus size={13} strokeWidth={1.5} />
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="mt-4 border-t border-pf-border-subtle pt-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[13px] font-medium text-pf-text-secondary">
                      Algorithm override
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-pf-text-muted">Use global default</span>
                      <Toggle
                        label="Use global default crypto"
                        checked={draft.crypto === null}
                        onChange={(useDefault) =>
                          setDraft({
                            ...draft,
                            crypto: useDefault ? null : { ...settings.defaultCrypto },
                          })
                        }
                      />
                    </div>
                  </div>
                  {draft.crypto !== null && (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div>
                        <label className="mb-1 block text-[11px] text-pf-text-secondary">Iterations</label>
                        <TextInput
                          type="number"
                          value={draft.crypto.iterations}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              crypto: { ...draft.crypto!, iterations: Number(e.target.value) },
                            })
                          }
                          className="w-full font-mono"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] text-pf-text-secondary">Key length</label>
                        <TextInput
                          type="number"
                          value={draft.crypto.keylen}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              crypto: { ...draft.crypto!, keylen: Number(e.target.value) },
                            })
                          }
                          className="w-full font-mono"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] text-pf-text-secondary">Digest</label>
                        <Select
                          value={draft.crypto.digest}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              crypto: {
                                ...draft.crypto!,
                                digest: e.target.value as CryptoConfig["digest"],
                              },
                            })
                          }
                        >
                          {DIGESTS.map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4">
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-[13px] font-medium text-pf-text-secondary">Tags</label>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {draft.tags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        title="Remove tag"
                        onClick={() => setDraft({ ...draft, tags: draft.tags.filter((t) => t !== tag) })}
                      >
                        <TagPill label={tag} />
                      </button>
                    ))}
                    <TextInput
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newTag.trim()) {
                          if (!draft.tags.includes(newTag.trim())) {
                            setDraft({ ...draft, tags: [...draft.tags, newTag.trim()] });
                          }
                          setNewTag("");
                        }
                      }}
                      placeholder="add tag"
                      className="h-6 w-24 font-mono text-[11px]"
                    />
                  </div>
                </div>
              </section>

              <footer className="flex items-center gap-4 text-[11px] text-pf-text-muted">
                <span className="flex items-center gap-1">
                  <Kbd>⌘C</Kbd> Copy password
                </span>
                <span className="flex items-center gap-1">
                  <Kbd>⌘⇧C</Kbd> Copy login
                </span>
                <span className="flex items-center gap-1">
                  <Kbd>⌘R</Kbd> Bump counter
                </span>
                <span className="flex items-center gap-1">
                  <Kbd>⌘L</Kbd> Lock
                </span>
              </footer>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-[13px] text-pf-text-muted">
                {entries.length === 0
                  ? "Vault is empty. Create a profile with ⌘N."
                  : "No entry selected. Select an entry or filter the list."}
              </p>
            </div>
          )}
        </main>
      </div>

      {/* Status bar */}
      <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-pf-border-subtle bg-pf-base px-3 font-mono text-[11px] text-pf-text-muted">
        <span>
          {`PBKDF2-${algo.digest.toUpperCase()} · ${algo.iterations.toLocaleString()} iter · keylen ${algo.keylen}`}
        </span>
        <span>{entries.length} {entries.length === 1 ? "entry" : "entries"}</span>
        <span>clipboard wipe {settings.clipboardClearSeconds}s</span>
        <span>{generationStatus}</span>
        <span>{be.address ? `backend ${be.address}` : `backend ${be.status}`}</span>
        <span className={idleWarning ? "ml-auto text-pf-warning" : "ml-auto"}>
          {idleWarning
            ? `idle lock in ${secondsUntilLock}s`
            : `idle lock ${secondsUntilLock}s`}
        </span>
      </footer>

      {toast && <Toast message={toast.message} countdownSeconds={toast.countdownSeconds} />}

      {modal === "new" && (
        <NewProfileModal
          folders={folders}
          onClose={() => setModal("none")}
          onCreated={() => {
            void refreshEntries();
            void refreshFolders();
          }}
        />
      )}
      {modal === "prefs" && (
        <PreferencesModal
          settings={settings}
          onClose={() => setModal("none")}
          onSaved={setSettings}
          onVaultChanged={() => {
            void refreshEntries();
            void refreshFolders();
          }}
        />
      )}
      {modal === "import" && (
        <ImportModal
          onClose={() => setModal("none")}
          onImported={() => {
            void refreshEntries();
            void refreshFolders();
          }}
        />
      )}
      {modal === "migration" && (
        <MigrationView
          clipboardClearSeconds={settings.clipboardClearSeconds}
          onClose={() => setModal("none")}
          onChanged={() => void refreshEntries()}
        />
      )}
      {modal === "migrate-entry" && detail && (
        <MigrationView
          clipboardClearSeconds={settings.clipboardClearSeconds}
          entryId={detail.id}
          onClose={() => setModal("none")}
          onChanged={() => {
            void refreshEntries();
            void api.getEntry(detail.id).then(setDetail).catch(() => {});
          }}
        />
      )}
      {modal === "servers" && (
        <ServersModal
          settings={settings}
          onClose={() => setModal("none")}
          onSaved={(next) => {
            setSettings(next);
            setPassword(null);
          }}
        />
      )}
      {modal === "delete" && detail && (
        <DeleteEntryModal
          site={detail.profile.site}
          onCancel={() => setModal("none")}
          onConfirm={() => void deleteSelected()}
        />
      )}
    </div>
  );
}
