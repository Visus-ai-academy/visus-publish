import { z } from "zod";

export const FORMATS = ["image", "carousel", "reels", "story"] as const;
export type Format = (typeof FORMATS)[number];

export const FORMAT_LABELS: Record<Format, string> = { image: "Foto", carousel: "Carrossel", reels: "Reels", story: "Stories" };

export const IMAGE_TYPES = ["image/jpeg", "image/png"];
export const VIDEO_TYPES = ["video/mp4", "video/quicktime"];
const MB = 1024 * 1024;
export const MAX_IMAGE_BYTES = 8 * MB; // limite da Meta para imagem
export const MAX_VIDEO_BYTES = 300 * MB; // limite da Meta para Reels

export type FileMeta = { name: string; type: string; size: number };

export function kindOf(type: string): "image" | "video" | null {
  if (IMAGE_TYPES.includes(type)) return "image";
  if (VIDEO_TYPES.includes(type)) return "video";
  return null;
}

/** Confere os arquivos para o formato. Devolve a mensagem de erro em pt-BR, ou null. */
export function validateFiles(format: Format, files: FileMeta[]): string | null {
  if (files.length === 0) return "Selecione pelo menos um arquivo.";
  for (const f of files) {
    const k = kindOf(f.type);
    if (!k) return `${f.name}: use JPG, PNG, MP4 ou MOV.`;
    if (k === "image" && f.size > MAX_IMAGE_BYTES) return `${f.name}: imagem acima de 8 MB.`;
    if (k === "video" && f.size > MAX_VIDEO_BYTES) return `${f.name}: vídeo acima de 300 MB.`;
  }
  const kinds = files.map((f) => kindOf(f.type));
  switch (format) {
    case "image":
      return files.length === 1 && kinds[0] === "image" ? null : "Foto aceita uma imagem.";
    case "reels":
      return files.length === 1 && kinds[0] === "video" ? null : "Reels aceita um vídeo.";
    case "story":
      return files.length === 1 ? null : "Stories aceita um arquivo por vez.";
    case "carousel":
      return files.length >= 2 && files.length <= 10 ? null : "Carrossel aceita de 2 a 10 arquivos.";
  }
}

export function storagePath(tenantId: string, postId: string, index: number, name: string) {
  const ext = name.toLowerCase().match(/\.(jpe?g|png|mp4|mov)$/)?.[1] ?? "bin";
  return `${tenantId}/${postId}/${String(index).padStart(2, "0")}.${ext}`;
}

export const draftSchema = z.object({
  accountId: z.string().uuid("Escolha a conta."),
  format: z.enum(FORMATS),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Escolha a data."),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Escolha o horário."),
  theme: z.string().trim().min(2, "Dê um título curto ao post.").max(120),
  caption: z.string().max(2200, "A legenda passa de 2.200 caracteres.").optional().default(""),
  files: z.array(z.object({ name: z.string(), type: z.string(), size: z.number() })).max(10),
});

export function hashtagCount(caption: string) {
  return (caption.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;
}
