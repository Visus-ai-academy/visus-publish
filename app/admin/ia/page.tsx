import { PageHeader } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { ErrorNote } from "@/components/ui/states";
import { fetchModels, modelOptions, type ModelTask } from "@/lib/ai/models";
import { CAPTION_PROVIDERS, PROVIDER_LABELS, providersFromEnv } from "@/lib/ai/providers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/tenant";
import { removeAiKey } from "./actions";
import { AiKeyForm, ModelForm } from "./forms";

export const metadata = { title: "IA · Visus Publish" };

const TASKS: { task: ModelTask; label: string }[] = [
  { task: "caption", label: "Texto (tema e legenda)" },
  { task: "image", label: "Arte (imagem)" },
];

export default async function AdminAiPage() {
  const { supabase } = await requireUser();
  const [keys, models] = await Promise.all([
    supabase.from("ai_platform_keys").select("provider, updated_at"),
    supabase.from("ai_models").select("id, provider, task, model").in("task", ["caption", "image"]).order("id"),
  ]);
  // Modelos disponíveis direto na API de cada provedor com chave (a layout já exige admin da plataforma)
  const admin = createAdminClient();
  const cfg = providersFromEnv();
  const available = Object.fromEntries(
    await Promise.all(
      CAPTION_PROVIDERS.map(async (p) => {
        if (!keys.data?.some((k) => k.provider === p)) return [p, null] as const;
        const { data: key } = await admin.rpc("read_platform_ai_key", { p_provider: p });
        return [p, key ? await fetchModels(p, key, cfg) : null] as const;
      }),
    ),
  );
  const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "short", year: "numeric" });

  return (
    <>
      <PageHeader title="IA da plataforma" sub="Chaves usadas pelos clientes no modo de cobrança da Visus e modelos de cada tarefa." />
      <div className="flex max-w-[1040px] flex-col gap-8">
        <AiKeyForm providers={CAPTION_PROVIDERS.map((id) => ({ id, label: PROVIDER_LABELS[id] }))} />

        <section className="flex flex-col gap-3">
          <h2 className="text-[15px] font-semibold">Provedores e modelos</h2>
          {keys.error || models.error ? (
            <ErrorNote>Não foi possível carregar a configuração de IA.</ErrorNote>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-border text-[13px] text-muted-fg">
                    <th className="py-2 pr-4 font-medium">Provedor</th>
                    <th className="py-2 pr-4 font-medium">Chave</th>
                    {TASKS.map((t) => (
                      <th key={t.task} className="py-2 pr-4 font-medium">
                        {t.label}
                      </th>
                    ))}
                    <th className="py-2 font-medium">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {CAPTION_PROVIDERS.map((p) => {
                    const k = keys.data.find((r) => r.provider === p);
                    return (
                      <tr key={p} className="border-b border-row align-top">
                        <td className="py-3 pr-4 font-medium">{PROVIDER_LABELS[p]}</td>
                        <td className="py-3 pr-4 tabular-nums text-text-2">
                          {k ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span aria-hidden className="size-2 rounded-full bg-brand" />
                              Guardada em {fmt.format(new Date(k.updated_at))}
                            </span>
                          ) : (
                            "Sem chave"
                          )}
                        </td>
                        {TASKS.map((t) => {
                          const m = models.data.find((r) => r.provider === p && r.task === t.task);
                          return (
                            <td key={t.task} className="py-3 pr-4">
                              {m ? <ModelForm id={m.id} model={m.model} label={`${t.label}, ${PROVIDER_LABELS[p]}`} options={modelOptions(p, t.task, m.model, available[p])} /> : "—"}
                            </td>
                          );
                        })}
                        <td className="py-3 text-right">
                          {k ? (
                            <form action={removeAiKey.bind(null, p)}>
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
            </div>
          )}
          <p className="text-[13px] text-muted-fg">
            Com chave guardada, a lista vem direto do provedor; sem chave, mostra os modelos mais usados. Com as duas chaves, cada cliente usa o provedor padrão dele; com uma só, todos usam essa.
          </p>
        </section>
      </div>
    </>
  );
}
