import { geminiProvider } from "./gemini";
import { geminiImageProvider } from "./gemini-image";
import { higgsfieldProvider } from "./higgsfield";
import { openaiImageProvider } from "./openai-image";
import { openaiProvider } from "./openai";
import type { CaptionProvider, ImageProvider, ProviderConfig, VideoProvider } from "./types";
import { veoProvider } from "./veo";

/** Provedores de texto e arte. */
export const CAPTION_PROVIDERS = ["openai", "gemini"] as const;
export type CaptionProviderId = (typeof CAPTION_PROVIDERS)[number];

/** Provedores que têm chave (Vault). O Veo usa a chave do Gemini. */
export const KEY_PROVIDERS = ["openai", "gemini", "higgsfield"] as const;
export type KeyProviderId = (typeof KEY_PROVIDERS)[number];

/** Provedores de vídeo (valor de ai_settings.default_video_provider, além de 'none'). */
export const VIDEO_PROVIDERS = ["veo", "higgsfield"] as const;
export type VideoProviderId = (typeof VIDEO_PROVIDERS)[number];
/** De qual chave (e linha de ai_models) cada provedor de vídeo depende. */
export const VIDEO_KEY: Record<VideoProviderId, KeyProviderId> = { veo: "gemini", higgsfield: "higgsfield" };

export const PROVIDER_LABELS: Record<KeyProviderId, string> = { openai: "OpenAI (ChatGPT)", gemini: "Google Gemini", higgsfield: "Higgsfield" };
export const VIDEO_LABELS: Record<VideoProviderId, string> = { veo: "Google Veo", higgsfield: "Higgsfield" };

export type ProvidersConfig = Partial<Record<KeyProviderId, ProviderConfig>>;

export function captionProvider(id: CaptionProviderId, cfg: ProvidersConfig = {}): CaptionProvider {
  return id === "gemini" ? geminiProvider(cfg.gemini) : openaiProvider(cfg.openai);
}

export function imageProvider(id: CaptionProviderId, cfg: ProvidersConfig = {}): ImageProvider {
  return id === "gemini" ? geminiImageProvider(cfg.gemini) : openaiImageProvider(cfg.openai);
}

export function videoProvider(id: VideoProviderId, cfg: ProvidersConfig = {}): VideoProvider {
  return id === "veo" ? veoProvider(cfg.gemini) : higgsfieldProvider(cfg.higgsfield);
}

/** ai_settings guarda nomes como 'gemini_image'; a chave é a do provedor ('gemini'). */
export function providerOf(setting: string | null | undefined): CaptionProviderId | null {
  if (!setting) return null;
  const base = setting.replace(/_image$/, "");
  return (CAPTION_PROVIDERS as readonly string[]).includes(base) ? (base as CaptionProviderId) : null;
}

export function videoProviderOf(setting: string | null | undefined): VideoProviderId | null {
  return setting && (VIDEO_PROVIDERS as readonly string[]).includes(setting) ? (setting as VideoProviderId) : null;
}

export function providersFromEnv(): ProvidersConfig {
  return {
    openai: { baseUrl: process.env.OPENAI_BASE_URL || undefined },
    gemini: { baseUrl: process.env.GEMINI_BASE_URL || undefined },
    higgsfield: { baseUrl: process.env.HIGGSFIELD_BASE_URL || undefined },
  };
}
