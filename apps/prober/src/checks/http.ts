import type { HttpCheck, KeywordCheck, StatusMatcher } from "@beacon/shared";
import { applyLatencyBudget, describeError, type ProbeContext, type ProbeOutcome } from "./types.js";

const MAX_BODY_BYTES = 1_000_000;
const MAX_REDIRECTS = 5;
const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function matchesStatus(code: number, matchers: readonly StatusMatcher[]): boolean {
  return matchers.some((m) => (typeof m === "number" ? m === code : Math.floor(code / 100) === Number(m[0])));
}

async function readText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_BODY_BYTES));
}

function evaluateKeyword(check: KeywordCheck, body: string): { found: boolean; error: string | null } {
  const haystack = check.caseSensitive ? body : body.toLowerCase();
  const needle = check.caseSensitive ? check.keyword : check.keyword.toLowerCase();
  const found = haystack.includes(needle);
  if (check.mode === "contains" && !found)
    return { found, error: `Expected keyword "${check.keyword}" was not found` };
  if (check.mode === "absent" && found)
    return { found, error: `Unexpected keyword "${check.keyword}" was found` };
  return { found, error: null };
}

/**
 * Follows redirects by hand so every hop goes through the egress guard; letting fetch follow
 * them would allow a public URL to bounce the probe to a metadata service or an internal port.
 */
async function request(check: HttpCheck | KeywordCheck, ctx: ProbeContext): Promise<Response> {
  const signal = AbortSignal.timeout(ctx.timeoutMs);
  const headers = {
    "user-agent": `BeaconProbe/1.0 (+${ctx.region})`,
    "x-beacon-region": ctx.region,
    ...check.headers,
  };
  let url = new URL(check.url);
  let method: string = check.method;
  let body = check.body !== undefined && METHODS_WITH_BODY.has(method) ? check.body : undefined;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await ctx.egress.checkUrl(url);
    const response = await fetch(url, {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      redirect: "manual",
      signal,
    });
    const location = response.headers.get("location");
    if (!check.followRedirects || !REDIRECT_STATUSES.has(response.status) || !location) return response;

    await response.body?.cancel().catch(() => undefined);
    url = new URL(location, url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`Redirected to an unsupported ${url.protocol} URL`);
    }
    if (response.status === 303 || (response.status <= 302 && method === "POST")) {
      method = "GET";
      body = undefined;
    }
  }
  throw new Error(`Gave up after ${MAX_REDIRECTS} redirects`);
}

export async function runHttpCheck(
  check: HttpCheck | KeywordCheck,
  ctx: ProbeContext,
): Promise<ProbeOutcome> {
  const started = performance.now();
  try {
    const response = await request(check, ctx);

    let keyword: { found: boolean; error: string | null } | null = null;
    if (check.type === "keyword") {
      keyword = evaluateKeyword(check, await readText(response));
    } else {
      await response.body?.cancel().catch(() => undefined);
    }
    const latencyMs = Math.round(performance.now() - started);
    const details = {
      statusCode: response.status,
      ...(keyword ? { keywordFound: keyword.found } : {}),
    };

    if (!matchesStatus(response.status, check.expectedStatus)) {
      return { status: "down", latencyMs, error: `Unexpected HTTP ${response.status}`, details };
    }
    if (keyword?.error) {
      return { status: "down", latencyMs, error: keyword.error, details };
    }
    return applyLatencyBudget({ status: "up", latencyMs, error: null, details }, ctx.degradedLatencyMs);
  } catch (error) {
    return {
      status: "down",
      latencyMs: Math.round(performance.now() - started),
      error: describeError(error, ctx.timeoutMs),
      details: {},
    };
  }
}
