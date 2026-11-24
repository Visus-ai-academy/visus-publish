import { redirect } from "next/navigation";
import { getDefaultTenant, isPlatformAdmin, requireUser } from "@/lib/tenant";
import { EmptyState } from "@/components/ui/states";
import { signOut } from "./(auth)/actions";
import { Button } from "@/components/ui/button";

export default async function Home() {
  const { user } = await requireUser();
  const tenant = await getDefaultTenant();
  if (tenant) redirect(`/${tenant.slug}/calendario`);
  if (await isPlatformAdmin()) redirect("/admin/clientes");

  return (
    <main className="mx-auto max-w-[560px] px-4 py-24">
      <EmptyState
        title="Você ainda não faz parte de nenhum cliente"
        body={`Logado como ${user.email}. Peça a um administrador para enviar um convite para este e-mail.`}
        action={
          <form action={signOut}>
            <Button variant="secondary">Sair</Button>
          </form>
        }
      />
    </main>
  );
}
