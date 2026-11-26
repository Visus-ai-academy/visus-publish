import { PageHeader } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorNote } from "@/components/ui/states";
import { can } from "@/lib/auth/permissions";
import { KEY_PROVIDERS, PROVIDER_LABELS, VIDEO_KEY, VIDEO_LABELS, type KeyProviderId } from "@/lib/ai/providers";
import { resolveTenant } from "@/lib/tenant";
import { removeOwnKey } from "./actions";
import { BillingForm, OwnKeyForm, ProvidersForm } from "./forms";

export const metadata = { title: "Integrações de IA · Visus Publish" };

export default async function AiIntegrationsPage({ params }: PageProps<"/[tenant]/ia">) {
  const { tenant, role, supabase } = await resolveTenant((await params).tenant);
  const isAdmin = can(role, "manage_tenant");
  const [settings, keys, balance, ledger, creds, models] = await Promise.all([
    supabase.from("ai_settings").select("billing_mode, default_caption_provider, default_image_provider, default_video_provider").eq("tenant_id", tenant.id).maybeSingle(),
    supabase.rpc("ai_key_status", { p_tenant: tenant.id }),
    supabase.rpc("credit_balance", { p_tenant: tenant.id }),
    isAdmin ? supabase.from("credit_ledger").select("id, delta, reason, created_at").eq("tenant_id", tenant.id).order("created_at", { ascending: false }).limit(20) : Promise.resolve({ data: [], error: null }),
    isAdmin ? supabase.from("ai_credentials").select("provider, created_at").eq("tenant_id", tenant.id) : Promise.resolve({ data: [], error: null }),
    supabase.from("ai_models").select("provider, task, unit_cost_credits").eq("active", true),
  ]);

  const header = <PageHeader title="Integrações de IA" sub="Quais IAs escrevem e criam para este cliente, e quem paga o consumo." />;
  if (settings.error || keys.error || balance.error || !settings.data) {
    return (
      <>
        {header}
        <ErrorNote>Não foi possível carregar as integrações de IA. Atualize a página.</ErrorNote>
      </>
    );
  }

  const s = settings.data;
  const mode = s.billing_mode;
  const has = (p: KeyProviderId) => keys.data.some((k) => k.provider === p && (mode === "own" ? k.own : k.platform));
  const note = (p: KeyProviderId) => (has(p) ? undefined : "sem chave");
  const options = {
    caption: [
      { value: "openai", label: "OpenAI (ChatGPT)", note: note("openai") },
      { value: "gemini", label: "Google Gemini", note: note("gemini") },
    ],
    image: [
      { value: "openai_image", label: "OpenAI Images", note: note("openai") },
      { value: "gemini_image", label: "Gemini (Nano Banana)", note: note("gemini") },
    ],
    video: [
      { value: "none", label: "Desligado (a equipe envia o vídeo)" },
      { value: "veo", label: VIDEO_LABELS.veo, note: note(VIDEO_KEY.veo) },
      { value: "higgsfield", label: VIDEO_LABELS.higgsfield, note: note(VIDEO_KEY.higgsfield) },
    ],
  };
  const cost = (provider: string, task: string) => models.data?.find((m) => m.provider === provider && m.task === task)?.unit_cost_credits;
  const num = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
  const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: tenant.timezone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const costRows = [
    { label: "Legenda ou sugestão de temas", value: cost(s.default_caption_provider, "caption") },
    { label: "Arte (por imagem; carrossel conta cada slide)", value: cost(s.default_image_provider.replace(/_image$/, ""), "image") },
    { label: "Vídeo do Reels", value: s.default_video_provider === "none" ? undefined : cost(VIDEO_KEY[s.default_video_provider as "veo" | "higgsfield"], "video") },
  ];

  return (
    <>
      {header}
      <div className="flex max-w-[1040px] flex-col gap-8">
        {!isAdmin ? <p className="text-[13px] text-text-2">Só o administrador do cliente muda estas configurações.</p> : null}

        <section className="flex flex-col gap-3">
          <h2 className="text-[15px] font-semibold">Cobrança</h2>
          <BillingForm slug={tenant.slug} mode={mode} disabled={!isAdmin} />
          {mode === "platform" ? (
            <div className="flex flex-col gap-3 rounded-lg border border-border p-5">
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <p>
                  <span className="text-[13px] text-text-2">Saldo de créditos</span>
                  <br />
                  <span className={`text-[24px] font-semibold tabular-nums ${Number(balance.data) <= 0 ? "text-danger" : ""}`}>{num.format(Number(balance.data))}</span>
                </p>
                <p className="text-[13px] text-text-2">Para comprar mais créditos, fale com a equipe da Visus.</p>
              </div>
              <table className="w-full border-collapse text-left text-[14px]">
                <caption className="sr-only">Custo por geração</caption>
                <thead>
                  <tr className="border-b border-brand/40 text-[13px] text-brand-dark">
                    <th className="py-2 pr-4 font-medium">Geração</th>
                    <th className="py-2 text-right font-medium">Créditos</th>
                  </tr>
                </thead>
                <tbody>
                  {costRows.map((r) => (
                    <tr key={r.label} className="border-b border-row">
                      <td className="py-2 pr-4">{r.label}</td>
                      <td className="py-2 text-right tabular-nums">{r.value === undefined ? "—" : num.format(Number(r.value))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {isAdmin ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-[14px] font-semibold">Extrato</h3>
              {ledger.error ? (
                <ErrorNote>Não foi possível carregar o extrato.</ErrorNote>
              ) : !ledger.data?.length ? (
                <EmptyState title="Nenhum movimento ainda" body="Créditos adicionados pela Visus e gerações com IA aparecem aqui." />
              ) : (
                <table className="w-full border-collapse text-left text-[14px]">
                  <thead>
                    <tr className="border-b border-brand/40 text-[13px] text-brand-dark">
                      <th className="py-2 pr-4 font-medium">Quando</th>
                      <th className="py-2 pr-4 font-medium">Descrição</th>
                      <th className="py-2 text-right font-medium">Créditos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.data.map((l) => (
                      <tr key={l.id} className="border-b border-row">
                        <td className="py-2 pr-4 whitespace-nowrap tabular-nums text-text-2">{fmt.format(new Date(l.created_at))}</td>
                        <td className="py-2 pr-4">{l.reason}</td>
                        <td className={`py-2 text-right tabular-nums ${Number(l.delta) > 0 ? "text-brand-dark" : ""}`}>
                          {Number(l.delta) > 0 ? "+" : ""}
                          {num.format(Number(l.delta))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : null}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-[15px] font-semibold">Provedor de cada tarefa</h2>
          <ProvidersForm
            slug={tenant.slug}
            disabled={!isAdmin}
            current={{ caption: s.default_caption_provider, image: s.default_image_provider, video: s.default_video_provider }}
            options={options}
          />
        </section>

        {isAdmin ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-[15px] font-semibold">Chaves próprias</h2>
            <p className="text-[13px] text-text-2">
              {mode === "own" ? "Estas chaves estão em uso." : "Ficam guardadas, mas só são usadas quando a cobrança estiver em Chave própria."}
            </p>
            <OwnKeyForm slug={tenant.slug} providers={KEY_PROVIDERS.map((id) => ({ id, label: PROVIDER_LABELS[id] }))} />
            {creds.error ? (
              <ErrorNote>Não foi possível carregar as chaves.</ErrorNote>
            ) : (
              <table className="w-full border-collapse text-left text-[14px]">
                <thead>
                  <tr className="border-b border-brand/40 text-[13px] text-brand-dark">
                    <th className="py-2 pr-4 font-medium">Provedor</th>
                    <th className="py-2 pr-4 font-medium">Chave</th>
                    <th className="py-2 font-medium">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {KEY_PROVIDERS.map((p) => {
                    const c = creds.data?.find((r) => r.provider === p);
                    return (
                      <tr key={p} className="border-b border-row">
                        <td className="py-2 pr-4 font-medium">{PROVIDER_LABELS[p]}</td>
                        <td className="py-2 pr-4 tabular-nums text-text-2">
                          {c ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span aria-hidden className="size-2 rounded-full bg-brand" />
                              Guardada em {fmt.format(new Date(c.created_at))}
                            </span>
                          ) : (
                            "Sem chave"
                          )}
                        </td>
                        <td className="py-2 text-right">
                          {c ? (
                            <form action={removeOwnKey.bind(null, tenant.slug, p)}>
                              <Button type="submit" variant="ghost">
                                Remover chave
                              </Button>
                            </form>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        ) : null}
      </div>
    </>
  );
}
