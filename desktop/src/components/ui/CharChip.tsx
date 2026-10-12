type CharChipProps = {
  label: string;
  active: boolean;
  canDeactivate: boolean;
  onToggle: () => void;
};

export function CharChip({ label, active, canDeactivate, onToggle }: CharChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => {
        if (active && !canDeactivate) return;
        onToggle();
      }}
      className={`h-8 min-w-14 rounded-sm border px-2 font-mono text-[12px] transition-colors duration-100 ${
        active
          ? "border-pf-accent bg-pf-accent-muted text-pf-accent"
          : "border-pf-border-subtle bg-pf-input text-pf-text-secondary hover:border-pf-border-moderate hover:text-pf-text-primary"
      } ${active && !canDeactivate ? "cursor-not-allowed" : "cursor-pointer"}`}
    >
      {label}
    </button>
  );
}
