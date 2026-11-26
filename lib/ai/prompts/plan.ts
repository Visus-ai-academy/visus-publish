import { z } from "zod";
import type { Format } from "@/lib/posts/upload";
import { WEEKDAY_SHORT, type MonthSlot } from "@/lib/plan/cadence";
import type { Brand } from "./caption";

export const FORMAT_WORD = { foto: "image", carrossel: "carousel", reels: "reels", stories: "story" } as const satisfies Record<string, Format>;

/** A IA dá um tema para cada vaga numerada da cadência. */
export const themesOutputSchema = z.object({
  temas: z
    .array(z.object({ vaga: z.coerce.number().int().min(1), tema: z.string().trim().min(3).max(120) }))
    .min(1)
    .max(60),
});

export type ThemeItem = { date: string; day: number; time: string; format: Format; theme: string };

/** Junta os temas às vagas; ignora vaga inexistente, repetida ou tema repetido. */
export function toItems(out: z.infer<typeof themesOutputSchema>, slots: MonthSlot[]): ThemeItem[] {
  const seenSlot = new Set<number>();
  const seenTheme = new Set<string>();
  const items: ThemeItem[] = [];
  for (const t of out.temas) {
    const slot = slots[t.vaga - 1];
    const theme = t.tema.replace(/\s+/g, " ");
    if (!slot || seenSlot.has(t.vaga) || seenTheme.has(theme.toLowerCase())) continue;
    seenSlot.add(t.vaga);
    seenTheme.add(theme.toLowerCase());
    items.push({ ...slot, theme });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

export type ThemesPromptInput = {
  monthLabel: string;
  username: string;
  brand?: Brand | null;
  niche?: string | null;
  existing: string[];
  hint?: string;
  slots: MonthSlot[];
};

const WORD: Record<Format, string> = { image: "foto", carousel: "carrossel", reels: "reels", story: "stories" };

export function themesPrompt(i: ThemesPromptInput): { system: string; user: string } {
  const b = i.brand ?? {};
  const system = [
    "Você é estrategista de conteúdo para Instagram e escreve em português do Brasil.",
    `Monte um calendário editorial: dê um tema para cada uma das ${i.slots.length} vagas abaixo, já com dia, horário e formato definidos.`,
    "Varie os assuntos (dicas, bastidores, institucional, perguntas frequentes, prova de autoridade) e combine o tema com o formato da vaga.",
    "tema: título curto e específico, até 80 caracteres, sem hashtag nem emoji. Não repita temas.",
    'Responda só com JSON: {"temas": [{"vaga": number, "tema": string}]}, uma entrada por vaga.',
    b.is_healthcare ? "Perfil de saúde: siga a publicidade médica do CFM/CRO (sem promessa de resultado, antes e depois, preço ou superlativo)." : "",
  ]
    .filter(Boolean)
    .join("\n");
  const vagas = i.slots.map((s, n) => `${n + 1}. ${WEEKDAY_SHORT[new Date(`${s.date}T12:00:00Z`).getUTCDay()]} ${s.day}, ${s.time}, ${WORD[s.format]}`);
  const user = [
    `Mês: ${i.monthLabel}. Conta: @${i.username}.`,
    i.niche ? `Nicho: ${i.niche}` : "",
    b.tone ? `Tom de voz: ${b.tone}` : "",
    b.audience ? `Público: ${b.audience}` : "",
    b.forbidden_topics ? `Não fale de: ${b.forbidden_topics}` : "",
    i.existing.length ? `Já planejados (não repita): ${i.existing.slice(0, 40).join("; ")}` : "",
    i.hint ? `Orientação: ${i.hint}` : "",
    `Vagas:\n${vagas.join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n");
  return { system, user };
}

export const ASPECT: Record<Format, "4:5" | "9:16"> = { image: "4:5", carousel: "4:5", reels: "9:16", story: "9:16" };

/** Prompt da arte: tema + brief visual + proporção + texto curto a escrever na imagem. */
export function imagePrompt(i: { theme: string; title: string; body?: string; format: Format; brand?: Brand | null; slide?: { n: number; total: number }; hint?: string }): string {
  const b = i.brand ?? {};
  return [
    `Arte para Instagram (${ASPECT[i.format]}${i.format === "story" ? ", Stories" : ", feed"}) sobre: ${i.theme}.`,
    i.slide ? `Slide ${i.slide.n} de ${i.slide.total} de um carrossel; mantenha o mesmo estilo em todos os slides.` : "",
    `Escreva na arte, em português do Brasil, com ortografia correta e letras legíveis: "${i.title}"${i.body ? ` e, menor, "${i.body}"` : ""}.`,
    b.colors?.length ? `Cores da marca: ${b.colors.join(", ")}.` : "",
    b.fonts?.length ? `Tipografia parecida com: ${b.fonts.join(", ")}.` : "",
    "Visual limpo e profissional, boa margem nas bordas, sem logotipos de terceiros, sem marca d'água.",
    b.is_healthcare ? "Não mostre antes e depois, resultados de procedimentos nem pessoas em sofrimento." : "",
    i.hint ? `Pedido de ajuste de quem está postando (siga, sem quebrar as regras acima): ${i.hint}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
