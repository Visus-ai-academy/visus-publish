import { z } from "zod";
import { sortSlots, type Slot } from "@/lib/plan/cadence";
import type { Brand } from "./caption";
import { FORMAT_WORD } from "./plan";

const DAY = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6, "sáb": 6 } as const;

export const cadenceOutputSchema = z.object({
  vagas: z
    .array(
      z.object({
        dia: z.string().trim().toLowerCase(),
        horario: z.string().regex(/^\d{1,2}:\d{2}$/),
        formato: z.enum(["foto", "carrossel", "reels", "stories"]),
      }),
    )
    .min(1)
    .max(40),
  motivo: z.string().trim().max(600).optional().default(""),
});

/** Converte a resposta em vagas válidas; descarta dia ou horário inválido e repetições. */
export function toSlots(out: z.infer<typeof cadenceOutputSchema>): Slot[] {
  const seen = new Set<string>();
  const slots: Slot[] = [];
  for (const v of out.vagas) {
    const weekday = DAY[v.dia.slice(0, 3) as keyof typeof DAY];
    const time = v.horario.padStart(5, "0");
    if (weekday === undefined || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || seen.has(`${weekday} ${time}`)) continue;
    seen.add(`${weekday} ${time}`);
    slots.push({ weekday, time, format: FORMAT_WORD[v.formato] });
  }
  return sortSlots(slots);
}

export function cadencePrompt(i: { username: string; niche: string; brand?: Brand | null; hint?: string }): { system: string; user: string } {
  const b = i.brand ?? {};
  const system = [
    "Você é estrategista de conteúdo para Instagram e escreve em português do Brasil.",
    "Proponha uma cadência semanal de publicação realista para o nicho informado: quais dias, em que horários e em qual formato (foto, carrossel, reels, stories).",
    "Considere os horários em que o público desse nicho mais usa o Instagram, a capacidade de produção de uma equipe pequena e a mistura de formatos que dá alcance (reels) e autoridade (carrossel).",
    "Entre 3 e 10 vagas por semana, horários entre 07:00 e 22:00, no máximo 2 posts de feed por dia.",
    'Responda só com JSON: {"vagas": [{"dia": "seg"|"ter"|"qua"|"qui"|"sex"|"sab"|"dom", "horario": "HH:MM", "formato": "foto"|"carrossel"|"reels"|"stories"}], "motivo": string}.',
    "motivo: até 2 frases explicando a escolha.",
  ].join("\n");
  const user = [
    `Conta: @${i.username}.`,
    `Nicho: ${i.niche}`,
    b.audience ? `Público: ${b.audience}` : "",
    b.tone ? `Tom de voz: ${b.tone}` : "",
    i.hint ? `Orientação: ${i.hint}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { system, user };
}
