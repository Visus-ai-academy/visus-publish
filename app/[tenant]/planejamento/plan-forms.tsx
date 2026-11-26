"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { ErrorNote } from "@/components/ui/states";
import { Notice } from "@/components/ui/status";
import { FORMATS, FORMAT_LABELS, type Format } from "@/lib/posts/upload";
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
      <div className="grid grid-cols-2 gap-3">
        <Field label="Dia" htmlFor="p-date">
          <Input id="p-date" name="date" type="date" required defaultValue={defaultDate} />
        </Field>
        <Field label="Horário" htmlFor="p-time">
          <Input id="p-time" name="time" type="time" required defaultValue="18:00" />
        </Field>
      </div>
      <Field label="Formato" htmlFor="p-format">
        <Select id="p-format" name="format" defaultValue="image">
          {FORMATS.map((f) => (
            <option key={f} value={f}>
              {FORMAT_LABELS[f]}
            </option>
          ))}
        </Select>
      </Field>
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

export function SuggestForm({ slug, accountId, month, monthName }: { slug: string; accountId: string; month: string; monthName: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [formats, setFormats] = useState<Format[]>(["image", "carousel", "reels"]);
  const toggle = (f: Format) => setFormats((s) => (s.includes(f) ? s.filter((x) => x !== f) : [...s, f]));
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        setDone(null);
        start(async () => {
          const r = await suggestPlan(slug, { accountId, month, count: fd.get("count"), hint: String(fd.get("hint") ?? "") || undefined, formats });
          if (!r.ok) return setError(r.error);
          setDone(`${r.added} temas adicionados. Revise e gere as legendas e artes.`);
        });
      }}
    >
      <h2 className="text-[15px] font-semibold">Sugerir temas com IA</h2>
      <div className="grid grid-cols-[120px_1fr] gap-3">
        <Field label="Quantidade" htmlFor="s-count">
          <Select id="s-count" name="count" defaultValue="8">
            {[4, 8, 12, 16].map((n) => (
              <option key={n} value={n}>
                {n} posts
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Orientação (opcional)" htmlFor="s-hint">
          <Input id="s-hint" name="hint" maxLength={300} placeholder="Ex.: campanha de fim de ano" />
        </Field>
      </div>
      <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
        <legend className="mb-1 text-[13px] font-medium text-text-2">Formatos</legend>
        {FORMATS.map((f) => (
          <label key={f} className="inline-flex min-h-10 items-center gap-2 text-[14px]">
            <input type="checkbox" checked={formats.includes(f)} onChange={() => toggle(f)} className="size-4 accent-[#14161A]" />
            {FORMAT_LABELS[f]}
          </label>
        ))}
      </fieldset>
      <p className="text-[13px] text-muted-fg">Reels sai com legenda; o vídeo é enviado pela equipe no item.</p>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {done ? <Notice tone="success">{done}</Notice> : null}
      <Button type="submit" variant="secondary" disabled={pending || !formats.length} className="self-start">
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
    <div className="flex flex-wrap items-center justify-end gap-1">
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
      {error ? (
        <span role="alert" className="basis-full text-right text-[13px] text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}
