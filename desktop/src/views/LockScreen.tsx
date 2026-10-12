import { Eye, EyeOff, KeyRound, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/Button";
import { FingerprintGlyphs } from "../components/ui/FingerprintGlyphs";
import type { Finger } from "../types";

type LockScreenProps = {
  onUnlock: () => void;
};

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

export function LockScreen({ onUnlock }: LockScreenProps) {
  const [password, setPassword] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fingers, setFingers] = useState<Finger[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!password) {
      setFingers(null);
      return;
    }
    const id = window.setTimeout(() => {
      api
        .previewFingerprint(password)
        .then(setFingers)
        .catch(() => setFingers(null));
    }, 300);
    return () => window.clearTimeout(id);
  }, [password]);

  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.unlockWithMasterPassword(password);
      onUnlock();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-pf-canvas">
      <header
        data-tauri-drag-region
        className="flex h-10 shrink-0 items-center justify-between border-b border-pf-border-subtle pl-[72px] pr-3"
      >
        <span className="text-[13px] font-semibold text-pf-text-primary">PassForge</span>
        <span className="inline-flex items-center gap-1.5 rounded-sm border border-pf-border-subtle bg-pf-raised px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-pf-text-secondary">
          <Lock size={10} strokeWidth={1.5} />
          Engine locked
        </span>
      </header>

      <div className="flex flex-1 items-center justify-center">
        <div className="w-[420px] rounded-lg border border-pf-border-moderate bg-pf-raised p-8 shadow-modal">
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-md border border-pf-border-moderate bg-pf-input">
              <KeyRound size={18} strokeWidth={1.5} className="text-pf-accent" />
            </div>
            <h1 className="text-[22px] font-semibold leading-7 tracking-[-0.02em] text-pf-text-primary">
              Master Key Authorization
            </h1>
            <p className="mt-1 font-mono text-[11px] text-pf-text-secondary">
              LessPass v2 · PBKDF2-HMAC-SHA256
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label htmlFor="master-password" className="mb-1.5 block text-[13px] font-medium text-pf-text-secondary">
              Master password
            </label>
            <div className="relative">
              <input
                id="master-password"
                ref={inputRef}
                type={revealed ? "text" : "password"}
                autoComplete="off"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setPassword("");
                    setError(null);
                  }
                }}
                placeholder="Master password"
                className="h-9 w-full rounded-sm border border-pf-border-subtle bg-pf-input px-3 pr-9 font-mono text-[13px] text-pf-text-primary placeholder:text-pf-text-muted outline-none transition-colors duration-100 hover:border-pf-border-moderate focus:border-pf-border-focus focus:bg-pf-input-focus"
              />
              <button
                type="button"
                aria-label={revealed ? "Conceal password" : "Reveal password"}
                onClick={() => setRevealed((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-pf-text-secondary hover:text-pf-text-primary"
              >
                {revealed ? <EyeOff size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} />}
              </button>
            </div>

            {error && <p className="mt-1.5 text-[11px] text-pf-text-error">{error}</p>}

            <div className="mt-3 flex h-5 items-center justify-center gap-2">
              {password && fingers && (
                <>
                  <FingerprintGlyphs fingers={fingers} />
                  <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-pf-text-muted">
                    Key fingerprint
                  </span>
                </>
              )}
            </div>

            <Button type="submit" disabled={!password || busy} className="mt-4 w-full">
              Unlock Vault
            </Button>
          </form>

          <p className="mt-5 text-center text-[11px] leading-4 text-pf-text-muted">
            PassForge is stateless. Passwords exist only in memory during generation.
          </p>
        </div>
      </div>
    </div>
  );
}
