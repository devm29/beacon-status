import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <Icon className="mb-4 size-10 text-muted-foreground/60" strokeWidth={1.5} aria-hidden />
      <h3 className="text-[17px] leading-[22px] font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-[13px] leading-[18px] text-muted-foreground">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
