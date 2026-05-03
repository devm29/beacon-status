import { describe, expect, it } from "vitest";
import { formatBurn, formatDuration, formatMs, formatPercent, formatRelative, formatWindow } from "./format";

describe("formatting", () => {
  it("never rounds a partial outage up to 100%", () => {
    expect(formatPercent(0.99999)).toBe("99.99%");
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(0.9994)).toBe("99.94%");
    expect(formatPercent(null)).toBe("–");
  });

  it("chooses a readable latency unit", () => {
    expect(formatMs(87.4)).toBe("87ms");
    expect(formatMs(1234)).toBe("1.23s");
    expect(formatMs(12_500)).toBe("12.5s");
  });

  it("describes durations and relative times", () => {
    expect(formatDuration(26 * 60_000)).toBe("26m");
    expect(formatDuration(2 * 3_600_000 + 10 * 60_000)).toBe("2h 10m");
    expect(formatDuration(3 * 86_400_000)).toBe("3d");
    const now = new Date("2026-05-01T12:00:00Z");
    expect(formatRelative("2026-05-01T11:59:50Z", now)).toBe("just now");
    expect(formatRelative("2026-05-01T11:00:00Z", now)).toBe("1h ago");
    expect(formatRelative("2026-05-04T12:00:00Z", now)).toBe("in 3d");
  });

  it("formats burn rates and windows", () => {
    expect(formatBurn(14.4)).toBe("14.4×");
    expect(formatBurn(6)).toBe("6×");
    expect(formatBurn(23.96)).toBe("24×");
    expect(formatBurn(312.7)).toBe("313×");
    expect(formatBurn(2.345)).toBe("2.3×");
    expect(formatBurn(0.01)).toBe("<0.1×");
    expect(formatWindow(30)).toBe("30m");
    expect(formatWindow(360)).toBe("6h");
  });
});
