import { InvalidIncidentTransitionError } from "@beacon/shared";
import { IncidentNotFoundError, type Logger } from "@beacon/core";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what: string) => new AppError(404, "not_found", `${what} was not found`);
export const conflict = (message: string, details?: unknown) =>
  new AppError(409, "conflict", message, details);
export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, "bad_request", message, details);

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: "not_found", message: `No route for ${req.method} ${req.path}` } });
};

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, _next) => {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: {
          code: "validation_failed",
          message: "The request did not pass validation",
          details: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      });
      return;
    }
    if (error instanceof AppError) {
      res
        .status(error.status)
        .json({ error: { code: error.code, message: error.message, details: error.details } });
      return;
    }
    if (error instanceof InvalidIncidentTransitionError) {
      res.status(422).json({ error: { code: "invalid_transition", message: error.message } });
      return;
    }
    if (error instanceof IncidentNotFoundError) {
      res.status(404).json({ error: { code: "not_found", message: error.message } });
      return;
    }
    if (isDuplicateKey(error)) {
      res
        .status(409)
        .json({ error: { code: "conflict", message: "A resource with this key already exists" } });
      return;
    }
    if (error instanceof SyntaxError && "body" in error) {
      res.status(400).json({ error: { code: "invalid_json", message: "Request body is not valid JSON" } });
      return;
    }
    logger.error({ err: error, path: req.path }, "unhandled error");
    res.status(500).json({ error: { code: "internal", message: "Something went wrong on our side" } });
  };
}
