import { z } from "zod";
import type { Format } from "@/lib/posts/upload";

export const CAPTION_MAX = 2200;
export const HASHTAG_MAX = 30;

/** Saída que a IA precisa devolver (JSON). */
export const captionOutputSchema = z.object({
  tema: z.string().trim().min(2).max(200),
  legenda: z.string().max(10_000).default(""),
  hashtags: z.array(z.string()).max(60).default([]),
  riscos: z.array(z.string()).max(20).default([]),
});
export type CaptionOutput = z.infer<typeof captionOutputSchema>;

export type Brand = {
  tone?: string | null;
  audience?: string | null;
  forbidden_topics?: string | null;
  default_hashtags?: string[] | null;
  is_healthcare?: boolean | null;
};

export type CaptionPromptInput = {
  format: Format;
  mediaKind: "image" | "video";
  frameCount: number;
  username: string;
  hint?: string;
  brand?: Brand | null;
};

const FORMAT_NAME: Record<Format, string> = { image: "post de foto no feed", carousel: "carrossel no feed", reels: "Reels", story: "Stories" };

const HEALTH_RULES = `Este perfil é de saúde. Siga as regras de publicidade médica do CFM e do CRO:
- não prometa resultado, cura nem ausência de dor;
- não use antes e depois, superlativos ("o melhor"), exclusividade ou termos sensacionalistas;
- não anuncie preço, desconto ou promoção;
- informe e eduque, sem induzir a procurar um procedimento.
Se a imagem ou o vídeo mostrar algo que fira essas regras (por exemplo, antes e depois), descreva o problema em "riscos".`;

export function captionPrompt(input: CaptionPromptInput): { system: string; user: string } {
  const b = input.brand ?? {};
  const story = input.format === "story";
  const system = [
    "Você é redator de redes sociais e escreve em português do Brasil.",
    "Olhe a mídia enviada e escreva o tema e a legenda de um post do Instagram sobre o que ela mostra.",
    "Não invente fatos que a mídia não mostra (nomes, preços, datas, lugares).",
    'Responda só com JSON no formato {"tema": string, "legenda": string, "hashtags": string[], "riscos": string[]}.',
    "tema: título curto do post, até 80 caracteres, sem hashtag nem emoji.",
    story
      ? 'legenda: "" (Stories não têm legenda). hashtags: [].'
      : `legenda: texto do post com gancho na primeira linha, parágrafos curtos e chamada para ação no fim; até ${CAPTION_MAX - 300} caracteres, sem hashtags no texto.`,
    story ? "" : `hashtags: de 5 a 15 hashtags relevantes, cada uma começando com #. Nunca mais de ${HASHTAG_MAX}.`,
    'riscos: lista de problemas de conformidade encontrados; [] se nenhum.',
    b.is_healthcare ? HEALTH_RULES : "",
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    `Formato: ${FORMAT_NAME[input.format]}. Conta: @${input.username}.`,
    input.mediaKind === "video"
      ? `A mídia é um vídeo; seguem ${input.frameCount} quadros em ordem.`
      : input.frameCount > 1
        ? `Seguem ${input.frameCount} imagens do carrossel em ordem.`
        : "Segue a imagem do post.",
    b.tone ? `Tom de voz: ${b.tone}` : "",
    b.audience ? `Público: ${b.audience}` : "",
    b.forbidden_topics ? `Não fale de: ${b.forbidden_topics}` : "",
    input.hint ? `Orientação de quem está postando: ${input.hint}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
}

function normalizeTag(t: string): string | null {
  const v = t.trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
  return v ? `#${v}` : null;
}

/** Corta no último espaço antes do limite. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return (at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd();
}

/**
 * Monta a legenda final: texto + hashtags (fixas da marca primeiro), sem repetir,
 * respeitando 2.200 caracteres e 30 hashtags no total.
 */
export function composeCaption(out: CaptionOutput, format: Format, defaults: readonly string[] = []): { theme: string; caption: string } {
  const theme = clip(out.tema.replace(/\s+/g, " ").trim(), 120);
  if (format === "story") return { theme, caption: "" };

  let text = out.legenda.trim();
  const inText = new Set((text.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((t) => t.toLowerCase()));
  // hashtags que a IA deixou no texto contam no limite
  let room = HASHTAG_MAX - inText.size;
  if (room < 0) {
    let seen = 0;
    text = text.replace(/#[\p{L}\p{N}_]+/gu, (m) => (++seen > HASHTAG_MAX ? "" : m)).replace(/[ \t]+\n/g, "\n");
    room = 0;
  }
  const tags: string[] = [];
  for (const raw of [...defaults, ...out.hashtags]) {
    const t = normalizeTag(raw);
    if (!t || inText.has(t.toLowerCase()) || tags.some((x) => x.toLowerCase() === t.toLowerCase())) continue;
    if (tags.length >= room) break;
    tags.push(t);
  }

  text = clip(text, CAPTION_MAX);
  while (tags.length && text.length + 2 + tags.join(" ").length > CAPTION_MAX) tags.pop();
  return { theme, caption: tags.length ? `${text}\n\n${tags.join(" ")}` : text };
}
