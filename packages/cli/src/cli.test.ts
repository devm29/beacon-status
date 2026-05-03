import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { PlanResponse } from "@beacon/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConfigFileError, interpolateEnv, parseConfig } from "./config-file.js";
import { EXIT, run, type Io } from "./program.js";
import { PLAIN, renderPlan } from "./render.js";
import { STARTER_CONFIG } from "./starter.js";

const VALID = `
version: 1
monitors:
  - key: api
    name: API
    check: { type: http, url: "https://api.example.com/health" }
slos:
  - key: api-slo
    name: API availability
    monitor: api
    target: 99.9
channels:
  - key: hook
    name: Hook
    target: { type: webhook, url: "\${HOOK_URL}" }
`;

describe("config file parsing", () => {
  it("applies schema defaults and expands environment variables", () => {
    const config = parseConfig(VALID, { HOOK_URL: "https://hooks.example.com/beacon" });
    expect(config.monitors[0]?.intervalSeconds).toBe(60);
    expect(config.monitors[0]?.regions).toEqual(["us-east", "eu-west", "ap-southeast"]);
    expect(config.channels[0]?.target).toMatchObject({
      type: "webhook",
      url: "https://hooks.example.com/beacon",
    });
  });

  it("reports every missing variable with its location", () => {
    expect(() => parseConfig(VALID, {})).toThrowError(ConfigFileError);
    try {
      parseConfig(VALID, {});
    } catch (error) {
      expect(error instanceof ConfigFileError && error.problems).toEqual([
        "channels.0.target.url: environment variable HOOK_URL is not set",
      ]);
    }
  });

  it("uses fallbacks and never re-parses substituted text as YAML", () => {
    const value = interpolateEnv({ a: "${X:-fallback}", b: ["${Y}"] }, { Y: "x: [1, 2]" });
    expect(value).toEqual({ a: "fallback", b: ["x: [1, 2]"] });
  });

  it("points at the exact field when validation fails", () => {
    const broken = VALID.replace("target: 99.9", "target: 120").replace("monitor: api", "monitor: missing");
    try {
      parseConfig(broken, { HOOK_URL: "https://hooks.example.com/x" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigFileError);
      const problems = error instanceof ConfigFileError ? error.problems.join("\n") : "";
      expect(problems).toContain("slos.0.target");
    }
  });

  it("ships a starter file that validates", () => {
    expect(() => parseConfig(STARTER_CONFIG, {})).not.toThrow();
  });
});

describe("plan rendering", () => {
  it("summarises creates, updates and deletes", () => {
    const plan: PlanResponse["plan"] = {
      changes: [
        { kind: "monitor", key: "api", action: "create", changes: [] },
        {
          kind: "monitor",
          key: "web",
          action: "update",
          changes: [{ path: "intervalSeconds", before: 60, after: 30 }],
        },
        { kind: "channel", key: "old", action: "delete", changes: [] },
        { kind: "slo", key: "same", action: "noop", changes: [] },
      ],
      summary: { create: 1, update: 1, delete: 1 },
    };
    const text = renderPlan(plan, PLAIN);
    expect(text).toContain("+ monitor api");
    expect(text).toContain("~ monitor web");
    expect(text).toContain("intervalSeconds: 60 -> 30");
    expect(text).toContain("- channel old");
    expect(text).toContain("Plan: 1 to create, 1 to update, 1 to delete (1 unchanged)");
  });

  it("says so when nothing changes", () => {
    expect(renderPlan({ changes: [], summary: { create: 0, update: 0, delete: 0 } }, PLAIN)).toMatch(
      /No changes/,
    );
  });
});

describe("beacon CLI against an API", () => {
  let server: Server;
  let baseUrl: string;
  let dir: string;
  let requests: { path: string; body: unknown; auth: string | undefined }[];
  let planResponse: PlanResponse;

  const readBody = async (req: IncomingMessage): Promise<unknown> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "beacon-cli-"));
    server = createServer((req, res) => {
      void readBody(req).then((body) => {
        requests.push({ path: req.url ?? "", body, auth: req.headers.authorization });
        res.setHeader("content-type", "application/json");
        if (req.headers.authorization !== "Bearer bk_test_key_1234567890") {
          res.statusCode = 401;
          res.end(JSON.stringify({ error: { code: "unauthorized", message: "The API key is not valid" } }));
          return;
        }
        if (req.url === "/v1/config/export") {
          res.end(JSON.stringify({ version: 1, monitors: [] }));
          return;
        }
        res.end(JSON.stringify(planResponse));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    requests = [];
    planResponse = {
      plan: {
        changes: [{ kind: "monitor", key: "api", action: "create", changes: [] }],
        summary: { create: 1, update: 0, delete: 0 },
      },
      planHash: "a".repeat(64),
    };
  });

  const invoke = async (args: string[], env: NodeJS.ProcessEnv = {}) => {
    let stdout = "";
    let stderr = "";
    const io: Io = {
      stdout: { write: (chunk: string) => ((stdout += chunk), true) },
      stderr: { write: (chunk: string) => ((stderr += chunk), true) },
      stdin: Readable.from([]),
      env: {
        NO_COLOR: "1",
        BEACON_API_URL: baseUrl,
        BEACON_API_KEY: "bk_test_key_1234567890",
        HOOK_URL: "https://h.example.com",
        ...env,
      },
    };
    const code = await run(["node", "beacon", ...args], io);
    return { code, stdout, stderr };
  };

  it("plans and signals pending changes with exit code 2", async () => {
    const file = join(dir, "beacon.yaml");
    await writeFile(file, VALID);
    const result = await invoke(["plan", "-f", file, "--detailed-exitcode"]);
    expect(result.code).toBe(EXIT.changes);
    expect(result.stdout).toContain("+ monitor api");
    expect(requests[0]?.path).toBe("/v1/config/plan");
  });

  it("applies with the plan hash it showed the user", async () => {
    const file = join(dir, "beacon.yaml");
    await writeFile(file, VALID);
    const result = await invoke(["apply", "-f", file, "--auto-approve", "--prune"]);
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toContain("Apply complete. 1 created");
    expect(requests.map((r) => r.path)).toEqual(["/v1/config/plan", "/v1/config/apply"]);
    expect(requests[1]?.body).toMatchObject({ prune: true, planHash: "a".repeat(64) });
  });

  it("refuses to apply without a terminal or --auto-approve", async () => {
    const file = join(dir, "beacon.yaml");
    await writeFile(file, VALID);
    const result = await invoke(["apply", "-f", file]);
    expect(result.code).toBe(EXIT.error);
    expect(requests.map((r) => r.path)).toEqual(["/v1/config/plan"]);
  });

  it("surfaces API errors without a stack trace", async () => {
    const file = join(dir, "beacon.yaml");
    await writeFile(file, VALID);
    const result = await invoke(["plan", "-f", file], { BEACON_API_KEY: "bk_wrong_key_123456" });
    expect(result.code).toBe(EXIT.error);
    expect(result.stderr).toContain("The API key is not valid");
  });

  it("validates offline and exports YAML", async () => {
    const file = join(dir, "beacon.yaml");
    await writeFile(file, VALID);
    expect((await invoke(["validate", "-f", file])).stdout).toContain("1 monitors, 1 SLOs, 1 channels");

    const output = join(dir, "exported.yaml");
    await invoke(["export", "-o", output]);
    expect(await readFile(output, "utf8")).toContain("version: 1");
  });

  it("writes a starter file once", async () => {
    const file = join(dir, "starter.yaml");
    expect((await invoke(["init", "-f", file])).code).toBe(EXIT.ok);
    expect((await invoke(["init", "-f", file])).code).toBe(EXIT.error);
  });
});
