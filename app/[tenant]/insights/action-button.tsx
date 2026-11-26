"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "./actions";

/** Botão que chama uma ação do servidor e mostra o resultado ao lado. */
export function ActionButton({
  run,
  label,
  pendingLabel,
  variant = "secondary",
  disabled,
}: {
  run: () => Promise<ActionResult>;
  label: string;
  pendingLabel: string;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant={variant}
        disabled={disabled || pending}
        aria-busy={pending}
        onClick={() =>
          start(async () => {
            setResult(null);
            setResult(await run());
          })
        }
      >
        {pending ? pendingLabel : label}
      </Button>
      <span role="status" aria-live="polite" className={`text-[13px] ${result && !result.ok ? "text-danger" : "text-text-2"}`}>
        {result ? (result.ok ? result.message : result.error) : null}
      </span>
    </div>
  );
}
