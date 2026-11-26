import { z } from "zod";
import { FORMATS, type Format } from "@/lib/posts/upload";

/** Dias da semana como Date.getUTCDay(): 0 = domingo. */
export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;
export const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

export const slotSchema = z.object({
  weekday: z.coerce.number().int().min(0).max(6),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido."),
  format: z.enum(FORMATS),
});
export type Slot = z.infer<typeof slotSchema>;

export const cadenceSchema = z
  .array(slotSchema)
  .max(40, "No máximo 40 vagas por semana.")
  .refine((s) => new Set(s.map((x) => `${x.weekday} ${x.time}`)).size === s.length, "Há duas vagas no mesmo dia e horário.");

/** Padrão de uma conta nova (editável): 5 posts por semana, formatos variados. */
export const DEFAULT_CADENCE: Slot[] = [
  { weekday: 1, time: "18:00", format: "image" },
  { weekday: 2, time: "12:00", format: "carousel" },
  { weekday: 3, time: "18:00", format: "image" },
  { weekday: 4, time: "12:00", format: "reels" },
  { weekday: 5, time: "18:00", format: "carousel" },
];

export function sortSlots(slots: Slot[]): Slot[] {
  // Segunda primeiro, domingo por último (como na agenda de trabalho)
  const order = (d: number) => (d + 6) % 7;
  return [...slots].sort((a, b) => order(a.weekday) - order(b.weekday) || a.time.localeCompare(b.time));
}

/** Lê o jsonb salvo; dados inválidos viram cadência vazia (nunca quebram a tela). */
export function readCadence(raw: unknown): Slot[] {
  const r = cadenceSchema.safeParse(raw);
  return r.success ? sortSlots(r.data) : [];
}

export type MonthSlot = { date: string; day: number; time: string; format: Format };

/**
 * Vagas do mês ("2026-12") a partir do dia `firstDay`, sem as que já têm post
 * (`taken` guarda "YYYY-MM-DD HH:MM" no fuso do cliente).
 */
export function monthSlots(month: string, slots: Slot[], firstDay: number, taken: Set<string>): MonthSlot[] {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: MonthSlot[] = [];
  for (let d = Math.max(1, firstDay); d <= days; d++) {
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const date = `${month}-${String(d).padStart(2, "0")}`;
    for (const s of slots) {
      if (s.weekday !== weekday || taken.has(`${date} ${s.time}`)) continue;
      out.push({ date, day: d, time: s.time, format: s.format });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

export function weeklySummary(slots: Slot[]): string {
  if (!slots.length) return "Nenhuma vaga definida";
  const days = new Set(slots.map((s) => s.weekday)).size;
  return `${slots.length} ${slots.length === 1 ? "post" : "posts"} por semana em ${days} ${days === 1 ? "dia" : "dias"}`;
}
