"use client";

import { Send } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { sendTestNotification, setChannelEnabled } from "@/app/(dashboard)/actions";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

export function ChannelControls({ id, name, enabled }: { id: string; name: string; enabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(enabled);

  const toggle = (next: boolean) =>
    startTransition(async () => {
      setOptimistic(next);
      const result = await setChannelEnabled(id, next);
      if (!result.ok) toast.error(result.error);
    });

  const test = () =>
    startTransition(async () => {
      const result = await sendTestNotification(id);
      if (result.ok) toast.success(`Test sent to ${name}. Check the delivery log in a moment.`);
      else toast.error(result.error);
    });

  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" onClick={test} disabled={pending || !optimistic}>
        <Send strokeWidth={1.75} /> Test
      </Button>
      <Switch
        checked={optimistic}
        onCheckedChange={toggle}
        aria-label={`${optimistic ? "Disable" : "Enable"} ${name}`}
      />
    </div>
  );
}
