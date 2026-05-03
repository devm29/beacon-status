import type { OrgDoc, OrgRepository } from "@beacon/core";
import type { Request, RequestHandler } from "express";
import { AppError } from "./errors.js";

const orgs = new WeakMap<Request, OrgDoc>();
const CACHE_TTL_MS = 30_000;

/** Resolves `Authorization: Bearer <api key>` to an organization, with a short in-process cache. */
export function apiKeyAuth(repo: OrgRepository): RequestHandler {
  const cache = new Map<string, { org: OrgDoc; expires: number }>();
  return async (req, _res, next) => {
    const header = req.get("authorization") ?? "";
    const [scheme, key] = header.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !key) {
      throw new AppError(401, "unauthorized", "Send an API key as `Authorization: Bearer <key>`");
    }
    const cached = cache.get(key);
    let org = cached && cached.expires > Date.now() ? cached.org : null;
    if (!org) {
      org = await repo.findByApiKey(key);
      if (!org) throw new AppError(401, "unauthorized", "The API key is not valid");
      cache.set(key, { org, expires: Date.now() + CACHE_TTL_MS });
    }
    orgs.set(req, org);
    next();
  };
}

export function orgOf(req: Request): OrgDoc {
  const org = orgs.get(req);
  if (!org) throw new AppError(401, "unauthorized", "Authentication required");
  return org;
}
