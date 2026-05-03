"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { cancelMaintenance } from "@/app/(dashboard)/actions";
import { Button } from "@/components/ui/button";

export function CancelMaintenanceButton({ id, title }: { id: string; title: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="destructive"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await cancelMaintenance(id);
          if (result.ok) toast.success(`${title} cancelled`);
          else toast.error(result.error);
        })
      }
    >
      Cancel
    </Button>
  );
}
