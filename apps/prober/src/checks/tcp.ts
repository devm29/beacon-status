import { createConnection } from "node:net";
import type { TcpCheck } from "@beacon/shared";
import { applyLatencyBudget, describeError, type ProbeContext, type ProbeOutcome } from "./types.js";

export async function runTcpCheck(check: TcpCheck, ctx: ProbeContext): Promise<ProbeOutcome> {
  const started = performance.now();
  let address: string;
  try {
    address = await ctx.egress.resolve(check.host);
  } catch (error) {
    return {
      status: "down",
      latencyMs: Math.round(performance.now() - started),
      error: describeError(error, ctx.timeoutMs),
      details: {},
    };
  }
  return new Promise((resolve) => {
    const socket = createConnection({ host: address, port: check.port });
    const finish = (outcome: ProbeOutcome) => {
      socket.removeAllListeners();
      socket.on("error", () => undefined);
      socket.destroy();
      resolve(outcome);
    };
    socket.setTimeout(ctx.timeoutMs);
    socket.once("connect", () => {
      const latencyMs = Math.round(performance.now() - started);
      finish(
        applyLatencyBudget(
          {
            status: "up",
            latencyMs,
            error: null,
            details: { resolvedAddress: socket.remoteAddress ?? check.host },
          },
          ctx.degradedLatencyMs,
        ),
      );
    });
    socket.once("timeout", () => {
      finish({
        status: "down",
        latencyMs: ctx.timeoutMs,
        error: `Timed out after ${ctx.timeoutMs}ms`,
        details: {},
      });
    });
    socket.once("error", (error) => {
      finish({
        status: "down",
        latencyMs: Math.round(performance.now() - started),
        error: describeError(error, ctx.timeoutMs),
        details: {},
      });
    });
  });
}
