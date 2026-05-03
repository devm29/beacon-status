"use client";

import {
  Activity,
  BellRing,
  CalendarClock,
  Gauge,
  LayoutGrid,
  Settings2,
  Siren,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Overview", icon: LayoutGrid },
  { href: "/monitors", label: "Monitors", icon: Activity },
  { href: "/incidents", label: "Incidents", icon: Siren },
  { href: "/slos", label: "SLOs", icon: Gauge },
  { href: "/alerts", label: "Alerts", icon: BellRing },
  { href: "/maintenance", label: "Maintenance", icon: CalendarClock },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNav({ onNavigate, openIncidents }: { onNavigate?: () => void; openIncidents: number }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="grid gap-0.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            {...(onNavigate ? { onClick: onNavigate } : {})}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2 text-sidebar-foreground transition-colors duration-150 outline-none hover:bg-sidebar-accent/70 focus-visible:ring-4 focus-visible:ring-ring",
              // The sheet is the touch layout, where rows need a 44px hit target.
              onNavigate ? "h-11 text-[15px]" : "h-8 text-[13px]",
              active && "bg-sidebar-accent font-medium",
            )}
          >
            <Icon className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
            {label}
            {href === "/incidents" && openIncidents > 0 ? (
              <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-semibold text-white tabular-nums">
                {openIncidents}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
