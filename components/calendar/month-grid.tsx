import Link from "next/link";
import { StatusDot } from "@/components/ui/status";
import { Thumb } from "@/components/ui/thumb";
import type { PostStatus } from "@/lib/posts/transitions";

export type GridPost = { id: string; theme: string; status: PostStatus; date: string; time: string; href: string; thumb: { url?: string | null; kind?: string | null; extra?: number } };

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** Dias do mês em grade (semana começa no domingo), com os posts de cada dia. */
export function MonthGrid({ month, today, posts }: { month: string; today: string; posts: GridPost[] }) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const byDay = new Map<number, GridPost[]>();
  for (const p of posts) {
    const d = Number(p.date.slice(8, 10));
    byDay.set(d, [...(byDay.get(d) ?? []), p]);
  }

  return (
    <div className="overflow-x-auto">
      <div role="grid" aria-label="Calendário do mês" className="grid min-w-[840px] grid-cols-7 border-t border-l border-border">
        <div role="row" className="contents">
          {WEEKDAYS.map((w) => (
            <div key={w} role="columnheader" className="border-r border-b border-border bg-subtle px-2 py-1.5 text-[13px] font-medium text-muted-fg">
              {w}
            </div>
          ))}
        </div>
        {Array.from({ length: cells.length / 7 }, (_, row) => (
          <div key={row} role="row" className="contents">
            {cells.slice(row * 7, row * 7 + 7).map((d, i) => {
              const date = d ? `${month}-${String(d).padStart(2, "0")}` : null;
              const list = d ? (byDay.get(d) ?? []) : [];
              return (
                <div key={i} role="gridcell" aria-label={d ? `Dia ${d}, ${list.length} posts` : undefined} className={`min-h-28 border-r border-b border-border p-1.5 ${d ? "" : "bg-subtle"}`}>
                  {d ? (
                    <>
                      <span className={`inline-flex size-6 items-center justify-center rounded-full text-[13px] tabular-nums ${date === today ? "bg-primary font-semibold text-on-primary" : "text-text-2"}`}>{d}</span>
                      <ul className="mt-1 flex flex-col gap-1">
                        {list.map((p) => (
                          <li key={p.id}>
                            <Link href={p.href} className="flex items-start gap-1.5 rounded-md p-1 transition-colors duration-150 hover:bg-muted">
                              <Thumb {...p.thumb} alt={p.theme} small />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-medium">{p.theme}</span>
                                <span className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-text-2">
                                  <span className="tabular-nums">{p.time}</span>
                                  <StatusDot status={p.status} />
                                </span>
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
