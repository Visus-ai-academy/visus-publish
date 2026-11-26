import { z } from "zod";
import type { Format } from "@/lib/posts/upload";
import type { Brand } from "./caption";

const FORMAT_WORD = { foto: "image", carrossel: "carousel", reels: "reels", stories: "story" } as const satisfies Record<string, Format>;

export const themesOutputSchema = z.object({
  itens: z
    .array(
      z.object({
        dia: z.coerce.number().int().min(1).max(31),
        horario: z.string().regex(/^\d{1,2}:\d{2}$/),
        formato: z.enum(["foto", "carrossel", "reels", "stories"]),
        tema: z.string().trim().min(3).max(120),
      }),
    )
    .min(1)
    .max(40),
});

export type ThemeItem = { day: number; time: string; format: Format; theme: string };

export function toItems(out: z.infer<typeof themesOutputSchema>, daysInMonth: number, minDay: number): ThemeItem[] {
  const seen = new Set<string>();
  return out.itens
    .map((i) => ({ day: i.dia, time: i.horario.padStart(5, "0"), format: FORMAT_WORD[i.formato], theme: i.tema.replace(/\s+/g, " ") }))
    .filter((i) => i.day >= minDay && i.day <= daysInMonth && /^([01]\d|2[0-3]):[0-5]\d$/.test(i.time))
    .filter((i) => !seen.has(i.theme.toLowerCase()) && (seen.add(i.theme.toLowerCase()), true));
}

export type ThemesPromptInput = {
  monthLabel: string;
  count: number;
  firstDay: number;
  daysInMonth: number;
  username: string;
  brand?: Brand | null;
  existing: string[];
  hint?: string;
  formats: Format[];
};

const WORD: Record<Format, string> = { image: "foto", carousel: "carrossel", reels: "reels", story: "stories" };

export function themesPrompt(i: ThemesPromptInput): { system: string; user: string } {
  const b = i.brand ?? {};
  const system = [
    "Você é estrategista de conteúdo para Instagram e escreve em português do Brasil.",
    `Monte um calendário editorial com ${i.count} posts variados (dicas, bastidores, institucional, perguntas frequentes, prova de autoridade).`,
    `Use dias entre ${i.firstDay} e ${i.daysInMonth}, espalhados pelo mês, em horários de bom alcance (entre 08:00 e 21:00).`,
    `Formatos permitidos: ${i.formats.map((f) => WORD[f]).join(", ")}.`,
    "tema: título curto e específico, até 80 caracteres, sem hashtag nem emoji.",
    'Responda só com JSON: {"itens": [{"dia": number, "horario": "HH:MM", "formato": "foto"|"carrossel"|"reels"|"stories", "tema": string}]}.',
    b.is_healthcare ? "Perfil de saúde: siga a publicidade médica do CFM/CRO (sem promessa de resultado, antes e depois, preço ou superlativo)." : "",
  ]
    .filter(Boolean)
    .join("\n");
  const user = [
    `Mês: ${i.monthLabel}. Conta: @${i.username}.`,
    b.tone ? `Tom de voz: ${b.tone}` : "",
    b.audience ? `Público: ${b.audience}` : "",
    b.forbidden_topics ? `Não fale de: ${b.forbidden_topics}` : "",
    i.existing.length ? `Já planejados (não repita): ${i.existing.slice(0, 40).join("; ")}` : "",
    i.hint ? `Orientação: ${i.hint}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { system, user };
}

export const ASPECT: Record<Format, "4:5" | "9:16"> = { image: "4:5", carousel: "4:5", reels: "9:16", story: "9:16" };

/** Prompt da arte: tema + brief visual + proporção + texto curto a escrever na imagem. */
export function imagePrompt(i: { theme: string; title: string; body?: string; format: Format; brand?: Brand | null; slide?: { n: number; total: number } }): string {
  const b = i.brand ?? {};
  return [
    `Arte para Instagram (${ASPECT[i.format]}${i.format === "story" ? ", Stories" : ", feed"}) sobre: ${i.theme}.`,
    i.slide ? `Slide ${i.slide.n} de ${i.slide.total} de um carrossel; mantenha o mesmo estilo em todos os slides.` : "",
    `Escreva na arte, em português do Brasil, com ortografia correta e letras legíveis: "${i.title}"${i.body ? ` e, menor, "${i.body}"` : ""}.`,
    b.colors?.length ? `Cores da marca: ${b.colors.join(", ")}.` : "",
    b.fonts?.length ? `Tipografia parecida com: ${b.fonts.join(", ")}.` : "",
    "Visual limpo e profissional, boa margem nas bordas, sem logotipos de terceiros, sem marca d'água.",
    b.is_healthcare ? "Não mostre antes e depois, resultados de procedimentos nem pessoas em sofrimento." : "",
  ]
    .filter(Boolean)
    .join("\n");
}
