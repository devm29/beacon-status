import type { RealtimeEvent } from "@beacon/shared";
import type { Response } from "express";

const HEARTBEAT_MS = 20_000;

export interface SseLimits {
  maxPerIp: number;
  maxPerOrg: number;
}

interface Client {
  res: Response;
  ip: string;
}

/** Tracks Server-Sent Event subscribers of public status pages, keyed by organization id. */
export class SseHub {
  private readonly clients = new Map<string, Set<Client>>();
  private readonly perIp = new Map<string, number>();
  private readonly heartbeat: NodeJS.Timeout;

  constructor(private readonly limits: SseLimits = { maxPerIp: 20, maxPerOrg: 5_000 }) {
    this.heartbeat = setInterval(() => {
      for (const set of this.clients.values()) for (const { res } of set) res.write(": keep-alive\n\n");
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  /** Returns null when the caller is over its connection allowance. */
  subscribe(orgId: string, res: Response, ip: string): (() => void) | null {
    const set = this.clients.get(orgId) ?? new Set<Client>();
    if ((this.perIp.get(ip) ?? 0) >= this.limits.maxPerIp || set.size >= this.limits.maxPerOrg) return null;

    res.status(200).set({
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.flushHeaders();
    res.write("retry: 5000\n\n");
    res.write(`event: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);

    const client: Client = { res, ip };
    set.add(client);
    this.clients.set(orgId, set);
    this.perIp.set(ip, (this.perIp.get(ip) ?? 0) + 1);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      set.delete(client);
      if (set.size === 0) this.clients.delete(orgId);
      const remaining = (this.perIp.get(ip) ?? 1) - 1;
      if (remaining <= 0) this.perIp.delete(ip);
      else this.perIp.set(ip, remaining);
    };
  }

  broadcast(orgId: string, event: RealtimeEvent): number {
    const set = this.clients.get(orgId);
    if (!set) return 0;
    const frame = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const { res } of set) res.write(frame);
    return set.size;
  }

  get size(): number {
    let total = 0;
    for (const set of this.clients.values()) total += set.size;
    return total;
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const set of this.clients.values()) for (const { res } of set) res.end();
    this.clients.clear();
    this.perIp.clear();
  }
}
