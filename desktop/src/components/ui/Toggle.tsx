type ToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
};

export function Toggle({ checked, onChange, disabled, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative h-5 w-9 shrink-0 rounded-[10px] transition-colors duration-100 disabled:opacity-40"
      style={{ background: checked ? "var(--pf-accent-primary)" : "var(--pf-surface-overlay)" }}
    >
      <span
        className="absolute top-[2px] h-4 w-4 rounded-[8px] bg-white transition-transform duration-100"
        style={{ left: 2, transform: checked ? "translateX(16px)" : "translateX(0)" }}
      />
    </button>
  );
}
