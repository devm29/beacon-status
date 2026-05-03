import type { Server as HttpServer } from "node:http";
import type { Logger } from "@beacon/core";
import { Server } from "socket.io";
import { orgRoom } from "./fanout.js";
import { verifyRealtimeToken } from "./token.js";

export function createSocketServer(
  http: HttpServer,
  options: { origins: string[]; secret: string; logger: Logger },
): Server {
  const io = new Server(http, {
    path: "/realtime",
    cors: { origin: options.origins },
    serveClient: false,
  });
  io.use((socket, next) => {
    const raw: unknown = socket.handshake.auth.token;
    const claims = typeof raw === "string" ? verifyRealtimeToken(options.secret, raw) : null;
    if (!claims) {
      next(new Error("unauthorized"));
      return;
    }
    void socket.join(orgRoom(claims.orgId));
    next();
  });
  io.on("connection", (socket) => {
    options.logger.debug({ id: socket.id }, "operator socket connected");
  });
  return io;
}
