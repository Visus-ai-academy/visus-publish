"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { ErrorNote } from "@/components/ui/states";
import { Notice } from "@/components/ui/status";
import { saveAiKey, saveModel } from "./actions";

export function AiKeyForm({ providers }: { providers: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState(saveAiKey, undefined);
  return (
    <form action={action} className="flex flex-col gap-3 rounded-lg border border-border p-5">
      <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[220px_1fr_auto]">
        <Field label="Provedor" htmlFor="ai-provider">
          <Select id="ai-provider" name="provider">
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Chave da API" htmlFor="ai-key">
          <Input id="ai-key" name="key" type="password" autoComplete="off" required />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Conferindo…" : "Guardar chave"}
        </Button>
      </div>
      <p className="text-[13px] text-muted-fg">
        OpenAI: platform.openai.com → API keys. Gemini: aistudio.google.com → Get API key. A chave é conferida, fica criptografada no cofre e não aparece de novo.
      </p>
      {state?.error ? <ErrorNote>{state.error}</ErrorNote> : null}
      {state?.ok ? <Notice tone="success">{state.ok}</Notice> : null}
    </form>
  );
}

export function ModelForm({ id, model }: { id: string; model: string }) {
  const [state, action, pending] = useActionState(saveModel, undefined);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <label htmlFor={`m-${id}`} className="sr-only">
        Modelo
      </label>
      <Input id={`m-${id}`} name="model" defaultValue={model} className="h-10 w-56" />
      <Button type="submit" variant="secondary" disabled={pending}>
        Salvar
      </Button>
      {state?.error ? <span className="text-[13px] text-danger">{state.error}</span> : null}
      {state?.ok ? <span className="text-[13px] text-text-2">{state.ok}</span> : null}
    </form>
  );
}
