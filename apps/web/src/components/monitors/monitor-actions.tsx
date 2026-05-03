"use client";

import { Pause, Play, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteMonitor, setMonitorPaused } from "@/app/(dashboard)/actions";
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

export function MonitorActions({
  id,
  name,
  paused,
  managedBy,
}: {
  id: string;
  name: string;
  paused: boolean;
  managedBy: "config" | "ui";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  const togglePause = () =>
    startTransition(async () => {
      const result = await setMonitorPaused(id, !paused);
      if (result.ok)
        toast.success(paused ? `${name} resumed` : `${name} paused. No probes will run until you resume it.`);
      else toast.error(result.error);
    });

  const remove = () =>
    startTransition(async () => {
      const result = await deleteMonitor(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setConfirming(false);
      toast.success(`${name} deleted`);
      router.push("/monitors");
    });

  return (
    <>
      <Button variant="outline" className="bg-card" onClick={togglePause} disabled={pending}>
        {paused ? <Play strokeWidth={1.75} /> : <Pause strokeWidth={1.75} />}
        {paused ? "Resume" : "Pause"}
      </Button>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogTrigger asChild>
          <Button variant="destructive" disabled={pending}>
            <Trash2 strokeWidth={1.75} /> Delete
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {name}?</DialogTitle>
            <DialogDescription>
              Its probes stop immediately and its SLOs are removed. Past incidents stay in the timeline.
              {managedBy === "config"
                ? " This monitor is managed by beacon.yaml, so the next apply will recreate it."
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={remove}
              disabled={pending}
            >
              Delete monitor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
