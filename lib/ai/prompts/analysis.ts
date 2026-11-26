import { z } from "zod";
import type { Format } from "@/lib/posts/upload";
import { FORMAT_WORD } from "./plan";

/**
 * Achados da IA (SPEC §8). O modelo recebe só agregados da conta e devolve no máximo 5 achados,
 * cada um com uma ação opcional que o app sabe aplicar.
 */
const DAY_WORD = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6, "sáb": 6 } as const;

export const analysisOutputSchema = z.object({
  achados: z
    .array(
      z.object({
        titulo: z.string().trim().min(5).max(120),
        texto: z.string().trim().min(5).max(600),
        evidencia: z.record(z.string(), z.unknown()).optional().default({}),
        acao: z
          .object({
            tipo: z.enum(["mover_horario", "trocar_formato", "sugerir_temas", "nenhuma"]),
            de_hora: z.coerce.number().int().min(0).max(23).optional(),
            para_hora: z.coerce.number().int().min(0).max(23).optional(),
            dias: z.array(z.string()).optional(),
            de_formato: z.string().optional(),
            para_formato: z.string().optional(),
            angulo: z.string().trim().max(200).optional(),
          })
          .optional(),
      }),
    )
    .max(8),
});
export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;

export type FindingAction =
  | { type: "reschedule"; params: { from_hour: number; to_hour: number; weekdays?: number[] } }
  | { type: "change_format"; params: { from: Format; to: Format } }
  | { type: "suggest_themes"; params: { angle: string } }
  | { type: "none"; params: Record<string, never> };

export type Finding = { title: string; body: string; evidence: Record<string, unknown>; action: FindingAction };

const formatOf = (w: string | undefined): Format | null => {
  const k = (w ?? "").toLowerCase().trim().replace("story", "stories") as keyof typeof FORMAT_WORD;
  return FORMAT_WORD[k] ?? null;
};

/** Converte a resposta da IA em achados com ação válida (ação malformada vira "nenhuma"). */
export function toFindings(out: AnalysisOutput): Finding[] {
  return out.achados.slice(0, 5).map((a): Finding => {
    const base = { title: a.titulo, body: a.texto, evidence: a.evidencia ?? {} };
    const x = a.acao;
    if (x?.tipo === "mover_horario" && x.de_hora !== undefined && x.para_hora !== undefined && x.de_hora !== x.para_hora) {
      const days = [...new Set((x.dias ?? []).map((d) => DAY_WORD[d.toLowerCase().slice(0, 3) as keyof typeof DAY_WORD]).filter((d) => d !== undefined))];
      return { ...base, action: { type: "reschedule", params: { from_hour: x.de_hora, to_hour: x.para_hora, ...(days.length ? { weekdays: days } : {}) } } };
    }
    if (x?.tipo === "trocar_formato") {
      const from = formatOf(x.de_formato);
      const to = formatOf(x.para_formato);
      if (from && to && from !== to) return { ...base, action: { type: "change_format", params: { from, to } } };
    }
    if (x?.tipo === "sugerir_temas" && x.angulo) return { ...base, action: { type: "suggest_themes", params: { angle: x.angulo } } };
    return { ...base, action: { type: "none", params: {} } };
  });
}

export type AnalysisInput = {
  username: string;
  days: number;
  isHealthcare: boolean;
  /** Agregados já calculados pelo app (nada de dado bruto de terceiros). */
  data: Record<string, unknown>;
};

export function analysisPrompt(i: AnalysisInput): { system: string; user: string } {
  const system = [
    "Você é analista de desempenho de Instagram e escreve em português do Brasil, de forma direta e simples.",
    "Recebe só números agregados de uma conta e devolve achados úteis para quem planeja os posts.",
    "Regras:",
    "- Use apenas números que aparecem nos dados. Não invente métricas, médias ou comparações.",
    "- Engajamento = (curtidas + comentários + salvos + compartilhamentos) / alcance.",
    "- Célula do mapa de calor com menos de 3 posts não é conclusão: não baseie achado nela.",
    "- No máximo 5 achados, do mais importante para o menos. Título curto (até 80 caracteres) com o número principal.",
    "- texto: 1 ou 2 frases com a evidência e o que fazer.",
    "- Ações que o app aplica sozinho:",
    '  mover_horario: move os posts futuros marcados na hora "de_hora" para "para_hora" (horas cheias, 0 a 23). Opcional "dias" (seg, ter, qua, qui, sex, sab, dom). Só proponha se em "proximos" houver posts na hora de origem.',
    '  trocar_formato: troca o formato dos posts planejados ainda sem arte ("de_formato" → "para_formato": foto, carrossel, reels, stories). Só proponha se em "proximos" houver posts planejados nesse formato.',
    '  sugerir_temas: um ângulo de conteúdo ("angulo") que a IA vai priorizar ao sugerir os próximos temas.',
    "  nenhuma: achado só informativo.",
    "- Sem emojis e sem hashtags.",
    i.isHealthcare ? "- Perfil de saúde: nada de promessa de resultado, antes e depois, preço ou superlativo (CFM/CRO)." : "",
    'Responda só com JSON: {"achados": [{"titulo": string, "texto": string, "evidencia": object, "acao": {"tipo": string, ...}}]}',
  ]
    .filter(Boolean)
    .join("\n");
  const user = [`Conta: @${i.username}. Período: últimos ${i.days} dias.`, `Dados:\n${JSON.stringify(i.data)}`].join("\n");
  return { system, user };
}
