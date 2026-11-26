"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { ErrorNote } from "@/components/ui/states";
import { Notice } from "@/components/ui/status";
import { FORMATS, FORMAT_LABELS } from "@/lib/posts/upload";
import { addPlanItem, generateItem, removePlanItem, suggestPlan } from "./actions";

export function AddItemForm({ slug, accountId, defaultDate }: { slug: string; accountId: string; defaultDate: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState("");
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await addPlanItem(slug, { accountId, date: fd.get("date"), time: fd.get("time"), format: fd.get("format"), theme });
          setError(r.ok ? null : r.error);
          if (r.ok) setTheme("");
        });
      }}
    >
      <h2 className="text-[15px] font-semibold">Adicionar ao planejamento</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Dia" htmlFor="p-date">
          <Input id="p-date" name="date" type="date" required defaultValue={defaultDate} />
        </Field>
        <Field label="Horário" htmlFor="p-time">
          <Input id="p-time" name="time" type="time" required defaultValue="18:00" />
        </Field>
        <Field label="Formato" htmlFor="p-format">
          <Select id="p-format" name="format" defaultValue="image">
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABELS[f]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Tema" htmlFor="p-theme">
        <Input id="p-theme" required maxLength={120} value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="Ex.: como reduzir faltas em consultas" />
      </Field>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Adicionando…" : "Adicionar tema"}
      </Button>
    </form>
  );
}

export function SuggestForm({
  slug,
  accountId,
  month,
  monthName,
  cadence,
}: {
  slug: string;
  accountId: string;
  month: string;
  monthName: string;
  cadence: { summary: string; saved: boolean; free: number; href: string };
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        setDone(null);
        start(async () => {
          const r = await suggestPlan(slug, { accountId, month, hint: String(fd.get("hint") ?? "") || undefined });
          if (!r.ok) return setError(r.error);
          setDone(`${r.added} temas adicionados nas vagas da cadência. Revise e gere as legendas e artes.`);
        });
      }}
    >
      <h2 className="text-[15px] font-semibold">Sugerir temas com IA</h2>
      <div className="flex flex-col gap-1 rounded-md border border-brand/30 bg-brand-soft/60 px-3 py-2.5 text-[14px]">
        <p>
          <span className="font-semibold text-brand-dark">Cadência:</span> {cadence.summary}
          {cadence.saved ? "" : " (padrão)"}
        </p>
        <p className="text-[13px] text-text-2 tabular-nums">
          {cadence.free === 0 ? `Nenhuma vaga livre em ${monthName}.` : `${cadence.free} ${cadence.free === 1 ? "vaga livre" : "vagas livres"} em ${monthName}.`}
        </p>
        <Link href={cadence.href} className="inline-flex min-h-10 items-center self-start font-semibold text-brand-dark underline">
          Editar cadência
        </Link>
      </div>
      <Field label="Orientação (opcional)" htmlFor="s-hint">
        <Input id="s-hint" name="hint" maxLength={300} placeholder="Ex.: campanha de fim de ano" className="w-full" />
      </Field>
      <p className="text-[13px] text-muted-fg">A IA dá um tema para cada vaga livre, no dia, horário e formato da cadência. Reels sai com legenda; o vídeo é enviado pela equipe no item.</p>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {done ? <Notice tone="success">{done}</Notice> : null}
      <Button type="submit" variant="secondary" disabled={pending || cadence.free === 0} className="self-start">
        {pending ? "Pensando nos temas…" : `Sugerir temas para ${monthName}`}
      </Button>
    </form>
  );
}

/** Gera um post por vez, para cada chamada caber no tempo da função e o progresso aparecer. */
export function GenerateAll({ slug, ids }: { slug: string; ids: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const errs: string[] = [];
            for (const [i, id] of ids.entries()) {
              setProgress(`Gerando ${i + 1} de ${ids.length}…`);
              const r = await generateItem(slug, id);
              if (!r.ok) {
                errs.push(r.error);
                // Sem chave ou recusa da conta: não adianta seguir
                if (/configurada|chave/.test(r.error)) break;
              }
              router.refresh();
            }
            setErrors([...new Set(errs)]);
            setProgress(null);
          })
        }
      >
        {progress ?? "Gerar legendas e criativos"}
      </Button>
      {pending ? <p className="text-[13px] text-text-2">Pode levar alguns minutos. Mantenha esta página aberta.</p> : null}
      {errors.length ? <ErrorNote>{errors.join(" ")}</ErrorNote> : null}
    </div>
  );
}

export function RowActions({ slug, postId, canGenerate, regenerate }: { slug: string; postId: string; canGenerate: boolean; regenerate: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const btn = "h-10 rounded-md px-2.5 text-[13px] font-semibold transition-[background-color,transform] duration-150 hover:bg-muted active:scale-[.98] disabled:opacity-60";
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-nowrap items-center justify-end gap-1 whitespace-nowrap">
        {canGenerate ? (
          <button className={btn} disabled={pending} onClick={() => start(async () => setError(((r) => (r.ok ? null : r.error))(await generateItem(slug, postId))))}>
            {pending ? "Gerando…" : regenerate ? "Gerar de novo" : "Gerar"}
          </button>
        ) : null}
        <Link href={`/${slug}/planejamento/${postId}`} className={`${btn} inline-flex items-center`}>
          Abrir
        </Link>
        {canGenerate ? (
          <button className={`${btn} text-text-2`} disabled={pending} onClick={() => start(async () => setError(((r) => (r.ok ? null : r.error))(await removePlanItem(slug, postId))))}>
            Remover
          </button>
        ) : null}
      </div>
      {error ? (
        <span role="alert" className="max-w-72 text-right text-[13px] text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}
