import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { SCREENS } from "@/components/shell/nav";
import { EmptyState, ErrorNote } from "@/components/ui/states";
import { can } from "@/lib/auth/permissions";
import { FORMAT_LABELS } from "@/lib/posts/upload";
import { resolveTenant } from "@/lib/tenant";
import { ReviewButtons } from "../post-buttons";

export default async function ApprovalsPage({ params }: PageProps<"/[tenant]/aprovacoes">) {
  const { tenant, role, supabase } = await resolveTenant((await params).tenant);
  const canApprove = can(role, "approve");

  const { data: posts, error } = await supabase
    .from("posts")
    .select("id, theme, format, caption, scheduled_at, ig_accounts(username), post_media(storage_path, kind, position)")
    .eq("tenant_id", tenant.id)
    .eq("status", "pending_approval")
    .order("scheduled_at");

  const paths = (posts ?? []).flatMap((p) => p.post_media.map((m) => m.storage_path));
  const { data: signed } = paths.length ? await supabase.storage.from("media").createSignedUrls(paths, 600) : { data: [] };
  const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  const when = new Intl.DateTimeFormat("pt-BR", { timeZone: tenant.timezone, weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <PageHeader title={SCREENS.aprovacoes.title} sub={SCREENS.aprovacoes.sub(tenant.name)} />
      <div className="flex max-w-[960px] flex-col gap-4">
        {error ? (
          <ErrorNote>Não foi possível carregar as aprovações.</ErrorNote>
        ) : posts.length === 0 ? (
          <EmptyState
            title="Nenhuma publicação esperando você"
            body="Conteúdos para contas que pedem aprovação aparecem aqui. Contas que publicam direto vão para o calendário como agendadas."
            action={<Link className="font-semibold text-brand-dark underline" href={`/${tenant.slug}/calendario`}>Abrir calendário</Link>}
          />
        ) : (
          posts.map((p) => {
            const media = [...p.post_media].sort((a, b) => a.position - b.position);
            return (
              <article key={p.id} className="grid grid-cols-[200px_1fr] gap-5 rounded-xl border border-border p-4">
                <div className="flex flex-col gap-2">
                  {media.slice(0, 1).map((m) =>
                    m.kind === "video" ? (
                      <video key={m.storage_path} src={urlOf.get(m.storage_path) ?? undefined} controls className="aspect-[4/5] w-full rounded-md bg-muted object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária
                      <img key={m.storage_path} src={urlOf.get(m.storage_path) ?? ""} alt={`Criativo: ${p.theme}`} className="aspect-[4/5] w-full rounded-md bg-muted object-cover" />
                    ),
                  )}
                  {media.length > 1 ? <p className="text-[13px] text-text-2 tabular-nums">+{media.length - 1} arquivos</p> : null}
                </div>
                <div className="flex flex-col gap-3">
                  <div>
                    <p className="text-[13px] text-text-2">
                      @{p.ig_accounts?.username} · {FORMAT_LABELS[p.format]} · <span className="tabular-nums">{when.format(new Date(p.scheduled_at))}</span>
                    </p>
                    <h2 className="text-[16px] font-semibold">{p.theme}</h2>
                  </div>
                  <p className="whitespace-pre-wrap text-text-2">{p.caption || "Sem legenda."}</p>
                  {canApprove ? <ReviewButtons slug={tenant.slug} postId={p.id} /> : <p className="text-[13px] text-muted-fg">Aguardando um aprovador.</p>}
                </div>
              </article>
            );
          })
        )}
      </div>
    </>
  );
}
