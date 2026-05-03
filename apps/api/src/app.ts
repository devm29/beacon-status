import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { ApiContainer } from "./container.js";
import { errorHandler, notFoundHandler } from "./http/errors.js";
import { authFailureLimiter, publicLimiter } from "./http/rate-limit.js";
import { publicRouter } from "./routes/public.js";
import { v1Router } from "./routes/v1.js";

export function createApp(c: ApiContainer): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.set("query parser", "simple");
  app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));

  app.use(
    pinoHttp({
      logger: c.logger,
      autoLogging: { ignore: (req) => req.url === "/healthz" || req.url?.endsWith("/events") === true },
      customLogLevel: (_req, res, error) =>
        error || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "debug",
    }),
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.get("/readyz", async (_req, res) => {
    const checks = await c.readiness();
    const ready = Object.values(checks).every(Boolean);
    res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "degraded", checks });
  });

  app.use(
    "/public",
    cors({ origin: "*", methods: ["GET"] }),
    publicLimiter(c.limits, c.rateLimitStores),
    publicRouter(c),
  );
  app.use(
    "/v1",
    cors({ origin: c.corsOrigins, credentials: false }),
    authFailureLimiter(c.limits, c.rateLimitStores),
    v1Router(c),
  );

  app.use(notFoundHandler);
  app.use(errorHandler(c.logger));
  return app;
}
