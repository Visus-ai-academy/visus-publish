"use client";

import { useState, useTransition } from "react";
import { cancelSchedule, publishNow, retryPublish, review } from "./post-actions";

const btn = "h-10 rounded-md px-2.5 text-[13px] font-semibold transition-[background-color,transform] duration-150 active:scale-[.98] disabled:opacity-60";

export function PostButtons({ slug, postId, actions }: { slug: string; postId: string; actions: Array<"publish" | "cancel" | "retry"> }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setError(r.ok ? null : (r.error ?? "Erro."));
    });

  return (
    <div className="flex flex-wrap items-center gap-1">
      {actions.includes("publish") ? (
        <button disabled={pending} onClick={() => run(() => publishNow(slug, postId))} className={`${btn} hover:bg-muted`}>
          Publicar agora
        </button>
      ) : null}
      {actions.includes("cancel") ? (
        <button disabled={pending} onClick={() => run(() => cancelSchedule(slug, postId))} className={`${btn} text-text-2 hover:bg-muted`}>
          Cancelar
        </button>
      ) : null}
      {actions.includes("retry") ? (
        <button disabled={pending} onClick={() => run(() => retryPublish(slug, postId))} className={`${btn} hover:bg-muted`}>
          Tentar de novo
        </button>
      ) : null}
      {error ? <span role="alert" className="text-[13px] text-danger">{error}</span> : null}
    </div>
  );
}

export function ReviewButtons({ slug, postId }: { slug: string; postId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const decide = (approve: boolean) =>
    start(async () => {
      const r = await review(slug, postId, approve, note || undefined);
      setError(r.ok ? null : r.error);
    });

  return (
    <div className="flex flex-col gap-2">
      {rejecting ? (
        <>
          <label htmlFor={`note-${postId}`} className="text-[13px] font-medium text-text-2">
            O que precisa mudar?
          </label>
          <textarea id={`note-${postId}`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className="rounded-md border border-border-strong px-3 py-2" />
          <div className="flex gap-2">
            <button disabled={pending} onClick={() => decide(false)} className={`${btn} bg-primary px-4 text-on-primary`}>
              Reprovar
            </button>
            <button disabled={pending} onClick={() => setRejecting(false)} className={`${btn} text-text-2 hover:bg-muted`}>
              Voltar
            </button>
          </div>
        </>
      ) : (
        <div className="flex gap-2">
          <button disabled={pending} onClick={() => decide(true)} className={`${btn} bg-primary px-4 text-on-primary hover:bg-[#2a2d34]`}>
            Aprovar
          </button>
          <button disabled={pending} onClick={() => setRejecting(true)} className={`${btn} border border-border-strong px-4 hover:bg-subtle`}>
            Reprovar
          </button>
        </div>
      )}
      {error ? <span role="alert" className="text-[13px] text-danger">{error}</span> : null}
    </div>
  );
}
