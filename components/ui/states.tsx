export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-border bg-subtle px-6 py-10">
      <p className="text-[15px] font-semibold text-foreground">{title}</p>
      <p className="max-w-[52ch] text-text-2">{body}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">
      {children}
    </p>
  );
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Carregando" className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}
