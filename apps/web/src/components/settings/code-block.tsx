import { CopyButton } from "./copy-button";

export function CodeBlock({ code, label, className }: { code: string; label: string; className?: string }) {
  return (
    <div className="relative rounded-xl bg-secondary dark:bg-accent/40">
      <div className="absolute top-1.5 right-1.5">
        <CopyButton value={code} label={`Copy ${label}`} />
      </div>
      <pre className={className ?? "overflow-x-auto p-4 pr-12 font-mono text-[12px] leading-5"}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
