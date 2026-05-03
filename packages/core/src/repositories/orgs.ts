import { createHash, randomBytes } from "node:crypto";
import type { StatusPageSpec } from "@beacon/shared";
import type { Types } from "mongoose";
import { OrgModel, type OrgDoc } from "../models/index.js";

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): string {
  return `bk_${randomBytes(24).toString("base64url")}`;
}

export class OrgRepository {
  async findByApiKey(key: string): Promise<OrgDoc | null> {
    return OrgModel.findOne({ "apiKeys.hash": hashApiKey(key) })
      .lean<OrgDoc>()
      .exec();
  }

  async findBySlug(slug: string): Promise<OrgDoc | null> {
    return OrgModel.findOne({ slug }).lean<OrgDoc>().exec();
  }

  async findById(id: Types.ObjectId): Promise<OrgDoc | null> {
    return OrgModel.findById(id).lean<OrgDoc>().exec();
  }

  async create(input: {
    name: string;
    slug: string;
    statusPage: StatusPageSpec;
    apiKey: string;
  }): Promise<OrgDoc> {
    const org = await OrgModel.create({
      name: input.name,
      slug: input.slug,
      statusPage: input.statusPage,
      apiKeys: [
        {
          name: "default",
          prefix: input.apiKey.slice(0, 7),
          hash: hashApiKey(input.apiKey),
          createdAt: new Date(),
        },
      ],
    });
    return org.toObject<OrgDoc>();
  }

  async updateStatusPage(id: Types.ObjectId, statusPage: StatusPageSpec): Promise<void> {
    await OrgModel.updateOne({ _id: id }, { $set: { statusPage } }).exec();
  }
}
