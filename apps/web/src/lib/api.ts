import "server-only";
import { ApiErrorSchema } from "@beacon/shared";
import { cookies } from "next/headers";
import type { z } from "zod";
import { serverEnv } from "./env";

export const API_KEY_COOKIE = "beacon_api_key";
export const SIGNED_OUT_COOKIE = "beacon_signed_out";

export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function currentApiKey(): Promise<string | null> {
  const jar = await cookies();
  const fromCookie = jar.get(API_KEY_COOKIE)?.value;
  if (fromCookie) return fromCookie;
  if (jar.has(SIGNED_OUT_COOKIE)) return null;
  return serverEnv.BEACON_API_KEY ?? null;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  apiKey?: string;
  /** Public pages opt into the Next.js data cache; the operator console always reads live data. */
  cache?: { revalidate: number; tags: string[] };
}

async function send(path: string, options: RequestOptions, auth: boolean): Promise<Response> {
  const headers: Record<string, string> = {};
  if (auth) {
    const key = options.apiKey ?? (await currentApiKey());
    if (!key) throw new ApiError("Sign in with an API key to continue", 401, "unauthorized");
    headers.authorization = `Bearer ${key}`;
  }
  if (options.body !== undefined) headers["content-type"] = "application/json";

  try {
    return await fetch(new URL(path, serverEnv.API_INTERNAL_URL), {
      method: options.method ?? "GET",
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.cache ? { next: options.cache } : { cache: "no-store" as const }),
    });
  } catch {
    throw new ApiError("Beacon's API is not reachable right now", 503, "unreachable");
  }
}

async function decode<T extends z.ZodType>(response: Response, schema: T): Promise<z.infer<T>> {
  const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(payload);
    if (parsed.success) {
      throw new ApiError(
        parsed.data.error.message,
        response.status,
        parsed.data.error.code,
        parsed.data.error.details,
      );
    }
    throw new ApiError(`The API responded with HTTP ${response.status}`, response.status, "http_error");
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new ApiError("The API returned an unexpected response", 502, "bad_response");
  return parsed.data;
}

export async function api<T extends z.ZodType>(
  path: string,
  schema: T,
  options: RequestOptions = {},
): Promise<z.infer<T>> {
  return decode(await send(path, options, true), schema);
}

export async function publicApi<T extends z.ZodType>(
  path: string,
  schema: T,
  options: RequestOptions = {},
): Promise<z.infer<T>> {
  return decode(await send(path, options, false), schema);
}
