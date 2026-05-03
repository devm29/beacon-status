import Link from "next/link";
import { cn } from "@/lib/utils";

/** A macOS-style segmented control whose segments are links, so the selection lives in the URL. */
export function SegmentedLinks<T extends string>({
  options,
  value,
  href,
  label,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  href: (value: T) => string;
  label: string;
}) {
  return (
    <nav
      aria-label={label}
      className="inline-flex h-8 items-center rounded-lg bg-secondary p-0.5 dark:bg-[oklch(0.294_0.004_235)]"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Link
            key={option.value}
            href={href(option.value)}
            scroll={false}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-full items-center rounded-md px-3 text-[13px] font-medium text-muted-foreground transition-[color,background-color,box-shadow] duration-150 outline-none hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring",
              active && "bg-background text-foreground shadow-sm dark:bg-accent",
            )}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}
