import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/app-shell";
import { StatusDot } from "@/components/ui/status";
import { can } from "@/lib/auth/permissions";
import { FORMAT_LABELS } from "@/lib/posts/upload";
import { resolveTenant } from "@/lib/tenant";
import { RowActions } from "../plan-forms";
import { AttachMedia, CaptionEditor, ResubmitButton } from "./item-forms";

export const maxDuration = 300;

const EDITABLE = new Set(["planned", "rejected", "generation_failed", "pending_approval", "scheduled"]);

export default async function PlanItemPage({ params }: PageProps<"/[tenant]/planejamento/[id]">) {
  const { tenant: slug, id } = await params;
  const { tenant, role, supabase } = await resolveTenant(slug);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { data: post } = await supabase
    .from("posts")
    .select("id, theme, format, status, origin, caption, scheduled_at, last_error, compliance_flags, is_ai_generated, ig_accounts(username), post_media(storage_path, kind, position)")
    .eq("tenant_id", tenant.id)
    .eq("id", id)
    .maybeSingle();
  if (!post) notFound();

  const canEdit = can(role, "edit_content");
  const media = [...post.post_media].sort((a, b) => a.position - b.position);
  const { data: signed } = media.length ? await supabase.storage.from("media").createSignedUrls(media.map((m) => m.storage_path), 600) : { data: [] };
  const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  const when = new Intl.DateTimeFormat("pt-BR", { timeZone: tenant.timezone, weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" });
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: tenant.timezone, year: "numeric", month: "2-digit" }).format(new Date(post.scheduled_at));
  const generatable = post.origin === "ai" && ["planned", "rejected", "generation_failed"].includes(post.status);

  return (
    <>
      <PageHeader title={post.theme} sub={`@${post.ig_accounts?.username} · ${FORMAT_LABELS[post.format]} · ${when.format(new Date(post.scheduled_at))}`} />
      <div className="flex max-w-[1040px] flex-col gap-5">
        <div className="flex flex-wrap items-center gap-4">
          <Link href={`/${tenant.slug}/planejamento?mes=${month}`} className="text-[14px] underline">
            Voltar ao planejamento
          </Link>
          <StatusDot status={post.status} />
          {post.is_ai_generated ? <span className="text-[13px] text-text-2">Arte gerada com IA (o Instagram mostra o selo)</span> : null}
        </div>
        {post.status === "generation_failed" && post.last_error ? <p className="rounded-md bg-danger-bg px-3 py-2.5 text-[13px] text-danger">{post.last_error}</p> : null}
        {post.compliance_flags.length ? (
          <p className="rounded-md bg-danger-bg px-3 py-2.5 text-[13px] text-danger">Pontos de atenção da publicidade médica: {post.compliance_flags.join("; ")}. Vai para aprovação.</p>
        ) : null}

        <section className="grid gap-5 md:grid-cols-[320px_1fr]">
          <div className="flex flex-col gap-3">
            {media.length ? (
              <div className="grid grid-cols-2 gap-2">
                {media.map((m, i) =>
                  m.kind === "video" ? (
                    <video key={m.storage_path} src={urlOf.get(m.storage_path) ?? undefined} controls className="col-span-2 aspect-[9/16] w-full rounded-md bg-muted object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária
                    <img
                      key={m.storage_path}
                      src={urlOf.get(m.storage_path) ?? ""}
                      alt={`${post.theme}, arte ${i + 1}`}
                      className={`${media.length === 1 ? "col-span-2" : ""} w-full rounded-md bg-muted object-cover`}
                    />
                  ),
                )}
              </div>
            ) : (
              <div className="flex aspect-[4/5] items-center justify-center rounded-md border border-dashed border-border-strong bg-subtle p-6 text-center text-[13px] text-text-2">
                {post.format === "reels" ? "Envie o vídeo do Reels abaixo." : "A arte aparece aqui depois de gerar."}
              </div>
            )}
            {canEdit && !media.length && ["planned", "rejected"].includes(post.status) ? <AttachMedia slug={tenant.slug} postId={post.id} format={post.format} /> : null}
          </div>
          <div className="flex flex-col gap-3">
            {canEdit && EDITABLE.has(post.status) && post.format !== "story" ? (
              <CaptionEditor slug={tenant.slug} postId={post.id} initial={post.caption ?? ""} />
            ) : (
              <p className="whitespace-pre-wrap text-[14px]">{post.caption || (post.format === "story" ? "Stories não têm legenda." : "Sem legenda ainda.")}</p>
            )}
            {canEdit && post.status === "rejected" && media.length ? (
              <div className="flex flex-col gap-2 border-t border-border pt-3">
                <p className="text-[13px] text-text-2">Reprovado. Ajuste a legenda e reenvie.</p>
                <ResubmitButton slug={tenant.slug} postId={post.id} />
              </div>
            ) : null}
            {canEdit && generatable ? (
              <div className="self-start">
                <RowActions slug={tenant.slug} postId={post.id} canGenerate regenerate={!!post.caption} />
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}
