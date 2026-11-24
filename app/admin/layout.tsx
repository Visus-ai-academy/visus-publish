import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { isPlatformAdmin } from "@/lib/tenant";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isPlatformAdmin())) notFound();
  return <AppShell>{children}</AppShell>;
}
