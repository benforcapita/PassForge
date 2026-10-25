import { useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import type { ImportReport2 } from "../types";

type Props = {
  onClose: () => void;
  onImported: () => void;
};

const CSV_FILTERS = [
  { name: "Password exports", extensions: ["csv", "json"] },
];

export function ImportModal({ onClose, onImported }: Props) {
  const [report, setReport] = useState<ImportReport2 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const errText = (err: unknown) =>
    err && typeof err === "object" && "message" in err ? String(err.message) : String(err);

  const runImport = async (pathOrContent: string) => {
    setBusy(true);
    setError(null);
    try {
      setReport(await api.importPasswords(pathOrContent));
      onImported();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const pickFile = async () => {
    if (isTauri()) {
      const picked = await open({ filters: CSV_FILTERS, multiple: false });
      if (picked && !Array.isArray(picked)) await runImport(picked);
    } else {
      fileRef.current?.click();
    }
  };

  return (
    <Modal title="Import passwords" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {!report && (
          <div className="flex flex-col gap-2 text-[12px] leading-relaxed text-pf-text-secondary">
            <p>
              PassForge reads CSV exports from Chrome, Firefox, Safari, Bitwarden,
              1Password and LastPass, plus LessPass JSON exports.
            </p>
            <p>
              For each imported password the app tries to <em>reverse-match</em> it:
              if it turns out to be a PassForge/LessPass derivation of the site and
              login, only its parameters are kept — nothing secret is stored. All
              other passwords are <em>sealed</em>: stored encrypted until you
              change the password on the site and migrate the account.
            </p>
          </div>
        )}

        {report ? (
          <div className="flex flex-col gap-2 text-[12px]">
            <p className="font-medium text-pf-text-primary">
              Imported {report.total} credentials
            </p>
            <ul className="space-y-0.5 font-mono text-[11px] text-pf-text-secondary">
              <li>{report.reverseMatched} recognised as PassForge passwords</li>
              <li>{report.sealed} sealed until migration</li>
              <li>{report.lessPassProfiles} LessPass profiles</li>
              <li>{report.skippedDuplicate} duplicates skipped</li>
              <li>{report.skippedInvalid} invalid rows skipped</li>
            </ul>
            {report.skipReasons.length > 0 && (
              <ul className="max-h-24 overflow-y-auto space-y-0.5 text-[11px] text-pf-text-muted">
                {report.skipReasons.map((r, i) => (
                  <li key={i}>· {r}</li>
                ))}
              </ul>
            )}
            {report.sealed + report.reverseMatched + report.lessPassProfiles > 0 && (
              <p
                role="alert"
                className="rounded-sm bg-pf-warning-bg px-3 py-2 text-[12px] font-medium text-pf-warning"
              >
                Delete the CSV file now — it contains your passwords in plain
                text.
              </p>
            )}
          </div>
        ) : (
          <>
            <Button onClick={() => void pickFile()} disabled={busy}>
              {busy ? "Importing…" : "Choose a CSV or JSON file"}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.json,text/csv,application/json"
              className="hidden"
              data-testid="import-file-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void f.text().then(runImport);
              }}
            />
          </>
        )}

        {error && <p className="text-[11px] text-pf-text-error">{error}</p>}
      </div>
    </Modal>
  );
}
