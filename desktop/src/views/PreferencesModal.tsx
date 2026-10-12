import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { TextInput } from "../components/ui/TextInput";
import type { Settings } from "../types";

type Props = {
  settings: Settings;
  onClose: () => void;
  onSaved: (settings: Settings) => void;
};

const DIGESTS = ["sha256", "sha512", "sha1"] as const;

export function PreferencesModal({ settings, onClose, onSaved }: Props) {
  const [iterations, setIterations] = useState(String(settings.defaultCrypto.iterations));
  const [keylen, setKeylen] = useState(String(settings.defaultCrypto.keylen));
  const [digest, setDigest] = useState(settings.defaultCrypto.digest);
  const [idleLockSeconds, setIdleLockSeconds] = useState(String(settings.idleLockSeconds));
  const [clipboardClearSeconds, setClipboardClearSeconds] = useState(
    String(settings.clipboardClearSeconds),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
            <select
              value={digest}
              onChange={(e) => setDigest(e.target.value as Settings["defaultCrypto"]["digest"])}
              className="h-8 w-full rounded-sm border border-pf-border-subtle bg-pf-input px-2 font-mono text-[13px] text-pf-text-primary outline-none focus:border-pf-border-focus"
            >
              {DIGESTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
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
        {error && <p className="text-[11px] text-pf-text-error">{error}</p>}
      </div>
    </Modal>
  );
}
