import { ComingSoon } from "@/components/shell/coming-soon";

export default async function Page({ params }: PageProps<"/[tenant]/criativos">) {
  return <ComingSoon slug={(await params).tenant} screen="criativos" />;
}
