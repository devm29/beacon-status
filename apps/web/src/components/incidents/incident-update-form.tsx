"use client";

import { INCIDENT_STATUS_LABELS, allowedNextStatuses, type IncidentStatus } from "@beacon/shared";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { postIncidentUpdate } from "@/app/(dashboard)/actions";
import { Field } from "@/components/field";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

export function IncidentUpdateForm({
  incidentId,
  status,
  automated,
  autoResolve,
}: {
  incidentId: string;
  status: IncidentStatus;
  automated: boolean;
  autoResolve: boolean;
}) {
  const options = allowedNextStatuses(status);
  const [next, setNext] = useState<IncidentStatus>(status);
  const [message, setMessage] = useState("");
  const [keepAuto, setKeepAuto] = useState(autoResolve);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await postIncidentUpdate(incidentId, {
        status: next,
        message,
        ...(automated && keepAuto !== autoResolve ? { autoResolve: keepAuto } : {}),
      });
      if (!result.ok) {
        setError(result.fieldErrors.message ?? result.error);
        toast.error(result.error);
        return;
      }
      setMessage("");
      setError(undefined);
      toast.success(
        next === status
          ? "Update posted"
          : next === "resolved"
            ? "Incident resolved"
            : `Update posted as ${INCIDENT_STATUS_LABELS[next].toLowerCase()}`,
      );
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-1.5">
        <span className="text-[13px] font-medium">Status</span>
        <Tabs value={next} onValueChange={(v) => setNext(options.find((o) => o === v) ?? next)}>
          <TabsList className="w-full">
            {options.map((o) => (
              <TabsTrigger key={o} value={o} className="min-w-0 px-1.5">
                {INCIDENT_STATUS_LABELS[o]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <Field id="update-message" label="Message" error={error}>
        <Textarea
          id="update-message"
          rows={4}
          required
          value={message}
          placeholder={
            status === "resolved"
              ? next === "resolved"
                ? "Postmortem: https://…"
                : "Errors have returned for some customers."
              : "We’ve identified the cause and are rolling out a fix."
          }
          onChange={(e) => setMessage(e.target.value)}
        />
      </Field>
      {automated && status !== "resolved" ? (
        <label className="flex min-h-11 items-center justify-between gap-4 rounded-xl border border-border/60 px-4 text-[13px]">
          <span>
            Resolve automatically
            <span className="block text-[12px] text-muted-foreground">
              After the monitor stays healthy for a few minutes
            </span>
          </span>
          <Switch checked={keepAuto} onCheckedChange={setKeepAuto} />
        </label>
      ) : null}
      <Button type="submit" disabled={pending} className="justify-self-end">
        {pending ? "Posting…" : "Post update"}
      </Button>
    </form>
  );
}
