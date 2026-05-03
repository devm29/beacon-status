import { Compass } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-6">
      <EmptyState
        icon={Compass}
        title="This page doesn’t exist"
        description="The link may be out of date, or the resource was deleted."
        action={
          <Button asChild size="pill">
            <Link href="/">Back to overview</Link>
          </Button>
        }
      />
    </main>
  );
}
