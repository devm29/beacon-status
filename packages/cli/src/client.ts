import {
  ApiErrorSchema,
  MonitorDtoSchema,
  PlanResponseSchema,
  type BeaconConfig,
  type MonitorDto,
  type PlanResponse,
} from "@beacon/shared";
import { z } from "zod";

export class ApiRequestError extends Error {
  override name = "ApiRequestError";
  constructor(
    message: string,
    readonly status: number,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

export interface ClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}

const MeSchema = z.object({ id: z.string(), name: z.string(), slug: z.string() });

function describeDetails(details: unknown): string[] {
  if (!Array.isArray(details)) return [];
  return details.flatMap((d) => {
    const parsed = z.object({ path: z.string(), message: z.string() }).safeParse(d);
    return parsed.success ? [`${parsed.data.path || "(root)"}: ${parsed.data.message}`] : [];
  });
}

/** Thin, response-validating client for the endpoints the CLI needs. */
export class BeaconClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  private async request<T extends z.ZodType>(
    method: string,
    path: string,
    schema: T,
    body?: unknown,
  ): Promise<z.infer<T>> {
    const url = new URL(
      path,
      this.options.baseUrl.endsWith("/") ? this.options.baseUrl : `${this.options.baseUrl}/`,
    );
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.cause instanceof Error ? error.cause.message : String(error);
      throw new ApiRequestError(`Could not reach the Beacon API at ${this.options.baseUrl} (${reason})`, 0);
    }

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = ApiErrorSchema.safeParse(payload);
      const message = parsed.success
        ? parsed.data.error.message
        : `The API responded with HTTP ${response.status}`;
      throw new ApiRequestError(
        message,
        response.status,
        parsed.success ? describeDetails(parsed.data.error.details) : [],
      );
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success)
      throw new ApiRequestError(`Unexpected response from ${method} ${path}`, response.status);
    return parsed.data;
  }

  me() {
    return this.request("GET", "v1/me", MeSchema);
  }

  plan(config: BeaconConfig, prune: boolean): Promise<PlanResponse> {
    return this.request("POST", "v1/config/plan", PlanResponseSchema, { config, prune });
  }

  apply(config: BeaconConfig, prune: boolean, planHash: string): Promise<PlanResponse> {
    return this.request("POST", "v1/config/apply", PlanResponseSchema, { config, prune, planHash });
  }

  export(): Promise<unknown> {
    return this.request("GET", "v1/config/export", z.unknown());
  }

  async monitors(): Promise<MonitorDto[]> {
    const { items } = await this.request(
      "GET",
      "v1/monitors",
      z.object({ items: z.array(MonitorDtoSchema) }),
    );
    return items;
  }
}
