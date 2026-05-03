import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  transpilePackages: ["@beacon/shared"],
  // Linting runs once for the whole monorepo (pnpm lint), not again inside next build.
  eslint: { ignoreDuringBuilds: true },
};

export default config;
