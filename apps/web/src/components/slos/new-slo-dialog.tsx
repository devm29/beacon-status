"use client";

import { SLO_WINDOWS, slugify } from "@beacon/shared";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { createSlo } from "@/app/(dashboard)/actions";
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

const TARGETS = ["99", "99.5", "99.9", "99.95", "99.99"] as const;

export function NewSloDialog({ monitors }: { monitors: { key: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [monitor, setMonitor] = useState(monitors[0]?.key ?? "");
  const [target, setTarget] = useState("99.9");
  const [windowDays, setWindowDays] = useState("30");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const days = SLO_WINDOWS.find((w) => String(w) === windowDays) ?? 30;
    startTransition(async () => {
      const result = await createSlo({
        key: slugify(name),
        name,
        monitor,
        target: Number(target),
        windowDays: days,
      });
      if (!result.ok) {
        setErrors(result.fieldErrors);
        toast.error(result.error);
        return;
      }
      toast.success(`${name} is tracking its error budget`);
      setOpen(false);
      router.push(`/slos/${result.data.id}`);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={monitors.length === 0}>
          <Plus strokeWidth={2} /> New SLO
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>New service level objective</DialogTitle>
            <DialogDescription>
              Availability is measured from probe results across all regions.
            </DialogDescription>
          </DialogHeader>
          <Field id="slo-name" label="Name" error={errors.name ?? errors.key}>
            <Input
              id="slo-name"
              required
              value={name}
              placeholder="Checkout availability"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field id="slo-monitor" label="Monitor" error={errors.monitor}>
            <Select value={monitor} onValueChange={setMonitor}>
              <SelectTrigger id="slo-monitor" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monitors.map((m) => (
                  <SelectItem key={m.key} value={m.key}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="slo-target" label="Target" error={errors.target}>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger id="slo-target" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TARGETS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="slo-window" label="Window">
              <Select value={windowDays} onValueChange={setWindowDays}>
                <SelectTrigger id="slo-window" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SLO_WINDOWS.map((w) => (
                    <SelectItem key={w} value={String(w)}>
                      {w} days
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending || !name}>
              {pending ? "Creating…" : "Create SLO"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
