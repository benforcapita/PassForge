import { useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { Select } from "../components/ui/Select";
import { TextInput } from "../components/ui/TextInput";
import type { GenerationMode, ServerInfo, Settings } from "../types";

type Props = {
  settings: Settings;
  onClose: () => void;
  onSaved: (settings: Settings) => void;
  onVaultChanged?: () => void;
};

const DIGESTS = ["sha256", "sha512", "sha1"] as const;

export function PreferencesModal({ settings, onClose, onSaved, onVaultChanged }: Props) {
  const initialGeneration = settings.generation ?? { mode: "serverless" as const };
  const [iterations, setIterations] = useState(String(settings.defaultCrypto.iterations));
  const [keylen, setKeylen] = useState(String(settings.defaultCrypto.keylen));
  const [digest, setDigest] = useState(settings.defaultCrypto.digest);
  const [idleLockSeconds, setIdleLockSeconds] = useState(String(settings.idleLockSeconds));
  const [clipboardClearSeconds, setClipboardClearSeconds] = useState(
    String(settings.clipboardClearSeconds),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [vaultMsg, setVaultMsg] = useState<string | null>(null);
  const [vaultBusy, setVaultBusy] = useState(false);
  const [generationMode, setGenerationMode] = useState<GenerationMode["mode"]>(
    initialGeneration.mode,
  );
  const [serverUrl, setServerUrl] = useState(
    initialGeneration.mode === "server" ? initialGeneration.url : "",
  );
  const [algorithm, setAlgorithm] = useState<string | null>(
    initialGeneration.mode === "server" ? initialGeneration.algorithm : null,
  );
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [testingServer, setTestingServer] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const JSON_FILTER = { name: "JSON", extensions: ["json"] };

  const errText = (err: unknown) =>
    err && typeof err === "object" && "message" in err ? String(err.message) : String(err);

  const testConnection = async () => {
    setServerInfo(null);
    setServerError(null);
    setTestingServer(true);
    try {
      setServerInfo(await api.serverInfo(serverUrl));
    } catch (err) {
      setServerError(errText(err));
    } finally {
      setTestingServer(false);
    }
  };

  const doExport = async () => {
    setVaultMsg(null);
    setError(null);
    setVaultBusy(true);
    try {
      if (isTauri()) {
        const path = await saveDialog({
          defaultPath: "passforge-export.json",
          filters: [JSON_FILTER],
        });
        if (!path) return;
        await api.exportVault(path);
        setVaultMsg(`Exported to ${path}`);
      } else {
        await api.exportVault("");
        setVaultMsg("Exported passforge-export.json");
      }
    } catch (err) {
      setError(errText(err));
    } finally {
      setVaultBusy(false);
    }
  };

  const runImport = async (pathOrJson: string) => {
    const report = await api.importVault(pathOrJson);
    setVaultMsg(
      `Imported ${report.entriesCreated} entries + ${report.foldersCreated} folders` +
        (report.entriesSkipped || report.foldersSkipped
          ? ` (${report.entriesSkipped + report.foldersSkipped} already present)`
          : ""),
    );
    onVaultChanged?.();
  };

  const doImport = async () => {
    setVaultMsg(null);
    setError(null);
    if (isTauri()) {
      setVaultBusy(true);
      try {
        const picked = await open({ filters: [JSON_FILTER], multiple: false });
        if (!picked || Array.isArray(picked)) return;
        await runImport(picked);
      } catch (err) {
        setError(errText(err));
      } finally {
        setVaultBusy(false);
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  const onImportFile = async (file: File | undefined) => {
    if (!file) return;
    setVaultBusy(true);
    try {
      await runImport(await file.text());
    } catch (err) {
      setError(errText(err));
    } finally {
      setVaultBusy(false);
    }
  };

  const save = async () => {
    const generation: GenerationMode =
      generationMode === "serverless"
        ? { mode: "serverless" }
        : { mode: "server", url: serverUrl.trim(), algorithm };
    if (generation.mode === "server") {
      try {
        const parsedUrl = new URL(generation.url);
        if (
          (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
          !parsedUrl.hostname
        ) {
          throw new Error();
        }
      } catch {
        setError("Enter a valid http:// or https:// server URL.");
        return;
      }
    }
    const parsed: Settings = {
      defaultCrypto: {
        iterations: Number(iterations),
        keylen: Number(keylen),
        digest,
      },
      idleLockSeconds: Number(idleLockSeconds),
      clipboardClearSeconds: Number(clipboardClearSeconds),
      generation,
      knownServers: settings.knownServers ?? [],
    };
    if (!Number.isFinite(parsed.defaultCrypto.iterations) || parsed.defaultCrypto.iterations <= 0) {
      setError("Iterations must be a positive integer.");
      return;
    }
    if (!Number.isFinite(parsed.defaultCrypto.keylen) || parsed.defaultCrypto.keylen <= 0) {
      setError("Key length must be a positive integer.");
      return;
    }
    setBusy(true);
    try {
      const saved = await api.saveSettings(parsed);
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err && typeof err === "object" && "message" in err ? String(err.message) : String(err));
      setBusy(false);
    }
  };

  const remoteHttpWarning = (() => {
    try {
      const parsedUrl = new URL(serverUrl.trim());
      return (
        parsedUrl.protocol === "http:" &&
        !["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsedUrl.hostname)
      );
    } catch {
      return false;
    }
  })();
  const selectedAlgorithm = serverInfo?.algorithms.find((item) => item.id === algorithm);

  return (
    <Modal
      title="Preferences"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            Save Settings
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <section className="flex flex-col gap-2.5">
          <p className="text-[11px] uppercase tracking-[0.02em] text-pf-text-muted">
            Password generation
          </p>
          <div
            role="group"
            aria-label="Password generation"
            className="grid grid-cols-2 overflow-hidden rounded-sm border border-pf-border-subtle"
          >
            <button
              type="button"
              aria-pressed={generationMode === "serverless"}
              onClick={() => setGenerationMode("serverless")}
              className={`border-r border-pf-border-subtle px-3 py-2 text-left transition-colors ${
                generationMode === "serverless"
                  ? "bg-pf-accent-muted text-pf-text-primary"
                  : "bg-pf-base text-pf-text-secondary hover:bg-pf-raised"
              }`}
            >
              <span className="block text-[13px] font-medium">Serverless</span>
              <span className="mt-0.5 block text-[11px] text-pf-text-muted">
                Built-in LessPass algorithm. Nothing leaves this device.
              </span>
            </button>
            <button
              type="button"
              aria-pressed={generationMode === "server"}
              onClick={() => setGenerationMode("server")}
              className={`px-3 py-2 text-left transition-colors ${
                generationMode === "server"
                  ? "bg-pf-accent-muted text-pf-text-primary"
                  : "bg-pf-base text-pf-text-secondary hover:bg-pf-raised"
              }`}
            >
              <span className="block text-[13px] font-medium">Algorithm server</span>
              <span className="mt-0.5 block text-[11px] text-pf-text-muted">
                Choose a stateless remote algorithm.
              </span>
            </button>
          </div>

          {generationMode === "server" && (
            <div className="flex flex-col gap-2">
              <div>
                <label
                  htmlFor="algorithm-server-url"
                  className="mb-1 block text-[13px] font-medium text-pf-text-secondary"
                >
                  Server URL
                </label>
                <div className="flex gap-2">
                  <TextInput
                    id="algorithm-server-url"
                    value={serverUrl}
                    onChange={(e) => {
                      setServerUrl(e.target.value);
                      setServerInfo(null);
                      setServerError(null);
                    }}
                    placeholder="https://algorithm.example"
                    className="min-w-0 flex-1 font-mono"
                  />
                  <Button
                    variant="ghost"
                    onClick={() => void testConnection()}
                    disabled={testingServer}
                  >
                    {testingServer ? "Testing…" : "Test connection"}
                  </Button>
                </div>
              </div>
              {serverInfo && (
                <p role="status" className="text-[11px] text-pf-accent">
                  {serverInfo.name} · {serverInfo.version}
                </p>
              )}
              {serverError && (
                <p role="alert" className="text-[11px] text-pf-text-error">
                  {serverError}
                </p>
              )}
              <div>
                <label
                  htmlFor="algorithm-server-algorithm"
                  className="mb-1 block text-[13px] font-medium text-pf-text-secondary"
                >
                  Algorithm
                </label>
                <Select
                  id="algorithm-server-algorithm"
                  value={algorithm ?? ""}
                  onChange={(e) => setAlgorithm(e.target.value || null)}
                  className="font-mono"
                >
                  {serverInfo ? (
                    <>
                      <option value="">
                        Server default ({serverInfo.default_algorithm})
                      </option>
                      {serverInfo.algorithms.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.id} — {item.description}
                          {!item.portable ? " · server-bound" : ""}
                        </option>
                      ))}
                    </>
                  ) : (
                    <option value={algorithm ?? ""}>
                      {algorithm ?? "Server default"}
                    </option>
                  )}
                </Select>
              </div>
              <p className="text-[11px] leading-relaxed text-pf-text-muted">
                The server receives one blinded hash per password — never your site, login, master
                password, settings, or the generated password. Changing server or algorithm changes
                every generated password.
              </p>
              {remoteHttpWarning && (
                <p role="note" className="text-[11px] text-pf-warning">
                  Use HTTPS for remote servers.
                </p>
              )}
              {selectedAlgorithm?.portable === false && (
                <p role="note" className="text-[11px] text-pf-warning">
                  Only this server can reproduce these passwords.
                </p>
              )}
            </div>
          )}
        </section>

        <p className="text-[11px] uppercase tracking-[0.02em] text-pf-text-muted">Default crypto</p>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="mb-1 block text-[13px] font-medium text-pf-text-secondary">Iterations</label>
            <TextInput value={iterations} onChange={(e) => setIterations(e.target.value)} className="w-full font-mono" />
          </div>
          <div>
            <label className="mb-1 block text-[13px] font-medium text-pf-text-secondary">Key length</label>
            <TextInput value={keylen} onChange={(e) => setKeylen(e.target.value)} className="w-full font-mono" />
          </div>
          <div>
            <label className="mb-1 block text-[13px] font-medium text-pf-text-secondary">Digest</label>
            <Select
              value={digest}
              onChange={(e) => setDigest(e.target.value as Settings["defaultCrypto"]["digest"])}
              className="font-mono"
            >
              {DIGESTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 pt-2">
          <div>
            <label className="mb-1 block text-[13px] font-medium text-pf-text-secondary">
              Idle lock (seconds)
            </label>
            <TextInput
              value={idleLockSeconds}
              onChange={(e) => setIdleLockSeconds(e.target.value)}
              className="w-full font-mono"
            />
          </div>
          <div>
            <label className="mb-1 block text-[13px] font-medium text-pf-text-secondary">
              Clipboard clear (seconds)
            </label>
            <TextInput
              value={clipboardClearSeconds}
              onChange={(e) => setClipboardClearSeconds(e.target.value)}
              className="w-full font-mono"
            />
          </div>
        </div>
        <p className="pt-2 text-[11px] uppercase tracking-[0.02em] text-pf-text-muted">
          Vault data
        </p>
        <p className="text-[12px] text-pf-text-secondary">
          Export saves folder and profile parameters as JSON — generated passwords are never stored,
          so none are included. Treat the file as sensitive metadata.
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => void doExport()} disabled={vaultBusy}>
            Export vault…
          </Button>
          <Button variant="ghost" onClick={() => void doImport()} disabled={vaultBusy}>
            Import vault…
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            void onImportFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {vaultMsg && <p className="text-[11px] text-pf-text-muted">{vaultMsg}</p>}
        {error && <p className="text-[11px] text-pf-text-error">{error}</p>}
      </div>
    </Modal>
  );
}
