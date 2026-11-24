"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { ErrorNote } from "@/components/ui/states";
import { createTenant } from "./actions";

export function CreateTenantForm() {
  const [state, action, pending] = useActionState(createTenant, undefined);
  return (
    <form action={action} className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="grid grid-cols-[1fr_180px_1fr_auto] items-end gap-3">
        <Field label="Nome do cliente" htmlFor="tenant-name">
          <Input id="tenant-name" name="name" required placeholder="Clínica Exemplo" />
        </Field>
        <Field label="Plano" htmlFor="tenant-plan">
          <Select id="tenant-plan" name="plan" defaultValue="Profissional">
            <option>Essencial</option>
            <option>Profissional</option>
            <option>Agência</option>
          </Select>
        </Field>
        <Field label="E-mail do administrador" htmlFor="tenant-admin">
          <Input id="tenant-admin" name="adminEmail" type="email" required placeholder="nome@clinica.com.br" />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Criando…" : "Criar cliente"}
        </Button>
      </div>
      {state?.error ? <ErrorNote>{state.error}</ErrorNote> : null}
      {state?.link ? (
        <div className="flex flex-col gap-1.5 rounded-md bg-brand-soft px-3 py-2.5">
          <p className="text-[13px] text-text-2">
            {state.name} criado. Envie este link para {state.email} entrar como administrador. Ele vale por 7 dias.
          </p>
          <Input readOnly value={state.link} aria-label="Link do convite" onFocus={(e) => e.currentTarget.select()} />
        </div>
      ) : null}
    </form>
  );
}
