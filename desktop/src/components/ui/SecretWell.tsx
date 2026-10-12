import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";

type SecretWellProps = {
  value: string | null;
  placeholder?: string;
  onReveal?: () => void;
  onCopy?: () => void;
  copied?: boolean;
  emptyHint?: string;
};

export function SecretWell({ value, placeholder, onReveal, onCopy, copied, emptyHint }: SecretWellProps) {
  const [revealed, setRevealed] = useState(false);
  const hasValue = value != null && value.length > 0;

  return (
    <div className="flex h-11 items-center gap-2 rounded-sm border border-pf-border-moderate bg-pf-canvas px-3">
      <span className="flex-1 truncate font-mono text-[15px] tracking-[0.05em] text-pf-text-primary">
        {hasValue ? (revealed ? value : "•".repeat(value.length)) : (
          <span className="text-[12px] tracking-normal text-pf-text-muted">
            {emptyHint ?? placeholder ?? "Reveal or copy to generate"}
          </span>
        )}
      </span>
      <button
        type="button"
        aria-label={revealed ? "Conceal password" : "Reveal password"}
        title={revealed ? "Conceal" : "Reveal"}
        onClick={() => {
          if (!hasValue) {
            onReveal?.();
            setRevealed(true);
            return;
          }
          setRevealed((v) => !v);
        }}
        className="text-pf-text-secondary transition-colors duration-100 hover:text-pf-text-primary"
      >
        {revealed && hasValue ? <EyeOff size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} />}
      </button>
      <button
        type="button"
        aria-label="Copy password"
        title="Copy password (⌘C)"
        onClick={onCopy}
        className="text-pf-text-secondary transition-colors duration-100 hover:text-pf-text-primary"
      >
        {copied ? (
          <Check size={14} strokeWidth={1.5} className="text-pf-success" />
        ) : (
          <Copy size={14} strokeWidth={1.5} />
        )}
      </button>
    </div>
  );
}
