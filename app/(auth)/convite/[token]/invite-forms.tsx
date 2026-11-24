"use client";

import { useActionState } from "react";
import { acceptInviteAction, signUpFromInvite } from "../../actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { ErrorNote } from "@/components/ui/states";

export function AcceptForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInviteAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      {state?.error ? <ErrorNote>{state.error}</ErrorNote> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Entrando…" : "Aceitar convite"}
      </Button>
    </form>
  );
}

export function SignUpForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState(signUpFromInvite, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <Field label="E-mail" htmlFor="email">
        <Input id="email" value={email} readOnly disabled />
      </Field>
      <Field label="Crie uma senha" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      {state?.error ? <ErrorNote>{state.error}</ErrorNote> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Criando conta…" : "Criar conta e entrar"}
      </Button>
    </form>
  );
}
