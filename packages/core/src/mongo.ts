import mongoose from "mongoose";
import type { Logger } from "./logger.js";
import {
  CHECK_RESULTS_COLLECTION,
  ChannelModel,
  IncidentModel,
  IncidentUpdateModel,
  MaintenanceModel,
  MonitorModel,
  NotificationModel,
  OrgModel,
  RollupModel,
  SloModel,
} from "./models/index.js";

mongoose.set("strictQuery", true);

export async function connectMongo(url: string, logger?: Logger): Promise<typeof mongoose> {
  const connection = await mongoose.connect(url, { serverSelectionTimeoutMS: 10_000, autoIndex: false });
  logger?.info({ db: connection.connection.name }, "connected to mongodb");
  return connection;
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

/**
 * Creates the check_results time-series collection (Mongoose cannot alter one after the fact)
 * and syncs indexes for every model. Safe to call from every service on boot.
 */
export async function ensureCollections(options: { rawRetentionDays: number }): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB is not connected");

  const existing = await db.listCollections({ name: CHECK_RESULTS_COLLECTION }, { nameOnly: true }).toArray();
  const expireAfterSeconds = options.rawRetentionDays * 86_400;
  if (existing.length === 0) {
    try {
      await db.createCollection(CHECK_RESULTS_COLLECTION, {
        timeseries: { timeField: "ts", metaField: "meta", granularity: "seconds" },
        expireAfterSeconds,
      });
    } catch (error) {
      if (!(error instanceof Error && /already exists/i.test(error.message))) throw error;
    }
  } else {
    await db.command({ collMod: CHECK_RESULTS_COLLECTION, expireAfterSeconds });
  }
  await db
    .collection(CHECK_RESULTS_COLLECTION)
    .createIndex({ "meta.monitorId": 1, ts: -1 }, { name: "monitor_ts" });

  await Promise.all(
    [
      OrgModel,
      MonitorModel,
      RollupModel,
      IncidentModel,
      IncidentUpdateModel,
      SloModel,
      ChannelModel,
      NotificationModel,
      MaintenanceModel,
    ].map((m) => m.createIndexes()),
  );
}
