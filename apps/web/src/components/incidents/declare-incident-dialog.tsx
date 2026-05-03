"use client";

import { INCIDENT_IMPACTS, type IncidentImpact } from "@beacon/shared";
import { Siren } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { declareIncident } from "@/app/(dashboard)/actions";
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
import { Textarea } from "@/components/ui/textarea";
import { IMPACT_LABEL } from "@/lib/status";

function isImpact(value: string): value is IncidentImpact {
  return (INCIDENT_IMPACTS as readonly string[]).includes(value);
}

export function DeclareIncidentDialog({ monitors }: { monitors: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [impact, setImpact] = useState<IncidentImpact>("minor");
  const [monitorId, setMonitorId] = useState("none");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await declareIncident({
        title,
        message,
        impact,
        status: "investigating",
        monitorIds: monitorId === "none" ? [] : [monitorId],
      });
      if (!result.ok) {
        setErrors(result.fieldErrors);
        toast.error(result.error);
        return;
      }
      toast.success("Incident declared. Alert channels have been notified.");
      setOpen(false);
      router.push(`/incidents/${result.data.id}`);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Siren strokeWidth={1.75} /> Declare incident
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>Declare an incident</DialogTitle>
            <DialogDescription>It appears on the public status page right away.</DialogDescription>
          </DialogHeader>
          <Field id="incident-title" label="Title" error={errors.title}>
            <Input
              id="incident-title"
              required
              value={title}
              placeholder="Elevated error rates on checkout"
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="incident-impact" label="Impact">
              <Select value={impact} onValueChange={(v) => isImpact(v) && setImpact(v)}>
                <SelectTrigger id="incident-impact" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INCIDENT_IMPACTS.map((i) => (
                    <SelectItem key={i} value={i}>
                      {IMPACT_LABEL[i]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="incident-monitor" label="Affected component">
              <Select value={monitorId} onValueChange={setMonitorId}>
                <SelectTrigger id="incident-monitor" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {monitors.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field
            id="incident-message"
            label="First update"
            hint="Write for customers: what’s affected and what you’re doing."
            error={errors.message}
          >
            <Textarea
              id="incident-message"
              required
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Declaring…" : "Declare incident"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
