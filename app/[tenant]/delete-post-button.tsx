"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deletePost } from "./post-actions";

const btn = "h-10 rounded-md px-2.5 text-[13px] font-semibold transition-[background-color,transform] duration-150 active:scale-[.98] disabled:opacity-60 motion-reduce:transition-none";

/**
 * Excluir com confirmação na própria linha (sem janela do navegador).
 * `warn` explica o que se perde, por exemplo um post já aprovado.
 */
export function DeletePostButton({ slug, postId, warn, onError, after }: { slug: string; postId: string; warn?: string; onError?: (e: string | null) => void; after?: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const report = (e: string | null) => (onError ? onError(e) : setError(e));

  if (!asking) {
    return (
      <>
        <button type="button" className={`${btn} text-text-2 hover:bg-muted`} onClick={() => setAsking(true)}>
          Excluir
        </button>
        {!onError && error ? (
          <span role="alert" className="text-[13px] text-danger">
            {error}
          </span>
        ) : null}
      </>
    );
  }
  return (
    <span role="group" aria-label="Confirmar exclusão" className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="px-1 text-[13px] text-text-2" title={warn}>
        {warn ? "Excluir mesmo?" : "Excluir?"}
      </span>
      <button
        type="button"
        disabled={pending}
        className={`${btn} bg-danger-bg text-danger hover:brightness-95`}
        onClick={() =>
          start(async () => {
            const r = await deletePost(slug, postId);
            setAsking(false);
            report(r.ok ? null : r.error);
            if (r.ok && after) router.push(after);
          })
        }
      >
        {pending ? "Excluindo…" : "Sim, excluir"}
      </button>
      <button type="button" disabled={pending} className={`${btn} text-text-2 hover:bg-muted`} onClick={() => setAsking(false)}>
        Não
      </button>
    </span>
  );
}
