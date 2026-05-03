import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { DeclareIncidentDialog } from "@/components/incidents/declare-incident-dialog";
import { IncidentList } from "@/components/incidents/incident-list";
import { PageHeader } from "@/components/page-header";
import { SegmentedLinks } from "@/components/segmented-links";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getIncidents, getMonitors } from "@/lib/queries";

export const metadata = { title: "Incidents" };

const FILTERS = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; cursor?: string }>;
}) {
  const query = await searchParams;
  const filter: Filter = FILTERS.find((f) => f.value === query.status)?.value ?? "all";
  const [page, monitors] = await Promise.all([
    getIncidents({
      ...(filter === "all" ? {} : { status: filter }),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    }),
    getMonitors(),
  ]);
  const base = filter === "all" ? "/incidents" : `/incidents?status=${filter}`;

  return (
    <>
      <PageHeader
        title="Incidents"
        description="Opened and resolved automatically from quorum results, or declared by your team."
        actions={<DeclareIncidentDialog monitors={monitors.map((m) => ({ id: m.id, name: m.name }))} />}
      />
      <SegmentedLinks
        label="Filter incidents"
        options={FILTERS}
        value={filter}
        href={(v) => (v === "all" ? "/incidents" : `/incidents?status=${v}`)}
      />
      <Card className="gap-0 overflow-hidden p-0">
        {page.items.length > 0 ? (
          <IncidentList incidents={page.items} now={new Date()} />
        ) : (
          <EmptyState
            icon={ShieldCheck}
            title={filter === "open" ? "No open incidents" : "No incidents yet"}
            description="When two of three regions agree a monitor is down, Beacon opens one here and updates your status page."
          />
        )}
        {query.cursor || page.nextCursor ? (
          <div className="flex justify-end gap-2 border-t border-border/60 p-3">
            {query.cursor ? (
              <Button asChild variant="ghost" size="sm">
                <Link href={base}>Newest</Link>
              </Button>
            ) : null}
            {page.nextCursor ? (
              <Button asChild variant="ghost" size="sm">
                <Link href={`${base}${base.includes("?") ? "&" : "?"}cursor=${page.nextCursor}`}>
                  Older incidents
                </Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </Card>
    </>
  );
}
