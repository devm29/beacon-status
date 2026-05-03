import type { Check } from "@beacon/shared";
import { runHttpCheck } from "./http.js";
import { runSslCheck } from "./ssl.js";
import { runTcpCheck } from "./tcp.js";
import type { ProbeContext, ProbeOutcome } from "./types.js";

export type { ProbeContext, ProbeOutcome } from "./types.js";

export function runCheck(check: Check, ctx: ProbeContext): Promise<ProbeOutcome> {
  switch (check.type) {
    case "http":
    case "keyword":
      return runHttpCheck(check, ctx);
    case "tcp":
      return runTcpCheck(check, ctx);
    case "ssl":
      return runSslCheck(check, ctx);
  }
}
