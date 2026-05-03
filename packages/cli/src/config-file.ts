import { readFile } from "node:fs/promises";
import { BeaconConfigSchema, type BeaconConfig } from "@beacon/shared";
import { parseDocument } from "yaml";
import type { z } from "zod";

export class ConfigFileError extends Error {
  override name = "ConfigFileError";
  constructor(
    message: string,
    readonly problems: string[] = [],
  ) {
    super(message);
  }
}

const PLACEHOLDER = /\$\{([A-Z_][A-Z0-9_]*)(?::-([^}]*))?\}/g;

/**
 * Expands `${NAME}` and `${NAME:-fallback}` inside string values only, after YAML parsing, so a
 * secret containing YAML syntax can never change the structure of the document.
 */
export function interpolateEnv(
  value: unknown,
  env: NodeJS.ProcessEnv,
  path: string[] = [],
  missing: string[] = [],
): unknown {
  if (typeof value === "string") {
    return value.replace(PLACEHOLDER, (_match, name: string, fallback: string | undefined) => {
      const resolved = env[name] ?? fallback;
      if (resolved === undefined) {
        missing.push(`${path.join(".") || "(root)"}: environment variable ${name} is not set`);
        return "";
      }
      return resolved;
    });
  }
  if (Array.isArray(value))
    return value.map((item, index) => interpolateEnv(item, env, [...path, String(index)], missing));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, interpolateEnv(item, env, [...path, key], missing)]),
    );
  }
  return value;
}

export function formatIssues(issues: readonly z.core.$ZodIssue[]): string[] {
  return issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
}

export function parseConfig(source: string, env: NodeJS.ProcessEnv = process.env): BeaconConfig {
  const document = parseDocument(source, { prettyErrors: true });
  if (document.errors.length > 0) {
    throw new ConfigFileError(
      "The file is not valid YAML",
      document.errors.map((e) => e.message.split("\n")[0] ?? e.message),
    );
  }
  const missing: string[] = [];
  const expanded = interpolateEnv(document.toJS(), env, [], missing);
  if (missing.length > 0) throw new ConfigFileError("Some environment variables are missing", missing);

  const parsed = BeaconConfigSchema.safeParse(expanded);
  if (!parsed.success)
    throw new ConfigFileError("The configuration is not valid", formatIssues(parsed.error.issues));
  return parsed.data;
}

export async function loadConfigFile(
  file: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<BeaconConfig> {
  let source: string;
  try {
    source = await readFile(file, "utf8");
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    throw new ConfigFileError(
      code === "ENOENT"
        ? `Could not find ${file}. Run \`beacon init\` to create one.`
        : `Could not read ${file}`,
    );
  }
  return parseConfig(source, env);
}
