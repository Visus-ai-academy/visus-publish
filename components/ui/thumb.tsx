/** Miniatura do primeiro arquivo do post (foto ou quadro inicial do vídeo), 48 px. */
export function Thumb({ url, kind, alt, extra = 0, small = false }: { url?: string | null; kind?: string | null; alt: string; extra?: number; small?: boolean }) {
  const box = `${small ? "size-8" : "size-12"} shrink-0 rounded-md bg-muted object-cover`;
  return (
    <span className="relative inline-flex">
      {!url ? (
        <span aria-hidden className={box} />
      ) : kind === "video" ? (
        <video src={`${url}#t=0.5`} muted playsInline preload="metadata" aria-label={alt} className={box} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária
        <img src={url} alt={alt} loading="lazy" className={box} />
      )}
      {extra > 0 && !small ? <span className="absolute right-0.5 bottom-0.5 rounded bg-black/70 px-1 text-[11px] font-semibold text-white tabular-nums">+{extra}</span> : null}
    </span>
  );
}

type Media = { storage_path: string; kind: string; position: number };

/** Primeira mídia de cada post e URLs assinadas por 10 minutos, numa chamada só. */
export async function firstMediaUrls(
  storage: { from: (b: string) => { createSignedUrls: (p: string[], s: number) => Promise<{ data: { path: string | null; signedUrl: string | null }[] | null }> } },
  posts: { id: string; post_media: Media[] }[],
) {
  const first = new Map(posts.map((p) => [p.id, [...p.post_media].sort((a, b) => a.position - b.position)[0]] as const));
  const paths = [...first.values()].filter(Boolean).map((m) => m!.storage_path);
  const { data } = paths.length ? await storage.from("media").createSignedUrls(paths, 600) : { data: [] };
  const url = new Map((data ?? []).map((s) => [s.path, s.signedUrl]));
  return (id: string) => {
    const m = first.get(id);
    const total = posts.find((p) => p.id === id)?.post_media.length ?? 0;
    return { url: m ? url.get(m.storage_path) : null, kind: m?.kind ?? null, extra: Math.max(0, total - 1) };
  };
}
