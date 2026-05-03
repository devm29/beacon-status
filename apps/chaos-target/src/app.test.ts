import { pino } from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createChaosApp } from "./app.js";
import { decide } from "./chaos.js";

const logger = pino({ level: "silent" });

describe("chaos target", () => {
  it("serves the storefront with the keyword when healthy", async () => {
    const { app } = createChaosApp({ logger, random: () => 0 });
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Add to cart");
  });

  it("fails only the targeted regions", async () => {
    const { app } = createChaosApp({ logger, random: () => 0 });
    await request(app)
      .put("/admin/state")
      .send({ mode: "errors", regions: ["eu-west"] })
      .expect(200);
    await request(app).get("/health").set("x-beacon-region", "us-east").expect(200);
    await request(app).get("/health").set("x-beacon-region", "eu-west").expect(503);
  });

  it("removes the keyword in content mode", async () => {
    const { app } = createChaosApp({ logger, random: () => 0 });
    await request(app).put("/admin/state").send({ mode: "content" }).expect(200);
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("Add to cart");
  });

  it("protects the admin endpoints with a token when configured", async () => {
    const { app } = createChaosApp({ logger, adminToken: "secret-token" });
    await request(app).put("/admin/state").send({ mode: "down" }).expect(401);
    await request(app)
      .put("/admin/state")
      .set("authorization", "Bearer secret-token")
      .send({ mode: "down" })
      .expect(200);
  });

  it("records webhook deliveries in the sink", async () => {
    const { app } = createChaosApp({ logger });
    await request(app)
      .post("/sink/slack")
      .set("x-beacon-signature", "t=1,v1=abc")
      .send({ text: "hello" })
      .expect(204);
    const res = await request(app).get("/sink?sink=slack");
    expect(res.body.items[0]).toMatchObject({
      sink: "slack",
      body: { text: "hello" },
      headers: { "x-beacon-signature": "t=1,v1=abc" },
    });
  });

  it("drops connections in down mode", () => {
    expect(decide({ mode: "down", latencyMs: 0, errorRate: 1, regions: [] }, "us-east", () => 0.5)).toEqual({
      kind: "drop",
    });
  });
});
