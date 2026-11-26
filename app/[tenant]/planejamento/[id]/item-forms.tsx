"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ErrorNote } from "@/components/ui/states";
import { Notice } from "@/components/ui/status";
import { createClient } from "@/lib/supabase/client";
import { hashtagCount, type Format } from "@/lib/posts/upload";
import { discardMedia, finalizeDraft } from "../../post-actions";
import { attachPaths, generateItem, resubmit, saveCaption } from "../actions";

export function CaptionEditor({ slug, postId, initial }: { slug: string; postId: string; initial: string }) {
  const [caption, setCaption] = useState(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const tags = hashtagCount(caption);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (tags > 30) return setMsg({ ok: false, text: "Use no máximo 30 hashtags." });
        start(async () => {
          const r = await saveCaption(slug, postId, caption);
          setMsg(r.ok ? { ok: true, text: "Legenda salva." } : { ok: false, text: r.error });
        });
      }}
    >
      <label htmlFor="caption" className="text-[13px] font-medium text-text-2">
        Legenda
      </label>
      <textarea
        id="caption"
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        maxLength={2200}
        rows={12}
        className="rounded-md border border-border-strong px-3 py-2 text-[14px]"
      />
      <p className="text-[13px] tabular-nums text-muted-fg">
        {caption.length.toLocaleString("pt-BR")} / 2.200 caracteres · {tags} / 30 hashtags
      </p>
      {msg ? msg.ok ? <Notice tone="success">{msg.text}</Notice> : <ErrorNote>{msg.text}</ErrorNote> : null}
      <Button type="submit" variant="secondary" disabled={pending || caption === initial} className="self-start">
        {pending ? "Salvando…" : "Salvar legenda"}
      </Button>
    </form>
  );
}

export function AttachMedia({ slug, postId, format }: { slug: string; postId: string; format: Format }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const accept = format === "reels" ? "video/mp4,video/quicktime" : "image/jpeg,image/png,video/mp4,video/quicktime";
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const meta = files.map((f) => ({ name: f.name, type: f.type, size: f.size }));
          const r = await attachPaths(slug, postId, meta);
          if (!r.ok) return setError(r.error);
          const supabase = createClient();
          for (const [i, f] of files.entries()) {
            const { error: up } = await supabase.storage.from("media").upload(r.paths[i], f, { contentType: f.type });
            if (up) {
              await discardMedia(slug, postId);
              return setError(`Não foi possível enviar ${f.name}. Tente de novo.`);
            }
          }
          const fin = await finalizeDraft(slug, { postId, files: files.map((f, i) => ({ path: r.paths[i], type: f.type })) });
          if (!fin.ok) {
            await discardMedia(slug, postId);
            return setError(fin.error);
          }
          router.refresh();
        });
      }}
    >
      <label htmlFor="attach" className="text-[13px] font-medium text-text-2">
        {format === "reels" ? "Vídeo do Reels" : "Arquivo pronto (em vez de gerar)"}
      </label>
      <input
        id="attach"
        type="file"
        multiple={format === "carousel"}
        accept={accept}
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        className="text-[14px] file:mr-3 file:h-10 file:rounded-md file:border-0 file:bg-primary file:px-3 file:font-semibold file:text-on-primary"
      />
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <Button type="submit" disabled={pending || !files.length} className="self-start">
        {pending ? "Enviando…" : "Enviar e agendar"}
      </Button>
    </form>
  );
}

export function ResubmitButton({ slug, postId }: { slug: string; postId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <Button disabled={pending} className="self-start" onClick={() => start(async () => setError(((r) => (r.ok ? null : r.error))(await resubmit(slug, postId))))}>
        {pending ? "Reenviando…" : "Reenviar"}
      </Button>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </div>
  );
}

/**
 * Pedir à IA uma nova legenda ou uma nova arte, com uma orientação opcional.
 * `note` avisa o que acontece com o status (ex.: volta para aprovação).
 */
export function RegeneratePanel({ slug, postId, format, note }: { slug: string; postId: string; format: Format; note?: string }) {
  const router = useRouter();
  const [hint, setHint] = useState("");
  const [running, setRunning] = useState<"caption" | "image" | null>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (only: "caption" | "image") => {
    setMsg(null);
    setRunning(only);
    start(async () => {
      const r = await generateItem(slug, postId, { only, hint: hint.trim() || undefined });
      setRunning(null);
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setMsg({ ok: true, text: only === "caption" ? "Nova legenda pronta." : "Nova arte pronta." });
      setHint("");
      router.refresh();
    });
  };
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <h2 className="text-[14px] font-semibold">Não gostou? Peça de novo à IA</h2>
      <label htmlFor="regen-hint" className="text-[13px] font-medium text-text-2">
        O que mudar (opcional)
      </label>
      <textarea
        id="regen-hint"
        value={hint}
        onChange={(e) => setHint(e.target.value)}
        maxLength={500}
        rows={2}
        placeholder="Ex.: tom mais leve, legenda mais curta, fundo claro com pessoas sorrindo"
        className="rounded-md border border-border-strong px-3 py-2 text-[14px]"
      />
      {note ? <p className="text-[13px] text-muted-fg">{note}</p> : null}
      {msg ? msg.ok ? <Notice tone="success">{msg.text}</Notice> : <ErrorNote>{msg.text}</ErrorNote> : null}
      <div className="flex flex-wrap gap-2">
        {format !== "story" ? (
          <Button type="button" variant="secondary" disabled={pending} onClick={() => run("caption")}>
            {running === "caption" ? "Gerando legenda…" : "Nova legenda"}
          </Button>
        ) : null}
        {format !== "reels" ? (
          <Button type="button" variant="secondary" disabled={pending} onClick={() => run("image")}>
            {running === "image" ? (format === "carousel" ? "Gerando slides…" : "Gerando arte…") : format === "carousel" ? "Novos slides" : "Nova arte"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
