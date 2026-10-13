import { useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { Select } from "../components/ui/Select";
import { TextInput } from "../components/ui/TextInput";
import type { Settings } from "../types";

type Props = {
  settings: Settings;
  onClose: () => void;
  onSaved: (settings: Settings) => void;
  onVaultChanged?: () => void;
};

const DIGESTS = ["sha256", "sha512", "sha1"] as const;

export function PreferencesModal({ settings, onClose, onSaved, onVaultChanged }: Props) {
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const JSON_FILTER = { name: "JSON", extensions: ["json"] };

  const errText = (err: unknown) =>
    err && typeof err === "object" && "message" in err ? String(err.message) : String(err);

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
    const parsed: Settings = {
      defaultCrypto: {
        iterations: Number(iterations),
        keylen: Number(keylen),
        digest,
      },
      idleLockSeconds: Number(idleLockSeconds),
      clipboardClearSeconds: Number(clipboardClearSeconds),
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
