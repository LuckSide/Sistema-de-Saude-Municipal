import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: (string | undefined | false)[]) {
  return twMerge(clsx(inputs));
}

export function Button({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex h-11 min-h-[44px] items-center justify-center gap-2 rounded-xl bg-sus-900 px-4 py-2.5 font-display text-sm font-semibold text-white transition hover:bg-sus-800 active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-50",
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
        "w-full h-11 rounded-xl border border-sus-900/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink/35 focus:border-sus-700 focus:ring-2 focus:ring-sus-700/20",
        className
      )}
    />
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
