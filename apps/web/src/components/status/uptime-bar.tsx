"use client";

import type { PublicComponent } from "@beacon/shared";
import { useState, type KeyboardEvent } from "react";
import { formatDate, formatPercent } from "@/lib/format";
import { DAY_LEVEL_CLASS, DAY_LEVEL_LABEL } from "@/lib/status";
import { cn } from "@/lib/utils";

type Day = PublicComponent["days"][number];

/**
 * Ninety daily bars behind a single tab stop: arrow keys move between days, so keyboard users get
 * the same detail as hover without tabbing through ninety elements. On touch screens a tap
 * selects a day, and tapping elsewhere dismisses it.
 */
export function UptimeBar({ days, name }: { days: Day[]; name: string }) {
  const [active, setActive] = useState<number | null>(null);
  const day = active === null ? null : days[active];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = days.length - 1;
    const current = active ?? last;
    const next =
      event.key === "ArrowLeft"
        ? Math.max(0, current - 1)
        : event.key === "ArrowRight"
          ? Math.min(last, current + 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
  };

  const incidentDays = days.filter((d) => d.incidents.length > 0).length;

  return (
    <div className="relative">
      <div
        role="img"
        tabIndex={0}
        aria-label={`${name}: 90 day uptime history, ${incidentDays} days with incidents. Use the arrow keys to inspect a day.`}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((a) => a ?? days.length - 1)}
        onBlur={() => setActive(null)}
        onMouseLeave={() => setActive(null)}
        className="flex h-8 items-stretch gap-px rounded-md outline-none focus-visible:ring-4 focus-visible:ring-ring sm:gap-[2px]"
      >
        {days.map((d, index) => (
          <span
            key={d.date}
            onMouseEnter={() => setActive(index)}
            onClick={() => setActive(index)}
            className={cn(
              "flex-1 rounded-[2px] transition-opacity duration-150",
              DAY_LEVEL_CLASS[d.level],
              active !== null && active !== index && "opacity-60",
            )}
          />
        ))}
      </div>
      {day && active !== null ? (
        <div
          role="status"
          className="material pointer-events-none absolute bottom-full z-20 mb-2 w-56 -translate-x-1/2 rounded-xl bg-popover/85 p-3 text-[12px] shadow-lg ring-1 ring-black/5 backdrop-blur-2xl backdrop-saturate-[1.8] dark:ring-white/10"
          style={{ left: `clamp(7rem, ${((active + 0.5) / days.length) * 100}%, calc(100% - 7rem))` }}
        >
          <div className="font-medium">{formatDate(day.date)}</div>
          <div className="mt-0.5 text-muted-foreground">
            {day.uptime === null ? "No data" : `${formatPercent(day.uptime, 2)} uptime`} ·{" "}
            {DAY_LEVEL_LABEL[day.level]}
          </div>
          {day.incidents.map((i) => (
            <div key={i.id} className="mt-1.5 border-t border-border/60 pt-1.5">
              {i.title}
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-2 flex justify-between text-[12px] text-muted-foreground">
        <span>90 days ago</span>
        <span>Today</span>
      </div>
    </div>
  );
}
