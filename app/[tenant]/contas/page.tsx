import { PageHeader } from "@/components/shell/app-shell";
import { SCREENS } from "@/components/shell/nav";
import { EmptyState, ErrorNote } from "@/components/ui/states";
import { Notice } from "@/components/ui/status";
import { can } from "@/lib/auth/permissions";
import { getMetaConfig, metaConfigProblems } from "@/lib/meta/config";
import { loadMetricoolAuth } from "@/lib/metricool/auth";
import type { MetricoolBrand } from "@/lib/metricool/client";
import { listBrandsWith, metricoolEnv } from "@/lib/metricool/port";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlatformAdmin, resolveTenant } from "@/lib/tenant";
import { disconnect, setApprovalMode, setPublishVia } from "./actions";
import { removeMetricool } from "./metricool-actions";
import { LinkBrandForm, MetricoolCredentialsForm } from "./metricool-forms";

const ERRORS: Record<string, string> = {
  meta_nao_configurada: "O app da Meta ainda não foi configurado neste ambiente. Fale com a equipe da Visus.",
  sem_permissao: "Só administradores conectam contas.",
  cancelado: "A conexão foi cancelada no Instagram.",
  outro_cliente: "Esta conta do Instagram já está conectada em outro cliente.",
  falha_meta: "A Meta não confirmou a conexão. Tente de novo em alguns minutos.",
  sem_conta: "Nenhuma conta do Instagram foi liberada no login da Meta. Entre de novo e marque a conta do Instagram na tela de permissões.",
  mc_sem_permissao: "Só a equipe da Visus conecta o Metricool.",
  mc_cancelado: "O login no Metricool foi cancelado.",
  mc_expirado: "O login no Metricool demorou demais. Tente de novo.",
  mc_falha: "O Metricool não confirmou o login. Tente de novo em alguns minutos.",
};

const STATUS = {
  connected: { label: "Conectada", color: "var(--st-scheduled)" },
  needs_reauth: { label: "Reconectar", color: "var(--st-pending)" },
  disconnected: { label: "Desconectada", color: "var(--st-planned)" },
} as const;

const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

export default async function AccountsPage({ params, searchParams }: PageProps<"/[tenant]/contas">) {
  const { tenant, role, supabase } = await resolveTenant((await params).tenant);
  const sp = await searchParams;
  const isAdmin = can(role, "manage_tenant");

  const [{ data: accounts, error }, { data: mcConn }, platformAdmin] = await Promise.all([
    supabase
      .from("ig_accounts")
      .select("id, username, name, status, require_approval, token_expires_at, publish_via, metricool_blog_id, ig_user_id")
      .eq("tenant_id", tenant.id)
      .order("username"),
    supabase.from("metricool_connections").select("auth_mode, metricool_user_id, updated_at").eq("tenant_id", tenant.id).maybeSingle(),
    isPlatformAdmin(),
  ]);
  const metaReady = getMetaConfig() !== null;
  const metaProblems = metaReady ? [] : metaConfigProblems();

  // Marcas do Metricool só para a equipe da Visus, que vincula as contas
  let brands: MetricoolBrand[] = [];
  let brandsError: string | null = null;
  if (platformAdmin && mcConn) {
    try {
      const auth = await loadMetricoolAuth(createAdminClient(), tenant.id);
      if (auth) brands = await listBrandsWith(metricoolEnv(), auth);
    } catch (e) {
      brandsError = (e as Error).message;
    }
  }

  const connectHref = `/api/meta/oauth/start?tenant=${tenant.slug}`;
  const errorKey = typeof sp.erro === "string" ? sp.erro : undefined;

  return (
    <>
      <PageHeader
        title={SCREENS.contas.title}
        sub={SCREENS.contas.sub(tenant.name)}
        actions={
          isAdmin && metaReady ? (
            // Link comum (sem prefetch): sai do app para o login do Instagram
            <a href={connectHref} className="inline-flex h-10 items-center rounded-md bg-primary px-4 font-semibold text-on-primary transition-transform duration-150 hover:bg-primary-hover active:scale-[.98]">
              Conectar conta do Instagram
            </a>
          ) : null
        }
      />
      <div className="flex max-w-[1040px] flex-col gap-6">
        {typeof sp.conectada === "string" ? <Notice tone="success">@{sp.conectada} conectada.</Notice> : null}
        {sp.metricool === "ok" ? <Notice tone="success">Metricool conectado. Agora vincule a marca de cada conta.</Notice> : null}
        {platformAdmin && metaProblems.length > 0 ? (
          <Notice tone="danger">
            O login da Meta não está ativo: confira na Vercel {metaProblems.length > 1 ? "as variáveis" : "a variável"} {metaProblems.join(", ")} (marcada
            em Production, sem espaços e sem aspas) e faça o Redeploy.
          </Notice>
        ) : null}
        {errorKey ? <Notice tone="danger">{ERRORS[errorKey] ?? "Não foi possível conectar a conta."}</Notice> : null}

        {platformAdmin || mcConn ? (
          <section aria-labelledby="mc-title" className="flex flex-col gap-4 rounded-lg border border-border p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="mc-title" className="text-[15px] font-semibold">
                  Publicação pelo Metricool
                </h2>
                <p className="mt-1 text-text-2">
                  {mcConn
                    ? mcConn.auth_mode === "oauth"
                      ? "Conectado pelo login do Metricool (funciona no plano Free, até 20 posts por mês). Contas vinculadas a uma marca publicam pelo Metricool."
                      : `Conectado pela API (userId ${mcConn.metricool_user_id}). Contas vinculadas a uma marca publicam pelo Metricool.`
                    : "Enquanto o app da Meta não é liberado, as contas podem publicar pelo Metricool."}
                </p>
              </div>
              {platformAdmin && mcConn ? (
                <form action={removeMetricool.bind(null, tenant.slug)}>
                  <button className="h-10 rounded-md px-2.5 font-semibold text-text-2 hover:bg-muted">Desconectar Metricool</button>
                </form>
              ) : null}
            </div>
            {platformAdmin ? (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  {/* Link comum: sai do app para o login do Metricool */}
                  <a
                    href={`/api/metricool/oauth/start?tenant=${tenant.slug}`}
                    className="inline-flex h-10 items-center rounded-md bg-primary px-4 font-semibold text-on-primary transition-transform duration-150 hover:bg-primary-hover active:scale-[.98]"
                  >
                    {mcConn?.auth_mode === "oauth" ? "Entrar de novo no Metricool" : "Entrar com o Metricool"}
                  </a>
                  <p className="text-[13px] text-muted-fg">Qualquer plano, inclusive o Free.</p>
                </div>
                <details className="rounded-md border border-border p-3">
                  <summary className="cursor-pointer font-medium">Usar o token da API (planos Advanced ou Custom)</summary>
                  <div className="mt-3">
                    <MetricoolCredentialsForm slug={tenant.slug} connected={mcConn?.auth_mode === "api_token"} />
                  </div>
                </details>
                {mcConn ? (
                  brandsError ? (
                    <ErrorNote>{brandsError}</ErrorNote>
                  ) : brands.length ? (
                    <LinkBrandForm slug={tenant.slug} brands={brands} />
                  ) : (
                    <p className="text-text-2">Nenhuma marca encontrada neste Metricool.</p>
                  )
                ) : null}
              </>
            ) : null}
          </section>
        ) : null}

        {error ? (
          <ErrorNote>Não foi possível carregar as contas.</ErrorNote>
        ) : accounts.length === 0 ? (
          <EmptyState
            title="Este cliente ainda não tem contas conectadas."
            body={
              metaReady
                ? "Conecte contas profissionais do Instagram pelo login da Meta. Não há limite de contas por cliente."
                : "Por enquanto as contas entram pelo Metricool. Peça à equipe da Visus para vincular a marca deste cliente."
            }
          />
        ) : (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-brand/40 text-[13px] text-brand-dark">
                <th className="py-2 pr-4 font-medium">Conta</th>
                <th className="py-2 pr-4 font-medium">Conexão</th>
                <th className="py-2 pr-4 font-medium">Publica por</th>
                <th className="py-2 pr-4 font-medium">Depois de gerar ou subir</th>
                {isAdmin ? <th className="py-2 font-medium">Ações</th> : null}
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const st = STATUS[a.status];
                return (
                  <tr key={a.id} className="border-b border-row">
                    <td className="py-3 pr-4">
                      <p className="font-medium">@{a.username}</p>
                      {a.name ? <p className="text-[13px] text-text-2">{a.name}</p> : null}
                    </td>
                    <td className="py-3 pr-4">
                      <span className="inline-flex items-center gap-1.5">
                        <span aria-hidden className="size-2 rounded-full" style={{ background: st.color }} />
                        {st.label}
                      </span>
                      {a.status === "connected" && a.token_expires_at ? (
                        <p className="text-[13px] text-text-2">
                          Acesso renova sozinho, válido até <span className="tabular-nums">{dateFmt.format(new Date(a.token_expires_at))}</span>
                        </p>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4">
                      {isAdmin && a.metricool_blog_id && a.token_expires_at && !a.ig_user_id.startsWith("metricool:") ? (
                        // Conta ligada nos dois: o admin escolhe por onde publica
                        <div role="group" aria-label={`Por onde @${a.username} publica`} className="inline-flex rounded-md border border-border-strong p-0.5">
                          {(["metricool", "meta"] as const).map((v) => (
                            <form key={v} action={setPublishVia.bind(null, tenant.slug, a.id, v)}>
                              <button
                                aria-pressed={a.publish_via === v}
                                className={`h-9 rounded-sm px-3 text-[13px] font-semibold transition-colors duration-150 ${a.publish_via === v ? "bg-primary text-on-primary" : "text-text-2 hover:bg-muted"}`}
                              >
                                {v === "meta" ? "Meta" : "Metricool"}
                              </button>
                            </form>
                          ))}
                        </div>
                      ) : a.publish_via === "metricool" ? (
                        "Metricool"
                      ) : (
                        "Meta"
                      )}
                      {a.publish_via === "metricool" && a.token_expires_at && !a.ig_user_id.startsWith("metricool:") ? (
                        <p className="text-[13px] text-text-2">Métricas pela Meta</p>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4">
                      {isAdmin ? (
                        <div role="group" aria-label={`Modo de @${a.username}`} className="inline-flex rounded-md border border-border-strong p-0.5">
                          {[
                            { v: true, label: "Pede aprovação" },
                            { v: false, label: "Publica direto" },
                          ].map((o) => (
                            <form key={o.label} action={setApprovalMode.bind(null, tenant.slug, a.id, o.v)}>
                              <button
                                aria-pressed={a.require_approval === o.v}
                                className={`h-9 rounded-sm px-3 text-[13px] font-semibold transition-colors duration-150 ${a.require_approval === o.v ? "bg-primary text-on-primary" : "text-text-2 hover:bg-muted"}`}
                              >
                                {o.label}
                              </button>
                            </form>
                          ))}
                        </div>
                      ) : a.require_approval ? (
                        "Pede aprovação"
                      ) : (
                        "Publica direto"
                      )}
                    </td>
                    {isAdmin ? (
                      <td className="py-3">
                        <div className="flex items-center gap-1">
                          {a.status !== "connected" && metaReady ? (
                            <a href={connectHref} className="inline-flex h-10 items-center rounded-md px-2.5 font-semibold hover:bg-muted">
                              Reconectar
                            </a>
                          ) : null}
                          {a.status === "connected" && a.publish_via === "metricool" && !a.token_expires_at && metaReady ? (
                            // Liga o acesso da Meta só para ler as métricas; a publicação segue pelo Metricool
                            <a href={connectHref} className="inline-flex h-10 items-center rounded-md px-2.5 font-semibold hover:bg-muted">
                              Ligar métricas pela Meta
                            </a>
                          ) : null}
                          {a.status !== "disconnected" ? (
                            <form action={disconnect.bind(null, tenant.slug, a.id)}>
                              <button className="h-10 rounded-md px-2.5 font-semibold text-text-2 hover:bg-muted">Desconectar</button>
                            </form>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
