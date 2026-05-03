"use client";

import { ExternalLink, Menu, RadioTower } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { AppNav } from "./app-nav";
import { LiveIndicator } from "./realtime/live-indicator";
import { ThemeToggle } from "./theme-toggle";

interface ShellProps {
  org: { name: string; slug: string };
  openIncidents: number;
  children: ReactNode;
}

function Brand() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2 rounded-md px-2 outline-none focus-visible:ring-4 focus-visible:ring-ring"
    >
      <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
        <RadioTower className="size-4" strokeWidth={2} aria-hidden />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">Beacon</span>
    </Link>
  );
}

function SidebarBody({
  org,
  openIncidents,
  onNavigate,
}: Omit<ShellProps, "children"> & { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-6 p-3">
      <Brand />
      <div className="grid gap-2">
        <div className="px-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {org.name}
        </div>
        <AppNav openIncidents={openIncidents} {...(onNavigate ? { onNavigate } : {})} />
      </div>
      <div className="mt-auto grid gap-3">
        <Link
          href={`/status/${org.slug}`}
          target="_blank"
          className={cn(
            "flex items-center gap-2.5 rounded-md px-2 text-sidebar-foreground outline-none hover:bg-sidebar-accent/70 focus-visible:ring-4 focus-visible:ring-ring",
            onNavigate ? "h-11 text-[15px]" : "h-8 text-[13px]",
          )}
        >
          <ExternalLink className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
          Public status page
        </Link>
        <div className="flex items-center justify-between px-2">
          <LiveIndicator />
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

export function AppShell({ org, openIncidents, children }: ShellProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-dvh bg-canvas md:grid md:grid-cols-[240px_1fr]">
      <aside className="material sticky top-0 hidden h-dvh border-r border-sidebar-border bg-sidebar/80 backdrop-blur-2xl backdrop-saturate-150 md:block">
        <SidebarBody org={org} openIncidents={openIncidents} />
      </aside>
      <div className="min-w-0">
        <header className="material sticky top-0 z-30 flex h-13 items-center gap-2 border-b border-border/60 bg-background/72 px-4 backdrop-blur-xl backdrop-saturate-[1.8] md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="size-11" aria-label="Open navigation">
                <Menu strokeWidth={1.75} />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 bg-sidebar p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SidebarBody org={org} openIncidents={openIncidents} onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          <Brand />
          <div className="ml-auto">
            <LiveIndicator />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
