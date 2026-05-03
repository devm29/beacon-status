import { CheckResultModel, MemoryEventPublisher, unrestrictedEgress, type ResultJobData } from "@beacon/core";
import { connectTestDatabase, testLogger } from "@beacon/core/testing";
import { Types } from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleProbe } from "./probe-worker.js";

describe("handleProbe", () => {
  let drop: () => Promise<void>;
  beforeAll(async () => {
    ({ drop } = await connectTestDatabase());
  });
  afterAll(async () => drop());

  it("stores the result, enqueues it for evaluation and publishes a live event", async () => {
    const queued: ResultJobData[] = [];
    const events = new MemoryEventPublisher();
    const monitorId = new Types.ObjectId().toHexString();
    const orgId = new Types.ObjectId().toHexString();

    const message = await handleProbe(
      {
        monitorId,
        orgId,
        check: { type: "tcp", host: "db", port: 5432 },
        timeoutMs: 1000,
        degradedLatencyMs: null,
      },
      {
        region: "ap-southeast",
        simulatedRttMs: 90,
        egress: unrestrictedEgress,
        results: {
          add: (_name: string, data: ResultJobData) => {
            queued.push(data);
            return Promise.resolve({} as never);
          },
        },
        events,
        logger: testLogger(),
        run: () => Promise.resolve({ status: "up", latencyMs: 12, error: null, details: {} }),
      },
    );

    expect(message).toMatchObject({ region: "ap-southeast", status: "up", latencyMs: 102 });
    expect(queued).toHaveLength(1);
    expect(events.published[0]).toMatchObject({ type: "check.result", monitorId, latencyMs: 102 });
    const stored = await CheckResultModel.findOne({ "meta.monitorId": new Types.ObjectId(monitorId) }).lean();
    expect(stored).toMatchObject({ status: "up", latencyMs: 102, meta: { region: "ap-southeast" } });
  });

  it("classifies latency after adding the simulated round trip", async () => {
    const message = await handleProbe(
      {
        monitorId: new Types.ObjectId().toHexString(),
        orgId: new Types.ObjectId().toHexString(),
        check: { type: "tcp", host: "db", port: 5432 },
        timeoutMs: 1000,
        degradedLatencyMs: 100,
      },
      {
        region: "ap-southeast",
        simulatedRttMs: 92,
        egress: unrestrictedEgress,
        results: { add: () => Promise.resolve({} as never) },
        events: new MemoryEventPublisher(),
        logger: testLogger(),
        run: (_job, ctx) => {
          expect(ctx.degradedLatencyMs).toBeNull();
          return Promise.resolve({ status: "up", latencyMs: 40, error: null, details: {} });
        },
      },
    );
    expect(message).toMatchObject({ status: "degraded", latencyMs: 132 });
  });
});
