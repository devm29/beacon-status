import { REGION_LABELS, type RegionStatusDto } from "@beacon/shared";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatMs } from "@/lib/format";
import { TONE_DOT, checkTone } from "@/lib/status";
import { cn } from "@/lib/utils";

const describe = (r: RegionStatusDto) =>
  `${REGION_LABELS[r.region]}: ${r.status === "down" ? (r.error ?? "down") : `${r.status}, ${formatMs(r.latencyMs)}`}${r.stale ? ", stale" : ""}`;

/**
 * Hover reveals each region's detail; keyboard and screen reader users get the same detail as one
 * label on the group instead of three extra tab stops per table row.
 */
export function RegionDots({ regions }: { regions: RegionStatusDto[] }) {
  if (regions.length === 0) return <span className="text-[12px] text-muted-foreground">No probes yet</span>;
  return (
    <div className="flex items-center gap-1" role="img" aria-label={regions.map(describe).join("; ")}>
      {regions.map((r) => (
        <Tooltip key={r.region}>
          <TooltipTrigger asChild>
            <span
              aria-hidden
              className={cn(
                "inline-flex h-5 items-center rounded-full px-1.5 text-[10px] font-semibold tracking-wide uppercase",
                r.stale ? "bg-muted text-muted-foreground" : "bg-secondary text-foreground dark:bg-accent",
              )}
            >
              <span
                className={cn(
                  "mr-1 size-1.5 rounded-full",
                  r.stale ? "bg-muted-foreground/40" : TONE_DOT[checkTone(r.status)],
                )}
              />
              {r.region
                .split("-")
                .map((part) => part[0])
                .join("")}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {REGION_LABELS[r.region]} · {r.status === "down" ? (r.error ?? "down") : formatMs(r.latencyMs)}
            {r.stale ? " · stale" : ""}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
