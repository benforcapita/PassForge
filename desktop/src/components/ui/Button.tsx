import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ghost" | "danger" | "icon";

const BASE =
  "inline-flex items-center justify-center gap-1.5 font-medium transition-colors duration-100 select-none disabled:cursor-not-allowed";

const VARIANTS: Record<Variant, string> = {
  primary:
    "h-8 px-3.5 rounded-sm text-[13px] bg-pf-accent text-pf-text-on-accent hover:bg-pf-accent-hover active:bg-[#0E7490] disabled:bg-pf-overlay disabled:text-pf-text-muted",
  ghost:
    "h-8 px-3 rounded-sm text-[13px] bg-transparent text-pf-text-secondary border border-pf-border-subtle hover:bg-pf-raised hover:text-pf-text-primary hover:border-pf-border-moderate active:bg-pf-overlay",
  danger:
    "h-8 px-3.5 rounded-sm text-[13px] bg-pf-error-bg text-pf-text-error border border-[rgba(239,68,68,0.3)] hover:bg-pf-error hover:text-white active:bg-[#DC2626]",
  icon: "h-7 w-7 rounded-sm text-pf-text-secondary bg-transparent hover:text-pf-text-primary hover:bg-pf-raised disabled:opacity-40",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", className = "", type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`${BASE} ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  );
});
