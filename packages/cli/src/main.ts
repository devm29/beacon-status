#!/usr/bin/env node
import { run } from "./program.js";

process.exitCode = await run(process.argv, {
  stdout: process.stdout,
  stderr: process.stderr,
  stdin: process.stdin,
  env: process.env,
});
