import { describe, expect, it } from "vitest";
import { BlockedTargetError, createEgressGuard, isBlockedAddress } from "./egress.js";

describe("egress guard", () => {
  it("classifies private, link-local and reserved addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.20.0.5",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "0.0.0.0",
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
    for (const address of ["93.184.215.14", "1.1.1.1", "2606:4700:4700::1111"]) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it("refuses names whose records include any private address", async () => {
    const guard = createEgressGuard({
      allowPrivate: false,
      resolver: (host) =>
        Promise.resolve(host === "mixed.test" ? ["93.184.215.14", "10.0.0.1"] : ["93.184.215.14"]),
    });
    await expect(guard.resolve("example.test")).resolves.toBe("93.184.215.14");
    await expect(guard.resolve("mixed.test")).rejects.toBeInstanceOf(BlockedTargetError);
    await expect(guard.checkUrl("http://169.254.169.254/latest")).rejects.toBeInstanceOf(BlockedTargetError);
    await expect(guard.checkUrl("http://[::1]:8080/")).rejects.toBeInstanceOf(BlockedTargetError);
  });

  it("lets self-hosters opt into private targets", async () => {
    const guard = createEgressGuard({ allowPrivate: true });
    await expect(guard.resolve("127.0.0.1")).resolves.toBe("127.0.0.1");
  });
});
