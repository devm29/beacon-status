import { stringify } from "yaml";
import { PageHeader } from "@/components/page-header";
import { CodeBlock } from "@/components/settings/code-block";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { serverEnv } from "@/lib/env";
import { exportConfig, getMe } from "@/lib/queries";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [me, config] = await Promise.all([getMe(), exportConfig()]);
  const yaml = stringify(config, { lineWidth: 0 });
  const badgeUrl = `${serverEnv.BROWSER_API_URL}/public/status/${me.slug}/badge.svg`;
  const markdown = `[![Status](${badgeUrl})](${serverEnv.PUBLIC_WEB_URL}/status/${me.slug})`;
  const cli = [
    "export BEACON_API_URL=" + serverEnv.BROWSER_API_URL,
    "export BEACON_API_KEY=bk_…",
    "pnpm beacon export -o beacon.yaml",
    "pnpm beacon plan -f beacon.yaml",
    "pnpm beacon apply -f beacon.yaml --prune",
  ].join("\n");

  return (
    <>
      <PageHeader title="Settings" description={`${me.name} · status page at /status/${me.slug}`} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Status badge</CardTitle>
            <CardDescription>
              An SVG that always shows your current overall status. Add ?component=key for a single component.
            </CardDescription>
          </CardHeader>
          {/* eslint-disable-next-line @next/next/no-img-element -- the badge is a live SVG served by the API */}
          <img src={badgeUrl} alt={`${me.name} status badge`} height={20} className="h-5 w-auto self-start" />
          <CodeBlock
            code={markdown}
            label="Markdown snippet"
            className="p-4 pr-12 font-mono text-[12px] leading-5 break-all whitespace-pre-wrap"
          />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Monitoring as code</CardTitle>
            <CardDescription>
              Plan and apply beacon.yaml from your terminal or CI. Only resources created from config are
              pruned.
            </CardDescription>
          </CardHeader>
          <CodeBlock code={cli} label="CLI commands" />
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current configuration</CardTitle>
          <CardDescription>
            Exported from the live organization. Channel credentials appear as {"${CHANNEL_…}"} placeholders;
            set those variables before applying.
          </CardDescription>
        </CardHeader>
        <CodeBlock
          code={yaml}
          label="beacon.yaml"
          className="max-h-[32rem] overflow-auto p-4 pr-12 font-mono text-[12px] leading-5"
        />
      </Card>
    </>
  );
}
