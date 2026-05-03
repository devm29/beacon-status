"use client";

import { CalendarPlus } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { scheduleMaintenance } from "@/app/(dashboard)/actions";
import { Field } from "@/components/field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const DURATIONS = [
  { minutes: 15, label: "15 minutes" },
  { minutes: 30, label: "30 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 120, label: "2 hours" },
  { minutes: 240, label: "4 hours" },
] as const;

function defaultStart(): string {
  const date = new Date(Date.now() + 60 * 60_000);
  date.setMinutes(0, 0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function ScheduleMaintenanceDialog({ monitors }: { monitors: { key: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState(defaultStart);
  const [duration, setDuration] = useState("60");
  const [selected, setSelected] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const startsAt = new Date(start);
    const endsAt = new Date(startsAt.getTime() + Number(duration) * 60_000);
    startTransition(async () => {
      const result = await scheduleMaintenance({
        title,
        description,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        monitors: selected,
      });
      if (!result.ok) {
        setErrors(result.fieldErrors);
        toast.error(result.error);
        return;
      }
      toast.success("Maintenance scheduled. Alerts for affected monitors will be held.");
      setOpen(false);
      setTitle("");
      setDescription("");
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <CalendarPlus strokeWidth={1.75} /> Schedule maintenance
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>Schedule maintenance</DialogTitle>
            <DialogDescription>
              It’s announced on the status page, and incidents and alerts are suppressed while it runs.
            </DialogDescription>
          </DialogHeader>
          <Field id="mw-title" label="Title" error={errors.title}>
            <Input
              id="mw-title"
              required
              value={title}
              placeholder="Database version upgrade"
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field id="mw-description" label="Details for customers" error={errors.description}>
            <Textarea
              id="mw-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="mw-start" label="Starts" error={errors.startsAt}>
              <Input
                id="mw-start"
                type="datetime-local"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field id="mw-duration" label="Duration" error={errors.endsAt}>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger id="mw-duration" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATIONS.map((d) => (
                    <SelectItem key={d.minutes} value={String(d.minutes)}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 text-[13px] font-medium">Affected monitors</legend>
            <div className="max-h-56 divide-y divide-border/60 overflow-y-auto rounded-xl border border-border/60">
              {monitors.map((m) => (
                <label key={m.key} className="flex min-h-11 items-center justify-between px-4 text-[14px]">
                  {m.name}
                  <Switch
                    checked={selected.includes(m.key)}
                    onCheckedChange={(on) =>
                      setSelected((s) => (on ? [...s, m.key] : s.filter((k) => k !== m.key)))
                    }
                  />
                </label>
              ))}
            </div>
            <p className="text-[12px] text-muted-foreground">Leave all off to cover every monitor.</p>
          </fieldset>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Scheduling…" : "Schedule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
