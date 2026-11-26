"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { ErrorNote } from "@/components/ui/states";
import { Notice } from "@/components/ui/status";
import { saveBilling, saveOwnKey, saveProviders } from "./actions";

type Option = { value: string; label: string; note?: string };

function Result({ state }: { state: { error?: string; ok?: string } | undefined }) {
  return state?.error ? <ErrorNote>{state.error}</ErrorNote> : state?.ok ? <Notice tone="success">{state.ok}</Notice> : null;
}

export function ProvidersForm({
  slug,
  current,
  options,
  disabled,
}: {
  slug: string;
  current: { caption: string; image: string; video: string };
  options: { caption: Option[]; image: Option[]; video: Option[] };
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(saveProviders.bind(null, slug), undefined);
  const rows: { name: keyof typeof current; label: string }[] = [
    { name: "caption", label: "Texto (temas e legendas)" },
    { name: "image", label: "Arte (imagens e carrossel)" },
    { name: "video", label: "Vídeo do Reels" },
  ];
  return (
    <form action={action} className="flex flex-col gap-3 rounded-lg border border-border p-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {rows.map((r) => (
          <Field key={r.name} label={r.label} htmlFor={`prov-${r.name}`}>
            <Select id={`prov-${r.name}`} name={r.name} defaultValue={current[r.name]} disabled={disabled}>
              {options[r.name].map((o) => (
                <option key={o.value} value={o.value}>
                  {o.note ? `${o.label} (${o.note})` : o.label}
                </option>
              ))}
            </Select>
          </Field>
        ))}
      </div>
      <p className="text-[13px] text-muted-fg">
        Se o provedor escolhido estiver sem chave, a geração usa o outro que tiver. Com o vídeo ligado, &quot;Gerar&quot; num Reels cria a legenda e o vídeo; o vídeo leva alguns minutos.
      </p>
      <Result state={state} />
      {disabled ? null : (
        <Button type="submit" variant="secondary" disabled={pending} className="self-start">
          {pending ? "Salvando…" : "Salvar provedores"}
        </Button>
      )}
    </form>
  );
}

export function BillingForm({ slug, mode, disabled }: { slug: string; mode: "platform" | "own"; disabled: boolean }) {
  const [state, action, pending] = useActionState(saveBilling.bind(null, slug), undefined);
  const choices = [
    { value: "platform", label: "Créditos da Visus", body: "Usa as chaves da Visus. Cada geração desconta créditos do saldo; sem saldo, a geração fica bloqueada." },
    { value: "own", label: "Chave própria", body: "Usa as chaves do próprio cliente, cadastradas abaixo. Não gasta créditos; o custo fica na conta do cliente no provedor." },
  ];
  return (
    <form action={action} className="flex flex-col gap-3">
      <fieldset className="grid grid-cols-1 gap-2 md:grid-cols-2" disabled={disabled}>
        <legend className="sr-only">Forma de cobrança</legend>
        {choices.map((c) => (
          <label key={c.value} className="flex min-h-10 cursor-pointer gap-3 rounded-lg border border-border p-4 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
            <input type="radio" name="mode" value={c.value} defaultChecked={mode === c.value} className="mt-1 size-4 accent-[var(--brand)]" />
            <span className="flex flex-col gap-1">
              <span className="font-semibold">{c.label}</span>
              <span className="text-[13px] text-text-2">{c.body}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Result state={state} />
      {disabled ? null : (
        <Button type="submit" variant="secondary" disabled={pending} className="self-start">
          {pending ? "Salvando…" : "Salvar cobrança"}
        </Button>
      )}
    </form>
  );
}

export function OwnKeyForm({ slug, providers }: { slug: string; providers: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState(saveOwnKey.bind(null, slug), undefined);
  return (
    <form action={action} className="flex flex-col gap-3 rounded-lg border border-border p-5">
      <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[220px_1fr_auto]">
        <Field label="Provedor" htmlFor="own-provider">
          <Select id="own-provider" name="provider">
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Chave da API" htmlFor="own-key">
          <Input id="own-key" name="key" type="password" autoComplete="off" required />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Conferindo…" : "Guardar chave"}
        </Button>
      </div>
      <p className="text-[13px] text-muted-fg">
        OpenAI: platform.openai.com → API keys. Gemini (também usado pelo Veo): aistudio.google.com → Get API key. Higgsfield: console.higgsfield.ai, no formato KEY_ID:KEY_SECRET. A chave é
        conferida, fica criptografada no cofre e não aparece de novo.
      </p>
      <Result state={state} />
    </form>
  );
}
