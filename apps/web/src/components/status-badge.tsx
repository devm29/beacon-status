import { Badge } from "@/components/ui/badge";
import { TONE_BADGE, type Tone } from "@/lib/status";
import { StatusDot } from "./status-dot";

export function StatusBadge({ tone, label, pulse = false }: { tone: Tone; label: string; pulse?: boolean }) {
  return (
    <Badge variant={TONE_BADGE[tone]} className="gap-1.5 pl-1.5">
      <StatusDot tone={tone} pulse={pulse} className="size-1.5 [&>span]:size-1.5" />
      {label}
    </Badge>
  );
}
