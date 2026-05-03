import { toObjectId } from "@beacon/core";
import type { Types } from "mongoose";
import type { z } from "zod";
import { notFound } from "./errors.js";

export function idParam(value: string | string[] | undefined, what: string): Types.ObjectId {
  const id = typeof value === "string" ? toObjectId(value) : null;
  if (!id) throw notFound(what);
  return id;
}

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  return schema.parse(input);
}

export function encodeCursor(date: Date, id: Types.ObjectId): string {
  return Buffer.from(`${date.toISOString()}|${id.toHexString()}`).toString("base64url");
}

export interface Cursor {
  date: Date;
  id: Types.ObjectId;
}

export function decodeCursor(cursor: string | undefined): Cursor | null {
  if (!cursor) return null;
  const [iso, raw] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const date = new Date(iso ?? "");
  const id = raw ? toObjectId(raw) : null;
  if (Number.isNaN(date.getTime()) || !id) return null;
  return { date, id };
}
