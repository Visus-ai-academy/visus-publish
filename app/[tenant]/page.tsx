import { redirect } from "next/navigation";

export default async function TenantIndex({ params }: PageProps<"/[tenant]">) {
  redirect(`/${(await params).tenant}/calendario`);
}
