import { LoginForm } from "./login-form";

export const metadata = { title: "Entrar · Visus Publish" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  return (
    <>
      <h1 className="text-[20px] font-semibold">Entrar</h1>
      <p className="mb-6 mt-1 text-text-2">Use o e-mail em que você recebeu o convite.</p>
      <LoginForm next={typeof next === "string" ? next : undefined} />
    </>
  );
}
