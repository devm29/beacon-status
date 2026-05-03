import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { LiveRefresh } from "@/components/realtime/live-refresh";
import { RealtimeProvider } from "@/components/realtime/realtime-provider";
import { ApiError, currentApiKey } from "@/lib/api";
import { serverEnv } from "@/lib/env";
import { getIncidents, getMe } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  if (!(await currentApiKey())) redirect("/login");
  let me;
  try {
    me = await getMe();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect("/login");
    throw error;
  }
  const open = await getIncidents({ status: "open", limit: 50 });

  return (
    <RealtimeProvider apiUrl={serverEnv.BROWSER_API_URL}>
      <AppShell org={{ name: me.name, slug: me.slug }} openIncidents={open.items.length}>
        {children}
      </AppShell>
      <LiveRefresh />
    </RealtimeProvider>
  );
}
