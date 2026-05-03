import { cn } from "@/lib/utils";

export function BudgetBar({ remaining, label }: { remaining: number; label: string }) {
  const clamped = Math.max(0, Math.min(1, remaining));
  const tone = remaining <= 0 ? "bg-destructive" : remaining < 0.25 ? "bg-warning" : "bg-success";
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-300", tone)}
        style={{ width: `${clamped * 100}%` }}
      />
    </div>
  );
}
