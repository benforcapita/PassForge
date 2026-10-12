import { Check } from "lucide-react";
import { useEffect, useState } from "react";

type ToastProps = {
  message: string;
  /** Total seconds for the countdown progress bar. Omit for a static toast. */
  countdownSeconds?: number;
};

export function Toast({ message, countdownSeconds }: ToastProps) {
  const [now, setNow] = useState(() => Date.now());
  const [started] = useState(() => Date.now());

  useEffect(() => {
    if (countdownSeconds == null) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [countdownSeconds]);

  const remaining =
    countdownSeconds == null
      ? null
      : Math.max(0, countdownSeconds - (now - started) / 1000);
  const pct = remaining == null ? null : (remaining / countdownSeconds!) * 100;
  const urgent = remaining != null && remaining < 5;

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[340px] overflow-hidden rounded-md border border-pf-border-moderate bg-pf-raised shadow-dropdown">
      <div className="flex h-11 items-center gap-2 px-3">
        <Check size={14} strokeWidth={1.5} className="shrink-0 text-pf-success" />
        <span className="truncate text-[12px] text-pf-text-primary">{message}</span>
      </div>
      {pct != null && (
        <div className="h-[2px] w-full bg-pf-overlay">
          <div
            className="h-full transition-[width] duration-200"
            style={{
              width: `${pct}%`,
              background: urgent ? "var(--pf-status-warning)" : "var(--pf-accent-primary)",
              transitionTimingFunction: "linear",
            }}
          />
        </div>
      )}
    </div>
  );
}
