import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: (string | undefined | false)[]) {
  return twMerge(clsx(inputs));
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "danger" | "secondary";
}

export function Button({
  className,
  variant = "default",
  ...props
}: ButtonProps) {
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
        "inline-flex h-11 min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-display text-sm font-semibold transition active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sus-700",
        variantStyles,
        className
      )}
    />
  );
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full h-11 rounded-xl border border-sus-900/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink/60 focus:border-sus-700 focus-visible:ring-2 focus-visible:ring-sus-700/20",
        className
      )}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "w-full h-11 rounded-xl border border-sus-900/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-sus-700 focus-visible:ring-2 focus-visible:ring-sus-700/20",
        className
      )}
    >
      {children}
    </select>
  );
}

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
