import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StatusPage } from "@/components/status/status-page";
import { ApiError } from "@/lib/api";
import { serverEnv } from "@/lib/env";
import { getPublicStatus } from "@/lib/queries";
import { OVERALL } from "@/lib/status";

// Incremental static regeneration: rendered once, then refreshed on demand by the API's
// revalidation webhook. Segment config has to be a literal, so this is only the ceiling; the
// data fetch itself uses STATUS_REVALIDATE_SECONDS and Next.js honours the lower of the two.
export const revalidate = 60;

export function generateStaticParams(): { slug: string }[] {
  return [];
}

async function load(slug: string) {
  try {
    return await getPublicStatus(slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const status = await load(slug);
  return {
    title: { absolute: `${status.page.title}` },
    description: `${OVERALL[status.overall].title}. ${status.page.description}`,
  };
}

export default async function PublicStatusPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const status = await load(slug);
  return <StatusPage initial={status} apiUrl={serverEnv.BROWSER_API_URL} />;
}
