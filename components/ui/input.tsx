import { cn } from "@/lib/cn";
import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";

const base =
  "h-10 w-full rounded-md border border-border-strong bg-background px-3 text-[14px] text-foreground placeholder:text-muted-fg transition-colors duration-150 hover:border-[#bdbdb6]";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(base, className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(base, "pr-8", className)} {...props} />;
}

export function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-text-2">
        {label}
      </label>
      {children}
    </div>
  );
}
