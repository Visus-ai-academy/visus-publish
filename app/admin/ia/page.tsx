import { PageHeader } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { ErrorNote } from "@/components/ui/states";
import { CAPTION_PROVIDERS, PROVIDER_LABELS } from "@/lib/ai/providers";
import { requireUser } from "@/lib/tenant";
import { removeAiKey } from "./actions";
import { AiKeyForm, ModelForm } from "./forms";

export const metadata = { title: "IA · Visus Publish" };

export default async function AdminAiPage() {
  const { supabase } = await requireUser();
  const [keys, models] = await Promise.all([
    supabase.from("ai_platform_keys").select("provider, updated_at"),
    supabase.from("ai_models").select("id, provider, model").eq("task", "caption").order("id"),
  ]);
  const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "short", year: "numeric" });

  return (
    <>
      <PageHeader title="IA da plataforma" sub="Chaves usadas pelos clientes no modo de cobrança da Visus e modelos de cada tarefa." />
      <div className="flex max-w-[1040px] flex-col gap-8">
        <AiKeyForm providers={CAPTION_PROVIDERS.map((id) => ({ id, label: PROVIDER_LABELS[id] }))} />

        <section className="flex flex-col gap-3">
          <h2 className="text-[15px] font-semibold">Legenda e tema</h2>
          {keys.error || models.error ? (
            <ErrorNote>Não foi possível carregar a configuração de IA.</ErrorNote>
          ) : (
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border text-[13px] text-muted-fg">
                  <th className="py-2 pr-4 font-medium">Provedor</th>
                  <th className="py-2 pr-4 font-medium">Chave</th>
                  <th className="py-2 pr-4 font-medium">Modelo</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {CAPTION_PROVIDERS.map((p) => {
                  const k = keys.data.find((r) => r.provider === p);
                  const m = models.data.find((r) => r.provider === p);
                  return (
                    <tr key={p} className="border-b border-row">
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
                      <td className="py-3 pr-4">{m ? <ModelForm id={m.id} model={m.model} /> : "—"}</td>
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
          )}
          <p className="text-[13px] text-muted-fg">Com as duas chaves, cada cliente usa o provedor padrão dele (OpenAI, se não mudou). Com uma só, todos usam essa.</p>
        </section>
      </div>
    </>
  );
}
