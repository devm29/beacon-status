import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { pino } from "pino";
import type { Logger } from "../logger.js";
import { ensureCollections } from "../mongo.js";

export const TEST_MONGO_URL = process.env.TEST_MONGO_URL ?? "mongodb://127.0.0.1:27111";
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6411/15";

export function testLogger(): Logger {
  return pino({ level: process.env.TEST_LOG_LEVEL ?? "silent" });
}

/** Connects to a throwaway database so test files can run in parallel without sharing state. */
export async function connectTestDatabase(): Promise<{ name: string; drop: () => Promise<void> }> {
  const name = `beacon_test_${randomBytes(4).toString("hex")}`;
  await mongoose.connect(`${TEST_MONGO_URL}/${name}`, { serverSelectionTimeoutMS: 5_000, autoIndex: false });
  await ensureCollections({ rawRetentionDays: 7 });
  return {
    name,
    drop: async () => {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    },
  };
}

export function uniquePrefix(): string {
  return `test:${randomBytes(4).toString("hex")}`;
}
