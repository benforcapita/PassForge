import type { ReactNode } from "react";

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 items-center rounded-sm border border-pf-border-subtle bg-pf-input px-1.5 font-mono text-[10px] font-medium tracking-[0.02em] text-pf-text-muted">
      {children}
    </kbd>
  );
}
