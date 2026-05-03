import type { RegionStatusDto } from "@beacon/shared";
import { describe, expect, it } from "vitest";
import { mergeRegions } from "./regions";

const region = (overrides: Partial<RegionStatusDto>): RegionStatusDto => ({
  region: "us-east",
  status: "up",
  latencyMs: 40,
  error: null,
  at: "2026-06-01T12:00:00.000Z",
  stale: false,
  ...overrides,
});

describe("mergeRegions", () => {
  it("prefers a live result newer than the server snapshot", () => {
    const merged = mergeRegions([region({})], [region({ status: "down", at: "2026-06-01T12:00:30.000Z" })]);
    expect(merged).toEqual([expect.objectContaining({ status: "down" })]);
  });

  it("lets a refreshed server snapshot replace older live data", () => {
    const merged = mergeRegions(
      [region({ status: "up", stale: true, at: "2026-06-01T12:05:00.000Z" })],
      [region({ status: "down", at: "2026-06-01T12:00:30.000Z" })],
    );
    expect(merged).toEqual([expect.objectContaining({ status: "up", stale: true })]);
  });

  it("adds regions the server has not reported yet", () => {
    const merged = mergeRegions([region({})], [region({ region: "eu-west" })]);
    expect(merged.map((r) => r.region)).toEqual(["us-east", "eu-west"]);
  });
});
