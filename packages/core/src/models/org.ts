import type { StatusPageSpec } from "@beacon/shared";
import { Schema, model, type Types } from "mongoose";

export interface ApiKeyRecord {
  name: string;
  prefix: string;
  hash: string;
  createdAt: Date;
}

export interface OrgDoc {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  apiKeys: ApiKeyRecord[];
  statusPage: StatusPageSpec;
  createdAt: Date;
  updatedAt: Date;
}

const apiKeySchema = new Schema<ApiKeyRecord>(
  {
    name: { type: String, required: true },
    prefix: { type: String, required: true },
    hash: { type: String, required: true },
    createdAt: { type: Date, required: true },
  },
  { _id: false },
);

const orgSchema = new Schema<OrgDoc>(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    apiKeys: { type: [apiKeySchema], default: [] },
    statusPage: {
      title: { type: String, required: true },
      description: { type: String, default: "" },
      groups: { type: [String], default: [] },
      supportUrl: { type: String, default: null },
    },
  },
  { timestamps: true, collection: "orgs" },
);
orgSchema.index({ "apiKeys.hash": 1 });

export const OrgModel = model<OrgDoc>("Org", orgSchema);
