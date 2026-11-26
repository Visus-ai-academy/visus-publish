import { geminiProvider } from "./gemini";
import { openaiProvider } from "./openai";
import type { CaptionProvider, ProviderConfig } from "./types";

export const CAPTION_PROVIDERS = ["openai", "gemini"] as const;
export type CaptionProviderId = (typeof CAPTION_PROVIDERS)[number];
export const PROVIDER_LABELS: Record<CaptionProviderId, string> = { openai: "OpenAI (ChatGPT)", gemini: "Google Gemini" };

export type ProvidersConfig = Partial<Record<CaptionProviderId, ProviderConfig>>;

export function captionProvider(id: CaptionProviderId, cfg: ProvidersConfig = {}): CaptionProvider {
  return id === "gemini" ? geminiProvider(cfg.gemini) : openaiProvider(cfg.openai);
}

export function providersFromEnv(): ProvidersConfig {
  return { openai: { baseUrl: process.env.OPENAI_BASE_URL || undefined }, gemini: { baseUrl: process.env.GEMINI_BASE_URL || undefined } };
}
