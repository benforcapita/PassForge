import { useCallback, useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { api } from "../api";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { useClipboard } from "../hooks/useClipboard";
import type { EntrySummary, MigrationPreview, SealedList } from "../types";

type Props = {
  clipboardClearSeconds: number;
  /** When set, only this entry is shown (opened from a workbench chip). */
  entryId?: string;
  onClose: () => void;
  onChanged?: () => void;
};

async function openChangePasswordUrl(site: string) {
  const url = `https://${site.replace(/^www\./, "")}/.well-known/change-password`;
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener");
  }
}

function MigrationRow({
  entry,
  onDone,
}: {
  entry: EntrySummary;
  onDone: () => void;
}) {
  const [preview, setPreview] = useState<MigrationPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clip = useClipboard(20);

  const errText = (err: unknown) =>
    err && typeof err === "object" && "message" in err ? String(err.message) : String(err);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPreview(await api.migrationPreview(entry.id));
    } catch (err) {
      setError(errText(err));
    }
  }, [entry.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const complete = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.completeMigration(entry.id);
      onDone();
    } catch (err) {
      setError(errText(err));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-md border border-pf-border-moderate bg-pf-raised p-3" data-testid="migration-row">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-pf-text-primary">{entry.site}</p>
          <p className="truncate font-mono text-[11px] text-pf-text-secondary">{entry.login}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="ghost" className="h-7" onClick={() => void openChangePasswordUrl(entry.site)}>
            Change password on site
          </Button>
        </div>
      </div>
      {preview && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          <Button
            variant="ghost"
            className="h-7"
            onClick={() => void clip.copy(preview.current)}
            data-testid="copy-current"
          >
            Copy current{clip.copied ? " ✓" : ""}
          </Button>
          <Button
            variant="ghost"
            className="h-7"
            onClick={() => void clip.copy(preview.next)}
            data-testid="copy-new"
          >
            Copy new{clip.copied ? " ✓" : ""}
          </Button>
          {confirming ? (
            <span className="flex items-center gap-1.5" data-testid="migrate-confirm">
              <span className="text-pf-text-secondary">Change saved on the site?</span>
              <Button className="h-7" onClick={() => void complete()} disabled={busy}>
                {busy ? "Saving…" : "I changed it"}
              </Button>
              <Button variant="ghost" className="h-7" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </span>
          ) : (
            <Button
              variant="ghost"
              className="h-7"
              onClick={() => setConfirming(true)}
              data-testid="migrate-confirm-start"
            >
              I changed it
            </Button>
          )}
        </div>
      )}
      {error && <p className="mt-1 text-[11px] text-pf-text-error">{error}</p>}
    </li>
  );
}

export function MigrationView({ clipboardClearSeconds, entryId, onClose, onChanged }: Props) {
  const [list, setList] = useState<SealedList | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const l = await api.listSealed();
      setList(entryId ? { ...l, entries: l.entries.filter((e) => e.id === entryId) } : l);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [entryId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const total = (list?.migrated ?? 0) + (list?.entries.length ?? 0);
  const pct = total === 0 ? 100 : Math.round(((list?.migrated ?? 0) / total) * 100);

  return (
    <Modal title="Migration" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-pf-text-secondary">
          These entries still hold an imported password (sealed). Change the password on
          each site to the generated one, then confirm here — the vault then stores
          parameters only.
        </p>
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-pf-border-subtle">
            <div
              className="h-full rounded-full bg-pf-accent"
              style={{ width: `${pct}%` }}
              data-testid="migration-progress"
            />
          </div>
          <span className="font-mono text-[11px] text-pf-text-muted" data-testid="migration-count">
            {list?.migrated ?? 0}/{total}
          </span>
        </div>
        {list && list.entries.length === 0 && (
          <p className="text-[12px] text-pf-text-secondary">Nothing sealed — you're done.</p>
        )}
        <ul className="flex flex-col gap-2">
          {list?.entries.map((e) => (
            <MigrationRow
              key={e.id}
              entry={e}
              onDone={() => {
                void refresh();
                onChanged?.();
              }}
            />
          ))}
        </ul>
        {error && <p className="text-[11px] text-pf-text-error">{error}</p>}
      </div>
    </Modal>
  );
}
