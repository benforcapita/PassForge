import { ChevronDown } from "lucide-react";
import { forwardRef, type SelectHTMLAttributes } from "react";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className = "", children, ...rest },
  ref,
) {
  return (
    <div className={`relative ${className}`}>
      <select
        ref={ref}
        className="h-8 w-full appearance-none rounded-sm border border-pf-border-subtle bg-pf-input px-2.5 pr-7 text-[13px] text-pf-text-primary outline-none transition-colors duration-100 hover:border-pf-border-moderate focus:border-pf-border-focus focus:bg-pf-input-focus"
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        size={14}
        strokeWidth={1.5}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-pf-text-muted"
      />
    </div>
  );
});
