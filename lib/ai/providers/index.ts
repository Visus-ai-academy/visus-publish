import { geminiProvider } from "./gemini";
import { geminiImageProvider } from "./gemini-image";
import { openaiImageProvider } from "./openai-image";
import { openaiProvider } from "./openai";
import type { CaptionProvider, ImageProvider, ProviderConfig } from "./types";

export const CAPTION_PROVIDERS = ["openai", "gemini"] as const;
export type CaptionProviderId = (typeof CAPTION_PROVIDERS)[number];
export const PROVIDER_LABELS: Record<CaptionProviderId, string> = { openai: "OpenAI (ChatGPT)", gemini: "Google Gemini" };

export type ProvidersConfig = Partial<Record<CaptionProviderId, ProviderConfig>>;

export function captionProvider(id: CaptionProviderId, cfg: ProvidersConfig = {}): CaptionProvider {
  return id === "gemini" ? geminiProvider(cfg.gemini) : openaiProvider(cfg.openai);
}

export function imageProvider(id: CaptionProviderId, cfg: ProvidersConfig = {}): ImageProvider {
  return id === "gemini" ? geminiImageProvider(cfg.gemini) : openaiImageProvider(cfg.openai);
}

/** ai_settings guarda nomes como 'gemini_image'; a chave é a do provedor ('gemini'). */
export function providerOf(setting: string | null | undefined): CaptionProviderId | null {
  if (!setting) return null;
  const base = setting.replace(/_image$/, "");
  return (CAPTION_PROVIDERS as readonly string[]).includes(base) ? (base as CaptionProviderId) : null;
}

export function providersFromEnv(): ProvidersConfig {
  return { openai: { baseUrl: process.env.OPENAI_BASE_URL || undefined }, gemini: { baseUrl: process.env.GEMINI_BASE_URL || undefined } };
}
