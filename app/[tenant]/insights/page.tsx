import { ComingSoon } from "@/components/shell/coming-soon";

export default async function Page({ params }: PageProps<"/[tenant]/insights">) {
  return <ComingSoon slug={(await params).tenant} screen="insights" />;
}
