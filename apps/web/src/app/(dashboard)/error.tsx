"use client";

import { CloudOff } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert">
      <EmptyState
        icon={CloudOff}
        title="Couldn’t load this page"
        description="Beacon’s API didn’t respond as expected. Check that the API is running, then try again."
        action={<Button onClick={reset}>Try again</Button>}
      />
    </div>
  );
}
