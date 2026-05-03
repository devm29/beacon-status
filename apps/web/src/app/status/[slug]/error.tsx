"use client";

import { CloudOff } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

export default function StatusPageError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main role="alert" className="grid min-h-dvh place-items-center bg-canvas px-6">
      <EmptyState
        icon={CloudOff}
        title="Status is unavailable right now"
        description="This page couldn’t reach Beacon’s API. Try again in a moment."
        action={<Button onClick={reset}>Try again</Button>}
      />
    </main>
  );
}
