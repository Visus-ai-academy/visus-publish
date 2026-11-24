"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { ADMIN_ICON, NAV_GROUPS, SCREENS } from "./nav";
import { Icon } from "./icon";

type Tenant = { slug: string; name: string };

export function Sidebar({
  tenants,
  current,
  isPlatformAdmin,
  footer,
}: {
  tenants: Tenant[];
  current?: Tenant;
  isPlatformAdmin: boolean;
  footer: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const item = (href: string, label: string, icon: string[]) => {
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-10 items-center gap-2.5 rounded-md px-2.5 text-[14px] transition-colors duration-150",
          active ? "bg-background font-semibold text-foreground ring-1 ring-border" : "text-text-2 hover:bg-muted",
        )}
      >
        <span className={active ? "text-brand" : "text-muted-fg"}>
          <Icon paths={icon} />
        </span>
        {label}
      </Link>
    );
  };

  return (
    <aside className="flex w-[240px] shrink-0 flex-col gap-5 border-r border-border bg-sidebar px-3 py-4">
      <p className="px-2.5 text-[15px] font-bold tracking-tight">Visus Publish</p>

      {tenants.length > 0 ? (
        <div className="flex flex-col gap-1 px-1">
          <label htmlFor="tenant-switch" className="px-1.5 text-[12px] font-medium text-muted-fg">
            Cliente
          </label>
          <select
            id="tenant-switch"
            className="h-10 rounded-md border border-border-strong bg-background px-2 text-[14px] font-semibold"
            value={current?.slug ?? ""}
            onChange={(e) => router.push(`/${e.target.value}/calendario`)}
          >
            {!current ? <option value="">Escolha um cliente</option> : null}
            {tenants.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <nav aria-label="Principal" className="flex flex-1 flex-col gap-4">
        {current
          ? NAV_GROUPS.map(([group, keys]) => (
              <div key={group} className="flex flex-col gap-0.5">
                <p className="px-2.5 pb-1 text-[12px] font-medium text-muted-fg">{group}</p>
                {keys.map((k) => item(`/${current.slug}/${k}`, SCREENS[k].label, SCREENS[k].icon))}
              </div>
            ))
          : null}
        {isPlatformAdmin ? (
          <div className="flex flex-col gap-0.5">
            <p className="px-2.5 pb-1 text-[12px] font-medium text-muted-fg">Plataforma</p>
            {item("/admin/clientes", "Clientes", ADMIN_ICON)}
          </div>
        ) : null}
      </nav>

      <div className="border-t border-border pt-3">{footer}</div>
    </aside>
  );
}
