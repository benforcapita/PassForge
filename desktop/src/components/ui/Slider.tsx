type SliderProps = {
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  label?: string;
};

export function Slider({ value, min = 5, max = 35, onChange, label }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="pf-slider h-1 w-full cursor-pointer appearance-none rounded-[2px] outline-none"
        style={{
          background: `linear-gradient(to right, var(--pf-accent-primary) ${pct}%, var(--pf-surface-overlay) ${pct}%)`,
        }}
      />
      <span className="w-7 text-right font-mono text-[12px] text-pf-text-primary">{value}</span>
    </div>
  );
}
