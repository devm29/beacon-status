import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

export function KpiTile({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <Card className="gap-1.5">
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className="text-[28px] leading-[34px] font-semibold tracking-tight tabular-nums">{value}</div>
      {detail ? <div className="text-[13px] text-muted-foreground">{detail}</div> : null}
    </Card>
  );
}
