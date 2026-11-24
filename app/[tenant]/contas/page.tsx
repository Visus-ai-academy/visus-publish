import { PageHeader } from "@/components/shell/app-shell";
import { SCREENS } from "@/components/shell/nav";
import { EmptyState, ErrorNote } from "@/components/ui/states";
import { Notice } from "@/components/ui/status";
import { can } from "@/lib/auth/permissions";
import { resolveTenant } from "@/lib/tenant";
import { disconnect, setApprovalMode } from "./actions";

const ERRORS: Record<string, string> = {
  meta_nao_configurada: "O app da Meta ainda não foi configurado neste ambiente. Fale com a equipe da Visus.",
  sem_permissao: "Só administradores conectam contas.",
  cancelado: "A conexão foi cancelada no Instagram.",
  outro_cliente: "Esta conta do Instagram já está conectada em outro cliente.",
  falha_meta: "A Meta não confirmou a conexão. Tente de novo em alguns minutos.",
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

  const { data: accounts, error } = await supabase
    .from("ig_accounts")
    .select("id, username, name, status, require_approval, token_expires_at")
    .eq("tenant_id", tenant.id)
    .order("username");

  const connectHref = `/api/meta/oauth/start?tenant=${tenant.slug}`;
  const errorKey = typeof sp.erro === "string" ? sp.erro : undefined;

  return (
    <>
      <PageHeader
        title={SCREENS.contas.title}
        sub={SCREENS.contas.sub(tenant.name)}
        actions={
          isAdmin ? (
            // Link comum (sem prefetch): sai do app para o login do Instagram
            <a href={connectHref} className="inline-flex h-10 items-center rounded-md bg-primary px-4 font-semibold text-on-primary transition-transform duration-150 hover:bg-[#2a2d34] active:scale-[.98]">
              Conectar conta do Instagram
            </a>
          ) : null
        }
      />
      <div className="flex max-w-[1040px] flex-col gap-6">
        {typeof sp.conectada === "string" ? <Notice tone="success">@{sp.conectada} conectada.</Notice> : null}
        {errorKey ? <Notice tone="danger">{ERRORS[errorKey] ?? "Não foi possível conectar a conta."}</Notice> : null}

        {error ? (
          <ErrorNote>Não foi possível carregar as contas.</ErrorNote>
        ) : accounts.length === 0 ? (
          <EmptyState
            title="Este cliente ainda não tem contas conectadas."
            body="Conecte contas profissionais do Instagram pelo login da Meta. Não há limite de contas por cliente."
          />
        ) : (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border text-[13px] text-muted-fg">
                <th className="py-2 pr-4 font-medium">Conta</th>
                <th className="py-2 pr-4 font-medium">Conexão</th>
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
                          {a.status !== "connected" ? (
                            <a href={connectHref} className="inline-flex h-10 items-center rounded-md px-2.5 font-semibold hover:bg-muted">
                              Reconectar
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
