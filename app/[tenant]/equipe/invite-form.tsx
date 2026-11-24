"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { ErrorNote } from "@/components/ui/states";
import { ROLES, ROLE_LABELS } from "@/lib/auth/permissions";
import { inviteMember } from "./actions";

export function InviteForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(inviteMember.bind(null, slug), undefined);
  return (
    <form action={action} className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="grid grid-cols-[1fr_200px_auto] items-end gap-3">
        <Field label="E-mail" htmlFor="invite-email">
          <Input id="invite-email" name="email" type="email" required placeholder="nome@clinica.com.br" />
        </Field>
        <Field label="Papel" htmlFor="invite-role">
          <Select id="invite-role" name="role" defaultValue="editor">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r].name}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Convidando…" : "Convidar"}
        </Button>
      </div>
      {state?.error ? <ErrorNote>{state.error}</ErrorNote> : null}
      {state?.link ? (
        <div className="flex flex-col gap-1.5 rounded-md bg-brand-soft px-3 py-2.5">
          <p className="text-[13px] text-text-2">
            Envie este link para {state.email}. Ele vale por 7 dias.
          </p>
          <Input readOnly value={state.link} aria-label="Link do convite" onFocus={(e) => e.currentTarget.select()} />
        </div>
      ) : null}
    </form>
  );
}
