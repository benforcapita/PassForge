import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/Button";
import { CharChip } from "../components/ui/CharChip";
import { Modal } from "../components/ui/Modal";
import { Slider } from "../components/ui/Slider";
import { TextInput } from "../components/ui/TextInput";
import type { Folder, PasswordOptions } from "../types";

type Props = {
  folders: Folder[];
  onClose: () => void;
  onCreated: () => void;
};

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

export function NewProfileModal({ folders, onClose, onCreated }: Props) {
  const [site, setSite] = useState("");
  const [login, setLogin] = useState("");
  const [counter, setCounter] = useState(1);
  const [options, setOptions] = useState<PasswordOptions>({
    lowercase: true,
    uppercase: true,
    digits: true,
    symbols: true,
    length: 16,
  });
  const [folderId, setFolderId] = useState(folders[0]?.id ?? "");
  const [tags, setTags] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sets: { key: keyof PasswordOptions; label: string }[] = [
    { key: "uppercase", label: "A-Z" },
    { key: "lowercase", label: "a-z" },
    { key: "digits", label: "0-9" },
    { key: "symbols", label: "!@#" },
  ];
  const activeCount = sets.filter((s) => options[s.key] === true).length;

  const create = async () => {
    if (!site.trim() || !login.trim()) {
      setError("Site and login are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let targetFolder = folderId;
      if (!targetFolder) {
        const general = await api.createFolder({ parentId: null, name: "General" });
        targetFolder = general.id;
      }
      await api.createEntry({
        site: site.trim(),
        login: login.trim(),
        counter,
        options,
        saltFields: [],
        crypto: null,
        folderId: targetFolder,
        groupIds: [],
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New Profile"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void create()} disabled={busy}>
            Create Entry
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-[13px] font-medium text-pf-text-secondary">Site</label>
          <TextInput
            value={site}
            onChange={(e) => setSite(e.target.value)}
            placeholder="example.com"
            className="w-full"
          />
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium text-pf-text-secondary">Login</label>
          <TextInput
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder="user@example.com"
            className="w-full"
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-[13px] font-medium text-pf-text-secondary">Counter</label>
            <div className="flex items-center gap-2">
              <Button variant="ghost" className="w-9 px-0" onClick={() => setCounter((c) => Math.max(1, c - 1))}>
                −
              </Button>
              <span className="w-8 text-center font-mono text-[13px] text-pf-text-primary">{counter}</span>
              <Button variant="ghost" className="w-9 px-0" onClick={() => setCounter((c) => c + 1)}>
                +
              </Button>
            </div>
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-[13px] font-medium text-pf-text-secondary">Folder</label>
            <select
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              className="h-8 w-full rounded-sm border border-pf-border-subtle bg-pf-input px-2 text-[13px] text-pf-text-primary outline-none focus:border-pf-border-focus"
            >
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
              {folders.length === 0 && <option value="">General</option>}
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium text-pf-text-secondary">Length</label>
          <Slider
            label="Length"
            value={options.length}
            onChange={(length) => setOptions((o) => ({ ...o, length }))}
          />
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium text-pf-text-secondary">Character sets</label>
          <div className="flex gap-2">
            {sets.map((s) => (
              <CharChip
                key={s.key}
                label={s.label}
                active={Boolean(options[s.key])}
                canDeactivate={activeCount > 1}
                onToggle={() => setOptions((o) => ({ ...o, [s.key]: !o[s.key] }))}
              />
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium text-pf-text-secondary">
            Tags <span className="text-pf-text-muted">(comma separated)</span>
          </label>
          <TextInput
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="dev, primary"
            className="w-full"
          />
        </div>
        {error && <p className="text-[11px] text-pf-text-error">{error}</p>}
      </div>
    </Modal>
  );
}
