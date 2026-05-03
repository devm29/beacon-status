import { access, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import { stringify } from "yaml";
import { ApiRequestError, BeaconClient } from "./client.js";
import { ConfigFileError, loadConfigFile } from "./config-file.js";
import { paletteFor, renderMonitors, renderPlan, type Palette } from "./render.js";
import { STARTER_CONFIG } from "./starter.js";

export interface OutStream {
  write(chunk: string): boolean;
  isTTY?: boolean | undefined;
}

export interface Io {
  stdout: OutStream;
  stderr: OutStream;
  stdin: NodeJS.ReadableStream & { isTTY?: boolean | undefined };
  env: NodeJS.ProcessEnv;
}

interface GlobalOptions {
  apiUrl: string;
  apiKey?: string;
}

/** Exit codes follow `terraform plan -detailed-exitcode`: 2 means the plan has changes. */
export const EXIT = { ok: 0, error: 1, changes: 2 } as const;

export class CliExit extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

export function buildProgram(io: Io): Command {
  const out = (text: string) => io.stdout.write(`${text}\n`);
  const err = (text: string) => io.stderr.write(`${text}\n`);
  const color: Palette = paletteFor(io.stdout, io.env);
  const errColor: Palette = paletteFor(io.stderr, io.env);

  const program = new Command()
    .name("beacon")
    .description("Manage Beacon monitors, SLOs and alert channels as code")
    .option(
      "--api-url <url>",
      "Beacon API base URL (env: BEACON_API_URL)",
      io.env.BEACON_API_URL ?? "http://localhost:8111",
    )
    .option("--api-key <key>", "API key for your organization (env: BEACON_API_KEY)")
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({ writeOut: (s) => io.stdout.write(s), writeErr: (s) => io.stderr.write(s) });

  const client = (): BeaconClient => {
    const { apiUrl, apiKey: flagKey } = program.opts<GlobalOptions>();
    const apiKey = flagKey ?? io.env.BEACON_API_KEY;
    if (!apiKey) {
      err(errColor.red("Missing API key. Pass --api-key or set BEACON_API_KEY."));
      throw new CliExit(EXIT.error);
    }
    return new BeaconClient({ baseUrl: apiUrl, apiKey });
  };

  const confirm = async (question: string): Promise<boolean> => {
    if (!io.stdin.isTTY) {
      err(errColor.red("Refusing to apply without a terminal to confirm. Pass --auto-approve in CI."));
      return false;
    }
    io.stdout.write(question);
    const rl = createInterface({ input: io.stdin });
    try {
      return (await rl.question("")).trim().toLowerCase() === "yes";
    } finally {
      rl.close();
    }
  };

  program
    .command("init")
    .description("Write a starter beacon.yaml")
    .option("-f, --file <path>", "where to write the file", "beacon.yaml")
    .option("--force", "overwrite an existing file", false)
    .action(async (opts: { file: string; force: boolean }) => {
      const exists = await access(opts.file).then(
        () => true,
        () => false,
      );
      if (exists && !opts.force) {
        err(errColor.red(`${opts.file} already exists. Use --force to overwrite it.`));
        throw new CliExit(EXIT.error);
      }
      await writeFile(opts.file, STARTER_CONFIG, "utf8");
      out(`Created ${opts.file}. Edit it, then run ${color.bold("beacon plan")}.`);
    });

  program
    .command("validate")
    .description("Check beacon.yaml locally without contacting the API")
    .option("-f, --file <path>", "configuration file", "beacon.yaml")
    .action(async (opts: { file: string }) => {
      const config = await loadConfigFile(opts.file, io.env);
      out(
        color.green(
          `${opts.file} is valid: ${config.monitors.length} monitors, ${config.slos.length} SLOs, ${config.channels.length} channels.`,
        ),
      );
    });

  program
    .command("plan")
    .description("Show what apply would change")
    .option("-f, --file <path>", "configuration file", "beacon.yaml")
    .option("--prune", "delete config-managed resources that are no longer in the file", false)
    .option("--json", "print the plan as JSON", false)
    .option(
      "--detailed-exitcode",
      "exit with 2 when there are changes (useful for drift detection in CI)",
      false,
    )
    .action(async (opts: { file: string; prune: boolean; json: boolean; detailedExitcode: boolean }) => {
      const config = await loadConfigFile(opts.file, io.env);
      const result = await client().plan(config, opts.prune);
      out(opts.json ? JSON.stringify(result, null, 2) : renderPlan(result.plan, color));
      const { create, update, delete: remove } = result.plan.summary;
      if (opts.detailedExitcode && create + update + remove > 0) throw new CliExit(EXIT.changes);
    });

  program
    .command("apply")
    .description("Apply beacon.yaml to your organization")
    .option("-f, --file <path>", "configuration file", "beacon.yaml")
    .option("--prune", "delete config-managed resources that are no longer in the file", false)
    .option("-y, --auto-approve", "skip the confirmation prompt", false)
    .action(async (opts: { file: string; prune: boolean; autoApprove: boolean }) => {
      const config = await loadConfigFile(opts.file, io.env);
      const api = client();
      const { plan, planHash } = await api.plan(config, opts.prune);
      out(renderPlan(plan, color));
      const { create, update, delete: remove } = plan.summary;
      if (create + update + remove === 0) return;

      out("");
      if (
        !opts.autoApprove &&
        !(await confirm(`Apply these changes? Only ${color.bold("yes")} will be accepted: `))
      ) {
        out("Apply cancelled.");
        throw new CliExit(EXIT.error);
      }
      await api.apply(config, opts.prune, planHash);
      out(color.green(`Apply complete. ${create} created, ${update} updated, ${remove} deleted.`));
    });

  program
    .command("export")
    .description("Print your organization's current resources as beacon.yaml")
    .option("-o, --output <path>", "write to a file instead of stdout")
    .action(async (opts: { output?: string }) => {
      const yaml = stringify(await client().export(), { lineWidth: 0 });
      const placeholders = [...new Set(yaml.match(/\$\{CHANNEL_[A-Z0-9_]+\}/g) ?? [])];
      const hint =
        placeholders.length > 0
          ? `Channel credentials were exported as placeholders. Set ${placeholders.join(", ")} before applying.`
          : null;
      if (opts.output) {
        await writeFile(opts.output, yaml, "utf8");
        out(`Wrote ${opts.output}.${hint ? ` ${hint}` : ""}`);
      } else {
        io.stdout.write(yaml);
        if (hint) err(errColor.yellow(hint));
      }
    });

  program
    .command("status")
    .description("Show the live status of every monitor")
    .action(async () => {
      const api = client();
      const [me, monitors] = await Promise.all([api.me(), api.monitors()]);
      out(color.bold(`${me.name} (${me.slug})`));
      out(renderMonitors(monitors, color));
    });

  return program;
}

export async function run(argv: string[], io: Io): Promise<number> {
  const program = buildProgram(io);
  const palette = paletteFor(io.stderr, io.env);
  try {
    await program.parseAsync(argv);
    return EXIT.ok;
  } catch (error) {
    if (error instanceof CliExit) return error.code;
    if (error instanceof ConfigFileError || error instanceof ApiRequestError) {
      io.stderr.write(`${palette.red(`Error: ${error.message}`)}\n`);
      for (const problem of error instanceof ConfigFileError ? error.problems : error.details) {
        io.stderr.write(`  - ${problem}\n`);
      }
      return EXIT.error;
    }
    if (error instanceof Error && "exitCode" in error && typeof error.exitCode === "number")
      return error.exitCode;
    throw error;
  }
}
