import type { EgressGuard } from "@beacon/core";
import type { CheckDetails, CheckStatus, Region } from "@beacon/shared";

export interface ProbeOutcome {
  status: CheckStatus;
  latencyMs: number;
  error: string | null;
  details: CheckDetails;
}

export interface ProbeContext {
  region: Region;
  timeoutMs: number;
  degradedLatencyMs: number | null;
  egress: EgressGuard;
}

export function applyLatencyBudget(outcome: ProbeOutcome, degradedLatencyMs: number | null): ProbeOutcome {
  if (outcome.status !== "up" || degradedLatencyMs === null || outcome.latencyMs <= degradedLatencyMs)
    return outcome;
  return {
    ...outcome,
    status: "degraded",
    error: `Responded in ${outcome.latencyMs}ms, above the ${degradedLatencyMs}ms budget`,
  };
}

const ERROR_CODES: Record<string, string> = {
  BEACON_BLOCKED_TARGET: "Target resolves to a private or reserved address",
  ECONNREFUSED: "Connection refused",
  ECONNRESET: "Connection reset by peer",
  ENOTFOUND: "DNS lookup failed",
  EAI_AGAIN: "DNS lookup timed out",
  EHOSTUNREACH: "Host unreachable",
  ENETUNREACH: "Network unreachable",
  ETIMEDOUT: "Connection timed out",
  EPIPE: "Connection closed unexpectedly",
  UND_ERR_SOCKET: "Connection closed unexpectedly",
  UND_ERR_CONNECT_TIMEOUT: "Connection timed out",
  CERT_HAS_EXPIRED: "TLS certificate has expired",
  DEPTH_ZERO_SELF_SIGNED_CERT: "TLS certificate is self-signed",
  ERR_TLS_CERT_ALTNAME_INVALID: "TLS certificate does not match the hostname",
};

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("cause" in error) return errorCode(error.cause);
  return undefined;
}

/** Turns low-level socket and fetch errors into something an on-call engineer can act on. */
export function describeError(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return `Timed out after ${timeoutMs}ms`;
  }
  const code = errorCode(error);
  if (code && ERROR_CODES[code]) return ERROR_CODES[code];
  if (error instanceof Error) {
    const message =
      error.message === "fetch failed" && error.cause instanceof Error ? error.cause.message : error.message;
    return code ? `${message} (${code})` : message;
  }
  return "Unknown error";
}
