import Link from "next/link";
import { EmptyState } from "@/components/ui/states";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-[560px] px-4 py-24">
      <EmptyState
        title="Cliente não encontrado"
        body="Este endereço não existe ou você não tem acesso a ele."
        action={<Link className="font-semibold text-brand-dark underline" href="/">Voltar para o início</Link>}
      />
    </main>
  );
}
