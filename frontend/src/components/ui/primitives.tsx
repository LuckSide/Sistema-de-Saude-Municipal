import React, { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: (string | undefined | false)[]) {
  return twMerge(clsx(inputs));
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "danger" | "secondary";
  size?: "sm" | "md" | "lg";
}

export function Button({
  className,
  variant = "default",
  size = "md",
  ...props
}: ButtonProps) {
  const sizeStyles = {
    sm: "h-8 min-h-[32px] px-3 py-1 text-xs",
    md: "h-11 min-h-[44px] px-4 py-2.5 text-sm",
    lg: "h-12 min-h-[48px] px-5 py-3 text-base",
  }[size] || "h-11 min-h-[44px] px-4 py-2.5 text-sm";

  const variantStyles = {
    default: "bg-sus-900 text-white hover:bg-sus-800",
    outline: "border border-sus-900/20 bg-white text-sus-900 hover:bg-sus-50",
    ghost: "bg-transparent text-sus-900 hover:bg-sus-100/60",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
    secondary: "bg-sus-100 text-sus-900 hover:bg-sus-200",
  }[variant] || "bg-sus-900 text-white hover:bg-sus-800";

  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-display font-semibold transition active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sus-700",
        sizeStyles,
        variantStyles,
        className
      )}
    />
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        {...props}
        className={cn(
          "w-full h-11 rounded-xl border border-sus-900/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink/60 focus:border-sus-700 focus-visible:ring-2 focus-visible:ring-sus-700/20",
          className
        )}
      />
    );
  }
);
Input.displayName = "Input";

const SELECT_CHEVRON_SVG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%230A3D62' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`;

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, style, ...props }, ref) => {
    return (
      <select
        ref={ref}
        {...props}
        style={{
          backgroundImage: SELECT_CHEVRON_SVG,
          ...style,
        }}
        className={cn(
          "w-full h-11 appearance-none rounded-xl border border-sus-900/15 bg-white bg-[position:right_0.875rem_center] bg-[size:1rem_1rem] bg-no-repeat pl-3.5 pr-9 py-2.5 text-sm text-ink outline-none transition focus:border-sus-700 focus-visible:ring-2 focus-visible:ring-sus-700/20 disabled:cursor-not-allowed disabled:bg-sand/30 disabled:opacity-60 cursor-pointer",
          className
        )}
      >
        {children}
      </select>
    );
  }
);
Select.displayName = "Select";

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <label className={cn("mb-1.5 block font-display text-xs font-semibold uppercase tracking-wide text-sus-900/70", className)}>
      {children}
    </label>
  );
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("rounded-2xl border border-sus-900/10 bg-white shadow-card", className)}
    >
      {children}
    </div>
  );
}

export function Badge({
  children,
  className,
  variant = "default",
}: {
  children: ReactNode;
  className?: string;
  variant?: "default" | "outline" | "success" | "warning" | "danger";
}) {
  const base = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold";
  const variants: Record<string, string> = {
    default: "bg-teal/10 text-teal",
    outline: "bg-sus-900/10 text-sus-900 border border-sus-900/20",
    success: "bg-green-100 text-green-800",
    warning: "bg-amber-100 text-amber-800",
    danger: "bg-red-100 text-red-800",
  };
  return <span className={cn(base, variants[variant], className)}>{children}</span>;
}
