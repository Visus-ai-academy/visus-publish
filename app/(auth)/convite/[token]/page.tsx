import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import { EmptyState } from "@/components/ui/states";
import { AcceptForm, SignUpForm } from "./invite-forms";

export const metadata = { title: "Convite · Visus Publish" };

export default async function InvitePage({ params }: PageProps<"/convite/[token]">) {
  const { token } = await params;
  const supabase = await createClient();
  const [{ data: preview }, { data: auth }] = await Promise.all([
    supabase.rpc("invitation_preview", { p_token: token }),
    supabase.auth.getUser(),
  ]);
  const inv = preview?.[0] as { tenant_name: string; email: string; role: Role; valid: boolean } | undefined;

  if (!inv?.valid) {
    return (
      <EmptyState
        title="Convite inválido ou expirado"
        body="Peça a quem convidou você para enviar um novo link."
        action={<Link className="font-semibold underline" href="/login">Ir para o login</Link>}
      />
    );
  }

  const sameUser = auth.user?.email?.toLowerCase() === inv.email.toLowerCase();

  return (
    <>
      <h1 className="text-[20px] font-semibold">Convite para {inv.tenant_name}</h1>
      <p className="mb-6 mt-1 text-text-2">
        Você vai entrar como <strong>{ROLE_LABELS[inv.role].name}</strong>. {ROLE_LABELS[inv.role].description}
      </p>
      {sameUser ? (
        <AcceptForm token={token} />
      ) : auth.user ? (
        <EmptyState
          title="Este convite é para outro e-mail"
          body={`Você está logado como ${auth.user.email}. Saia e entre com ${inv.email}.`}
        />
      ) : (
        <>
          <SignUpForm token={token} email={inv.email} />
          <p className="mt-4 text-[13px] text-text-2">
            Já tem conta?{" "}
            <Link className="font-semibold underline" href={`/login?next=/convite/${token}`}>
              Entrar
            </Link>
          </p>
        </>
      )}
    </>
  );
}
