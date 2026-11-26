"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { ErrorNote } from "@/components/ui/states";
import { Notice } from "@/components/ui/status";
import { expandRows, groupSlots, WEEKDAYS, WEEKDAY_SHORT, weeklySummary, type Slot, type SlotRow } from "@/lib/plan/cadence";
import { FORMATS, FORMAT_LABELS, type Format } from "@/lib/posts/upload";
import { proposeCadence, saveCadence } from "../actions";

// Segunda primeiro, como na agenda de trabalho
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const short = (d: number) => WEEKDAY_SHORT[d][0].toUpperCase() + WEEKDAY_SHORT[d].slice(1);
const sortDays = (days: number[]) => [...days].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));

export function CadenceEditor({
  slug,
  accountId,
  username,
  initial,
  initialNiche,
  saved,
  canEdit,
  back,
}: {
  slug: string;
  accountId: string;
  username: string;
  initial: Slot[];
  initialNiche: string;
  saved: boolean;
  canEdit: boolean;
  back: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<SlotRow[]>(() => groupSlots(initial));
  const slots = expandRows(rows);
  const [niche, setNiche] = useState(initialNiche);
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [dirty, setDirty] = useState(!saved);
  const [saving, startSave] = useTransition();
  const [thinking, startThink] = useTransition();

  const touch = () => {
    setDirty(true);
    setDone(null);
  };
  const update = (i: number, patch: Partial<SlotRow>) => {
    setRows((r) => r.map((x, n) => (n === i ? { ...x, ...patch } : x)));
    touch();
  };
  const toggleDay = (i: number, d: number) => {
    const days = rows[i].days;
    update(i, { days: sortDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d]) });
  };
  const remove = (i: number) => {
    setRows((r) => r.filter((_, n) => n !== i));
    touch();
  };
  const add = () => {
    // Começa num horário ainda livre na segunda, para não repetir um slot existente
    setRows((r) => {
      const used = new Set(r.filter((x) => x.days.includes(1)).map((x) => x.time));
      const time = ["18:00", "12:00", "09:00", "20:00", "15:00"].find((t) => !used.has(t)) ?? "10:00";
      return [...r, { days: [1], time, format: "image" }];
    });
    touch();
  };

  return (
    <section className="flex flex-wrap items-start gap-5">
      <div className="flex min-w-0 flex-[3_1_640px] flex-col gap-4 rounded-lg border border-border p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-semibold">Semana de @{username}</h2>
          <p className="text-[13px] text-text-2 tabular-nums">
            {weeklySummary(slots)}
            {saved ? "" : " · padrão, ainda não salvo"}
          </p>
        </div>
        {rows.length === 0 ? (
          <p className="rounded-md bg-subtle px-3 py-6 text-center text-[14px] text-text-2">Nenhum slot de post. Adicione dias e horários ou peça uma sugestão à IA.</p>
        ) : (
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-brand/40 text-left text-[13px] text-brand-dark">
                <th className="py-2 pr-3 font-medium">Dias da semana</th>
                <th className="py-2 pr-3 font-medium">Horário</th>
                <th className="py-2 pr-3 font-medium">Formato</th>
                <th className="py-2 font-medium">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const all = r.days.length === 7;
                return (
                  <tr key={i} className="border-b border-row align-top">
                    <td className="py-2 pr-3">
                      <div role="group" aria-label={`Dias do slot ${i + 1}`} className="flex flex-wrap gap-1">
                        {DAY_ORDER.map((d) => {
                          const on = r.days.includes(d);
                          return (
                            <button
                              key={d}
                              type="button"
                              disabled={!canEdit}
                              aria-pressed={on}
                              aria-label={WEEKDAYS[d]}
                              title={WEEKDAYS[d]}
                              onClick={() => toggleDay(i, d)}
                              className={`h-10 min-w-10 rounded-md border px-1.5 text-[13px] font-semibold transition-colors duration-150 active:scale-[.98] motion-reduce:transition-none ${on ? "border-brand bg-brand text-white" : "border-border text-text-2 hover:bg-brand-soft/60"}`}
                            >
                              {short(d)}
                            </button>
                          );
                        })}
                        {canEdit ? (
                          <button
                            type="button"
                            aria-pressed={all}
                            onClick={() => update(i, { days: all ? [r.days[0] ?? 1] : [...DAY_ORDER] })}
                            className="h-10 rounded-md px-2 text-[13px] font-semibold text-brand-dark underline hover:bg-brand-soft/60"
                          >
                            {all ? "Só um dia" : "Todos os dias"}
                          </button>
                        ) : null}
                      </div>
                      {r.days.length === 0 ? <p className="mt-1 text-[12px] text-danger">Escolha ao menos um dia.</p> : null}
                    </td>
                    <td className="py-2 pr-3">
                      <Input aria-label={`Horário do slot ${i + 1}`} type="time" value={r.time} disabled={!canEdit} onChange={(e) => update(i, { time: e.target.value })} className="w-32! tabular-nums" />
                    </td>
                    <td className="py-2 pr-3">
                      <Select aria-label={`Formato do slot ${i + 1}`} value={r.format} disabled={!canEdit} onChange={(e) => update(i, { format: e.target.value as Format })} className="w-36!">
                        {FORMATS.map((f) => (
                          <option key={f} value={f}>
                            {FORMAT_LABELS[f]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-2 text-right">
                      {canEdit ? (
                        <button type="button" onClick={() => remove(i)} className="h-10 rounded-md px-3 text-[13px] font-semibold text-text-2 hover:bg-muted" aria-label={`Remover slot ${i + 1}`}>
                          Remover
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {canEdit ? (
          <>
            <Button type="button" variant="secondary" onClick={add} disabled={slots.length >= 40} className="self-start">
              Adicionar slot de post
            </Button>
            {error ? <ErrorNote>{error}</ErrorNote> : null}
            {done ? <Notice tone="success">{done}</Notice> : null}
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <Button
                type="button"
                disabled={saving || !dirty}
                onClick={() => {
                  setError(null);
                  const empty = rows.findIndex((r) => r.days.length === 0);
                  if (empty >= 0) return setError(`Escolha ao menos um dia no slot ${empty + 1}.`);
                  startSave(async () => {
                    const r = await saveCadence(slug, { accountId, niche, slots });
                    if (!r.ok) return setError(r.error);
                    setRows(groupSlots(slots));
                    setDirty(false);
                    setReason(null);
                    setDone("Cadência salva. A sugestão de temas vai seguir estas vagas.");
                    router.refresh();
                  });
                }}
              >
                {saving ? "Salvando…" : "Salvar cadência"}
              </Button>
              {!dirty && done ? (
                <a href={back} className="inline-flex min-h-10 items-center font-semibold text-brand-dark underline">
                  Voltar e sugerir temas
                </a>
              ) : null}
            </div>
          </>
        ) : (
          <p className="text-[13px] text-text-2">Seu papel permite ver a cadência, mas não alterá-la.</p>
        )}
      </div>

      {canEdit ? (
        <form
          className="flex flex-[1_1_300px] flex-col gap-3 rounded-lg border border-border p-5"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            setError(null);
            setDone(null);
            startThink(async () => {
              const r = await proposeCadence(slug, { accountId, niche, hint: String(fd.get("hint") ?? "") || undefined });
              if (!r.ok) return setError(r.error);
              setRows(groupSlots(r.slots));
              setReason(r.reason || null);
              setDirty(true);
            });
          }}
        >
          <h2 className="text-[15px] font-semibold">Sugerir cadência com IA</h2>
          <Field label="Nicho do cliente" htmlFor="c-niche">
            <Input
              id="c-niche"
              value={niche}
              onChange={(e) => {
                setNiche(e.target.value);
                setDirty(true);
              }}
              maxLength={200}
              required
              placeholder="Ex.: clínica odontológica de estética em São Paulo"
              className="w-full"
            />
          </Field>
          <Field label="Orientação (opcional)" htmlFor="c-hint">
            <Input id="c-hint" name="hint" maxLength={300} placeholder="Ex.: equipe pequena, no máximo 4 posts por semana" className="w-full" />
          </Field>
          <p className="text-[13px] text-muted-fg">A IA propõe dias, horários e formatos. Nada é salvo até você revisar e clicar em Salvar cadência.</p>
          {reason ? <Notice tone="success">{`Sugestão da IA: ${reason} Revise a tabela e salve.`}</Notice> : null}
          <Button type="submit" variant="secondary" disabled={thinking} className="self-start">
            {thinking ? "Pensando na cadência…" : "Sugerir cadência"}
          </Button>
        </form>
      ) : null}
    </section>
  );
}
