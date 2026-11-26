"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { ErrorNote } from "@/components/ui/states";
import { Notice } from "@/components/ui/status";
import { sortSlots, WEEKDAYS, weeklySummary, type Slot } from "@/lib/plan/cadence";
import { FORMATS, FORMAT_LABELS, type Format } from "@/lib/posts/upload";
import { proposeCadence, saveCadence } from "../actions";

// Segunda primeiro, como na agenda de trabalho
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

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
  const [slots, setSlots] = useState<Slot[]>(initial);
  const [niche, setNiche] = useState(initialNiche);
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [dirty, setDirty] = useState(!saved);
  const [saving, startSave] = useTransition();
  const [thinking, startThink] = useTransition();

  const update = (i: number, patch: Partial<Slot>) => {
    setSlots((s) => s.map((x, n) => (n === i ? { ...x, ...patch } : x)));
    setDirty(true);
    setDone(null);
  };
  const remove = (i: number) => {
    setSlots((s) => s.filter((_, n) => n !== i));
    setDirty(true);
    setDone(null);
  };
  const add = () => {
    setSlots((s) => [...s, { weekday: 1, time: "18:00", format: "image" }]);
    setDirty(true);
    setDone(null);
  };

  return (
    <section className="flex flex-wrap items-start gap-5">
      <div className="flex min-w-0 flex-[2_1_520px] flex-col gap-4 rounded-lg border border-border p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-semibold">Semana de @{username}</h2>
          <p className="text-[13px] text-text-2 tabular-nums">
            {weeklySummary(slots)}
            {saved ? "" : " · padrão, ainda não salvo"}
          </p>
        </div>
        {slots.length === 0 ? (
          <p className="rounded-md bg-subtle px-3 py-6 text-center text-[14px] text-text-2">Nenhuma vaga. Adicione dias e horários ou peça uma sugestão à IA.</p>
        ) : (
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-brand/40 text-left text-[13px] text-brand-dark">
                <th className="py-2 pr-3 font-medium">Dia da semana</th>
                <th className="py-2 pr-3 font-medium">Horário</th>
                <th className="py-2 pr-3 font-medium">Formato</th>
                <th className="py-2 font-medium">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {slots.map((s, i) => (
                <tr key={i} className="border-b border-row">
                  <td className="py-2 pr-3">
                    <Select aria-label={`Dia da vaga ${i + 1}`} value={s.weekday} disabled={!canEdit} onChange={(e) => update(i, { weekday: Number(e.target.value) })}>
                      {DAY_ORDER.map((d) => (
                        <option key={d} value={d}>
                          {WEEKDAYS[d]}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="py-2 pr-3">
                    <Input aria-label={`Horário da vaga ${i + 1}`} type="time" value={s.time} disabled={!canEdit} onChange={(e) => update(i, { time: e.target.value })} className="tabular-nums" />
                  </td>
                  <td className="py-2 pr-3">
                    <Select aria-label={`Formato da vaga ${i + 1}`} value={s.format} disabled={!canEdit} onChange={(e) => update(i, { format: e.target.value as Format })}>
                      {FORMATS.map((f) => (
                        <option key={f} value={f}>
                          {FORMAT_LABELS[f]}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="py-2 text-right">
                    {canEdit ? (
                      <button type="button" onClick={() => remove(i)} className="h-10 rounded-md px-3 text-[13px] font-semibold text-text-2 hover:bg-muted" aria-label={`Remover vaga ${i + 1}`}>
                        Remover
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit ? (
          <>
            <Button type="button" variant="secondary" onClick={add} disabled={slots.length >= 40} className="self-start">
              Adicionar vaga
            </Button>
            {error ? <ErrorNote>{error}</ErrorNote> : null}
            {done ? <Notice tone="success">{done}</Notice> : null}
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <Button
                type="button"
                disabled={saving || !dirty}
                onClick={() => {
                  setError(null);
                  startSave(async () => {
                    const sorted = sortSlots(slots);
                    const r = await saveCadence(slug, { accountId, niche, slots: sorted });
                    if (!r.ok) return setError(r.error);
                    setSlots(sorted);
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
              setSlots(r.slots);
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
