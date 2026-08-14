import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

type Variant = "primary" | "default" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children?: ReactNode;
}

/**
 * 所有样式都取自 design token 生成的语义类，不出现任何字面色值。
 * 想调整按钮观感请改 tokens.css，而不是这里。
 */
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-fg-on-accent hover:bg-accent-hover active:bg-accent-active",
  default: "bg-surface text-fg border border-line hover:bg-hover active:bg-active",
  ghost: "text-fg-secondary hover:bg-hover hover:text-fg active:bg-active",
  danger: "bg-danger-solid text-fg-on-accent hover:opacity-90 active:opacity-80",
};

const SIZES: Record<Size, string> = {
  sm: "h-control-sm px-2 text-xs gap-1",
  md: "h-control-md px-2.5 text-sm gap-1.5",
  lg: "h-control-lg px-3 text-sm gap-1.5",
};

export function Button({
  variant = "default",
  size = "md",
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap",
        "transition-colors duration-[120ms] ease-standard",
        "disabled:pointer-events-none disabled:opacity-45",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
