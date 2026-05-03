import { defineConfig } from "vitest/config";

const conditions = ["@beacon/source", "module", "node", "development|production"];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    environment: "node",
    testTimeout: 20_000,
    hookTimeout: 30_000,
    pool: "forks",
  },
});
