import type { Logger, OrgRepository } from "@beacon/core";
import { isPublicEvent, type RealtimeEvent } from "@beacon/shared";
import { Types } from "mongoose";
import type { Server } from "socket.io";
import type { StatusPageService } from "../services/status-page.js";
import type { StatusPageRevalidator } from "./revalidator.js";
import type { SseHub } from "./sse.js";

export function orgRoom(orgId: string): string {
  return `org:${orgId}`;
}

/**
 * Routes events from Redis to every audience: operators over Socket.IO, anonymous status page
 * visitors over SSE (public events only), and the Next.js ISR cache.
 */
export function createFanout(deps: {
  io: Server;
  sse: SseHub;
  revalidator: Pick<StatusPageRevalidator, "schedule">;
  orgs: OrgRepository;
  statusPage: Pick<StatusPageService, "invalidate">;
  logger: Logger;
}): (event: RealtimeEvent) => void {
  const slugs = new Map<string, string>();

  const slugFor = async (orgId: string): Promise<string | null> => {
    const cached = slugs.get(orgId);
    if (cached) return cached;
    if (!Types.ObjectId.isValid(orgId)) return null;
    const org = await deps.orgs.findById(new Types.ObjectId(orgId));
    if (!org) return null;
    slugs.set(orgId, org.slug);
    return org.slug;
  };

  return (event) => {
    deps.io.to(orgRoom(event.orgId)).emit("event", event);
    if (!isPublicEvent(event)) return;
    void (async () => {
      const slug = await slugFor(event.orgId);
      if (slug) deps.statusPage.invalidate(slug);
      deps.sse.broadcast(event.orgId, event);
      if (slug) await deps.revalidator.schedule(slug);
    })().catch((error: unknown) => deps.logger.warn({ err: error }, "event fan-out failed"));
  };
}
