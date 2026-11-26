import { STATUS_LABELS, type PostStatus } from "@/lib/posts/transitions";

const DOT: Record<PostStatus, string> = {
  planned: "var(--st-planned)",
  generating: "var(--st-generating)",
  generation_failed: "var(--st-rejected)",
  pending_approval: "var(--st-pending)",
  rejected: "var(--st-rejected)",
  scheduled: "var(--st-scheduled)",
  publishing: "var(--st-generating)",
  published: "var(--st-published)",
  failed: "var(--st-rejected)",
  paused: "var(--st-planned)",
};

export function StatusDot({ status }: { status: PostStatus }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 font-medium text-foreground"
      style={{ background: `color-mix(in srgb, ${DOT[status]} 14%, white)` }}
    >
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: DOT[status] }} />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "success" | "danger"; children: React.ReactNode }) {
  const cls = tone === "danger" ? "bg-danger-bg text-danger" : tone === "success" ? "bg-brand-soft text-brand-dark" : "bg-muted text-text-2";
  return (
    <p role={tone === "danger" ? "alert" : "status"} className={`rounded-md px-3 py-2.5 text-[13px] ${cls}`}>
      {children}
    </p>
  );
}
