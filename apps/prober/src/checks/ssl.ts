import { isIP } from "node:net";
import { connect } from "node:tls";
import type { CheckStatus, SslCheck } from "@beacon/shared";
import { describeError, type ProbeContext, type ProbeOutcome } from "./types.js";

const DAY_MS = 86_400_000;

export function classifyCertificate(
  daysRemaining: number,
  check: Pick<SslCheck, "warnDays" | "criticalDays">,
): { status: CheckStatus; error: string | null } {
  const days = Math.floor(daysRemaining);
  if (daysRemaining <= 0) return { status: "down", error: "TLS certificate has expired" };
  if (days <= check.criticalDays) return { status: "down", error: `TLS certificate expires in ${days} days` };
  if (days <= check.warnDays) return { status: "degraded", error: `TLS certificate expires in ${days} days` };
  return { status: "up", error: null };
}

export async function runSslCheck(
  check: SslCheck,
  ctx: ProbeContext,
  now: () => Date = () => new Date(),
): Promise<ProbeOutcome> {
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
    const socket = connect({
      host: address,
      port: check.port,
      ...(isIP(check.host) === 0 ? { servername: check.host } : {}),
      rejectUnauthorized: false,
    });
    const finish = (outcome: ProbeOutcome) => {
      socket.removeAllListeners();
      socket.on("error", () => undefined);
      socket.destroy();
      resolve(outcome);
    };
    socket.setTimeout(ctx.timeoutMs);
    socket.once("secureConnect", () => {
      const latencyMs = Math.round(performance.now() - started);
      const certificate = socket.getPeerCertificate();
      if (!certificate.valid_to) {
        finish({ status: "down", latencyMs, error: "Server did not present a certificate", details: {} });
        return;
      }
      const validTo = new Date(certificate.valid_to);
      const daysRemaining = (validTo.getTime() - now().getTime()) / DAY_MS;
      const issuer = certificate.issuer.O ?? certificate.issuer.CN;
      const details = {
        certDaysRemaining: Math.floor(daysRemaining),
        certValidTo: validTo.toISOString(),
        ...(typeof issuer === "string" ? { certIssuer: issuer } : {}),
      };
      if (!socket.authorized) {
        const raw = socket.authorizationError;
        const code = raw instanceof Error ? raw.message : String(raw);
        const reason = describeError({ code }, ctx.timeoutMs);
        finish({ status: "down", latencyMs, error: `Certificate is not trusted: ${reason}`, details });
        return;
      }
      const verdict = classifyCertificate(daysRemaining, check);
      finish({ status: verdict.status, latencyMs, error: verdict.error, details });
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
