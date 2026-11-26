"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { ErrorNote } from "@/components/ui/states";
import { Notice } from "@/components/ui/status";
import { grantCredits } from "./actions";

export function CreditsForm({ tenants }: { tenants: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(grantCredits, undefined);
  return (
    <form action={action} className="flex flex-col gap-3 rounded-lg border border-border p-5">
      <h2 className="text-[15px] font-semibold">Créditos de IA</h2>
      <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_140px_1fr_auto]">
        <Field label="Para qual cliente" htmlFor="cr-tenant">
          <Select id="cr-tenant" name="tenantId" required>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Créditos" htmlFor="cr-amount">
          <Input id="cr-amount" name="amount" type="number" step="1" required className="tabular-nums" />
        </Field>
        <Field label="Motivo (opcional)" htmlFor="cr-reason">
          <Input id="cr-reason" name="reason" maxLength={120} placeholder="Ex.: pacote de dezembro" />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Lançando…" : "Lançar créditos"}
        </Button>
      </div>
      <p className="text-[13px] text-muted-fg">Use número negativo para retirar. O cliente vê o lançamento no extrato em Integrações de IA. Clientes com chave própria não gastam créditos.</p>
      {state?.error ? <ErrorNote>{state.error}</ErrorNote> : null}
      {state?.ok ? <Notice tone="success">{state.ok}</Notice> : null}
    </form>
  );
}
