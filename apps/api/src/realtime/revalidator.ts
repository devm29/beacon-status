import type { Logger } from "@beacon/core";

/**
 * Asks the Next.js app to drop its cached status page. Calls within the window are coalesced per
 * slug, so a burst of events during an outage costs one regeneration, not hundreds.
 */
export class StatusPageRevalidator {
  private readonly pending = new Map<string, { timer: NodeJS.Timeout; done: Promise<void> }>();

  constructor(
    private readonly options: { url: string | undefined; secret: string; debounceMs: number; logger: Logger },
  ) {}

  schedule(slug: string): Promise<void> {
    const { url } = this.options;
    if (!url) return Promise.resolve();
    const existing = this.pending.get(slug);
    if (existing) return existing.done;
    let timer: NodeJS.Timeout | undefined;
    const done = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        this.pending.delete(slug);
        void this.revalidate(url, slug).finally(resolve);
      }, this.options.debounceMs);
    });
    if (timer) this.pending.set(slug, { timer, done });
    return done;
  }

  private async revalidate(url: string, slug: string): Promise<void> {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-revalidate-secret": this.options.secret },
        body: JSON.stringify({ tags: [`status:${slug}`] }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok)
        this.options.logger.warn({ slug, status: response.status }, "status page revalidation rejected");
    } catch (error) {
      this.options.logger.warn({ slug, err: error }, "status page revalidation failed");
    }
  }

  close(): void {
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }
}
