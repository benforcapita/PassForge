export function TagPill({ label }: { label: string }) {
  return (
    <span className="inline-flex h-5 items-center rounded-[3px] border border-pf-border-subtle bg-pf-raised px-2 font-mono text-[11px] font-medium text-pf-text-secondary">
      {label}
    </span>
  );
}

export function CounterBadge({ counter }: { counter: number }) {
  return (
    <span
      className="inline-flex h-5 items-center rounded-[3px] px-2 font-mono text-[11px] font-medium text-pf-accent"
      style={{ background: "rgba(6, 182, 212, 0.1)" }}
      title={`Counter: ${counter}`}
    >
      C:{counter}
    </span>
  );
}
