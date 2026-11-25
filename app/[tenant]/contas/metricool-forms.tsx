"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { ErrorNote } from "@/components/ui/states";
import { Notice } from "@/components/ui/status";
import type { MetricoolBrand } from "@/lib/metricool/client";
import { linkBrand, saveMetricool } from "./metricool-actions";

export function MetricoolCredentialsForm({ slug, connected }: { slug: string; connected: boolean }) {
  const [state, action, pending] = useActionState(saveMetricool.bind(null, slug), undefined);
  // Controlado: o React limpa o formulário depois da action e o userId não deve sumir num erro de token
  const [userId, setUserId] = useState("");
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid grid-cols-[200px_1fr_auto] items-end gap-3">
        <Field label="userId do Metricool" htmlFor="mc-user">
          <Input id="mc-user" name="userId" inputMode="numeric" required value={userId} onChange={(e) => setUserId(e.target.value)} />
        </Field>
        <Field label={connected ? "Novo token da API" : "Token da API"} htmlFor="mc-token">
          <Input id="mc-token" name="token" type="password" autoComplete="off" required />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Conferindo…" : connected ? "Trocar token" : "Conectar Metricool"}
        </Button>
      </div>
      <p className="text-[13px] text-muted-fg">No Metricool: Configurações da conta → API. A API exige plano Advanced ou Custom. O token fica criptografado e não aparece de novo.</p>
      {state?.error ? <ErrorNote>{state.error}</ErrorNote> : null}
      {state?.ok ? <Notice tone="success">{state.ok}</Notice> : null}
    </form>
  );
}

export function LinkBrandForm({ slug, brands }: { slug: string; brands: MetricoolBrand[] }) {
  const [state, action, pending] = useActionState(linkBrand.bind(null, slug), undefined);
  const [username, setUsername] = useState(brands[0]?.instagram ?? "");
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid grid-cols-[1fr_200px_180px_auto] items-end gap-3">
        <Field label="Marca no Metricool" htmlFor="mc-brand">
          <Select id="mc-brand" name="blogId" onChange={(e) => setUsername(brands.find((b) => b.blogId === e.target.value)?.instagram ?? "")}>
            {brands.map((b) => (
              <option key={b.blogId} value={b.blogId}>
                {b.label}
                {b.instagram ? ` · @${b.instagram}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="@ do Instagram" htmlFor="mc-username">
          <Input id="mc-username" name="username" required value={username} onChange={(e) => setUsername(e.target.value)} placeholder="clinica" />
        </Field>
        <Field label="Depois de subir" htmlFor="mc-approval">
          <Select id="mc-approval" name="requireApproval" defaultValue="true">
            <option value="true">Pede aprovação</option>
            <option value="false">Publica direto</option>
          </Select>
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Vinculando…" : "Adicionar conta"}
        </Button>
      </div>
      {state?.error ? <ErrorNote>{state.error}</ErrorNote> : null}
      {state?.ok ? <Notice tone="success">{state.ok}</Notice> : null}
    </form>
  );
}
