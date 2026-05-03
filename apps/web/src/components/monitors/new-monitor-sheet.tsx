"use client";

import {
  CHECK_TYPE_LABELS,
  REGIONS,
  REGION_LABELS,
  slugify,
  type CheckInput,
  type CheckType,
  type MonitorSpecInput,
  type Region,
} from "@beacon/shared";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { createMonitor } from "@/app/(dashboard)/actions";
import { Field } from "@/components/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const INTERVALS = [
  { value: "30", label: "Every 30 seconds" },
  { value: "60", label: "Every minute" },
  { value: "120", label: "Every 2 minutes" },
  { value: "300", label: "Every 5 minutes" },
] as const;

const CHECK_TYPES = Object.keys(CHECK_TYPE_LABELS) as CheckType[];

function isCheckType(value: string): value is CheckType {
  return (CHECK_TYPES as string[]).includes(value);
}

interface FormState {
  name: string;
  key: string;
  keyEdited: boolean;
  group: string;
  type: CheckType;
  url: string;
  keyword: string;
  host: string;
  port: string;
  interval: string;
  degradedMs: string;
  regions: Region[];
  isPublic: boolean;
}

const INITIAL: FormState = {
  name: "",
  key: "",
  keyEdited: false,
  group: "",
  type: "http",
  url: "https://",
  keyword: "",
  host: "",
  port: "443",
  interval: "60",
  degradedMs: "",
  regions: [...REGIONS],
  isPublic: true,
};

function toCheck(form: FormState): CheckInput {
  switch (form.type) {
    case "http":
      return { type: "http", url: form.url.trim() };
    case "keyword":
      return { type: "keyword", url: form.url.trim(), keyword: form.keyword };
    case "tcp":
      return { type: "tcp", host: form.host.trim(), port: Number(form.port) };
    case "ssl":
      return { type: "ssl", host: form.host.trim(), port: Number(form.port || 443) };
  }
}

export function NewMonitorSheet({ groups }: { groups: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>({ ...INITIAL, group: groups[0] ?? "Services" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const spec: MonitorSpecInput = {
      key: form.key,
      name: form.name,
      group: form.group.trim() || "Services",
      check: toCheck(form),
      intervalSeconds: Number(form.interval),
      timeoutMs: Math.min(10_000, Number(form.interval) * 1000 - 1000),
      regions: form.regions,
      quorum: Math.min(2, form.regions.length),
      degradedLatencyMs: form.degradedMs ? Number(form.degradedMs) : null,
      public: form.isPublic,
    };
    startTransition(async () => {
      const result = await createMonitor(spec);
      if (!result.ok) {
        setErrors(result.fieldErrors);
        toast.error(result.error);
        return;
      }
      toast.success(`${form.name} is being probed from ${form.regions.length} regions`);
      setOpen(false);
      setForm({ ...INITIAL, group: form.group });
      setErrors({});
      router.push(`/monitors/${result.data.id}`);
    });
  };

  const urlBased = form.type === "http" || form.type === "keyword";
  const err = (path: string) => errors[path];

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button>
          <Plus strokeWidth={2} /> New monitor
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <form onSubmit={submit} className="flex min-h-full flex-col">
          <SheetHeader className="p-6 pb-2">
            <SheetTitle className="text-[17px] font-semibold">New monitor</SheetTitle>
            <SheetDescription>Probes start within seconds from every region you pick.</SheetDescription>
          </SheetHeader>

          <div className="grid gap-5 px-6 py-4">
            <Field id="name" label="Name" error={err("name")}>
              <Input
                id="name"
                value={form.name}
                required
                autoFocus
                placeholder="Checkout API"
                onChange={(e) => {
                  const name = e.target.value;
                  setForm((f) => ({ ...f, name, key: f.keyEdited ? f.key : slugify(name) }));
                }}
              />
            </Field>
            <Field
              id="key"
              label="Key"
              hint="Used by beacon.yaml and the CLI. It can’t change later."
              error={err("key")}
            >
              <Input
                id="key"
                value={form.key}
                required
                className="font-mono text-[13px]"
                onChange={(e) => setForm((f) => ({ ...f, key: e.target.value, keyEdited: true }))}
              />
            </Field>
            <Field
              id="group"
              label="Group"
              hint="Components are grouped by this on the status page."
              error={err("group")}
            >
              <Input
                id="group"
                list="monitor-groups"
                value={form.group}
                onChange={(e) => update("group", e.target.value)}
              />
              <datalist id="monitor-groups">
                {groups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </Field>

            <div className="grid gap-1.5">
              <span className="text-[13px] font-medium">Check type</span>
              <Tabs value={form.type} onValueChange={(v) => isCheckType(v) && update("type", v)}>
                <TabsList className="w-full">
                  {CHECK_TYPES.map((t) => (
                    <TabsTrigger key={t} value={t}>
                      {t === "ssl" ? "SSL" : CHECK_TYPE_LABELS[t]}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>

            {urlBased ? (
              <Field id="url" label="URL" error={err("check.url")}>
                <Input
                  id="url"
                  type="url"
                  required
                  value={form.url}
                  onChange={(e) => update("url", e.target.value)}
                />
              </Field>
            ) : (
              <div className="grid grid-cols-[1fr_96px] gap-3">
                <Field id="host" label="Host" error={err("check.host")}>
                  <Input
                    id="host"
                    required
                    value={form.host}
                    placeholder="db.internal"
                    onChange={(e) => update("host", e.target.value)}
                  />
                </Field>
                <Field id="port" label="Port" error={err("check.port")}>
                  <Input
                    id="port"
                    inputMode="numeric"
                    required
                    value={form.port}
                    onChange={(e) => update("port", e.target.value)}
                  />
                </Field>
              </div>
            )}
            {form.type === "keyword" ? (
              <Field
                id="keyword"
                label="Keyword"
                hint="The check fails if the page doesn’t contain this text."
                error={err("check.keyword")}
              >
                <Input
                  id="keyword"
                  required
                  value={form.keyword}
                  onChange={(e) => update("keyword", e.target.value)}
                />
              </Field>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <Field id="interval" label="Frequency" error={err("intervalSeconds")}>
                <Select value={form.interval} onValueChange={(v) => update("interval", v)}>
                  <SelectTrigger id="interval" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INTERVALS.map((i) => (
                      <SelectItem key={i.value} value={i.value}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id="degraded" label="Slow after (ms)" hint="Optional" error={err("degradedLatencyMs")}>
                <Input
                  id="degraded"
                  inputMode="numeric"
                  placeholder="800"
                  value={form.degradedMs}
                  onChange={(e) => update("degradedMs", e.target.value.replace(/\D/g, ""))}
                />
              </Field>
            </div>

            <fieldset className="grid gap-1.5">
              <legend className="mb-1.5 text-[13px] font-medium">Regions</legend>
              <div className="divide-y divide-border/60 rounded-xl border border-border/60">
                {REGIONS.map((region) => (
                  <label key={region} className="flex min-h-11 items-center justify-between px-4 text-[14px]">
                    {REGION_LABELS[region]}
                    <Switch
                      checked={form.regions.includes(region)}
                      onCheckedChange={(on) =>
                        update(
                          "regions",
                          on ? [...form.regions, region] : form.regions.filter((r) => r !== region),
                        )
                      }
                      aria-label={REGION_LABELS[region]}
                    />
                  </label>
                ))}
              </div>
              <p className="text-[12px] text-muted-foreground">
                {form.regions.length >= 2
                  ? "An outage is declared only when two regions agree."
                  : "With one region, a single failed probe can open an incident."}
              </p>
              {err("regions") ? (
                <p role="alert" className="text-[12px] text-destructive">
                  {err("regions")}
                </p>
              ) : null}
            </fieldset>

            <label className="flex min-h-11 items-center justify-between rounded-xl border border-border/60 px-4 text-[14px]">
              Show on the public status page
              <Switch checked={form.isPublic} onCheckedChange={(v) => update("isPublic", v)} />
            </label>
          </div>

          <SheetFooter className="mt-auto flex-row justify-end gap-2 border-t border-border/60 p-4">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || form.regions.length === 0}>
              {pending ? "Creating…" : "Create monitor"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
