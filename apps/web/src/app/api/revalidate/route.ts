import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { DEV_REVALIDATE_SECRET, isProduction, serverEnv } from "@/lib/env";

const BodySchema = z.object({
  tags: z
    .array(z.string().regex(/^status:[a-z0-9-]+$/))
    .min(1)
    .max(20),
});

function secretMatches(provided: string | null): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(serverEnv.REVALIDATE_SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Called by the API when a public event lands, so ISR status pages refresh within seconds. */
export async function POST(request: NextRequest) {
  if (isProduction && serverEnv.REVALIDATE_SECRET === DEV_REVALIDATE_SECRET) {
    return NextResponse.json({ error: "REVALIDATE_SECRET is not configured" }, { status: 503 });
  }
  if (!secretMatches(request.headers.get("x-revalidate-secret"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  for (const tag of parsed.data.tags) revalidateTag(tag);
  return NextResponse.json({ revalidated: parsed.data.tags, at: new Date().toISOString() });
}
