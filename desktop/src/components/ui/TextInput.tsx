import { forwardRef, type InputHTMLAttributes } from "react";

export type TextInputProps = InputHTMLAttributes<HTMLInputElement>;

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { className = "", ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={`h-8 rounded-sm border border-pf-border-subtle bg-pf-input px-2.5 text-[13px] text-pf-text-primary placeholder:text-pf-text-muted outline-none transition-colors duration-100 hover:border-pf-border-moderate focus:border-pf-border-focus focus:bg-pf-input-focus ${className}`}
      {...rest}
    />
  );
});
