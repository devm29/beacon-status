import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

export function KpiTile({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <Card className="min-w-0 gap-1.5 p-4 sm:p-5">
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className="text-[24px] leading-[30px] font-semibold sm:text-[28px] sm:leading-[34px] tracking-tight tabular-nums">
        {value}
      </div>
      {detail ? <div className="text-[13px] text-muted-foreground">{detail}</div> : null}
    </Card>
  );
}
