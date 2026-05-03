import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

const MAPPED_IPV4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;

/** True for loopback, private, link-local (cloud metadata), CGNAT, multicast and reserved ranges. */
export function isBlockedAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "");
  const mapped = MAPPED_IPV4.exec(bare)?.[1];
  if (mapped) return blocked.check(mapped, "ipv4");
  const family = isIP(bare);
  if (family === 4) return blocked.check(bare, "ipv4");
  if (family === 6) return blocked.check(bare, "ipv6");
  return true;
}

export class BlockedTargetError extends Error {
  override name = "BlockedTargetError";
  readonly code = "BEACON_BLOCKED_TARGET";
  constructor(host: string) {
    super(`${host} resolves to a private or reserved address, which Beacon is not allowed to reach`);
  }
}

export interface EgressGuard {
  /**
   * Resolves a host to the address to connect to, refusing private and reserved networks.
   * Connecting to the returned address rather than the name closes the DNS rebinding window.
   */
  resolve(host: string): Promise<string>;
  /** Throws when the URL's host is not allowed; returns the vetted address. */
  checkUrl(url: string | URL): Promise<string>;
}

export type Resolver = (host: string) => Promise<string[]>;

const systemResolver: Resolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);

/**
 * Stops monitors and webhooks from being pointed at the probe's own network (metadata services,
 * MongoDB, Redis). Every address a name resolves to must be public, so a record that mixes a
 * public and a private address is refused too. Self-hosters who monitor internal services set
 * ALLOW_PRIVATE_TARGETS=true.
 */
export function createEgressGuard(options: { allowPrivate: boolean; resolver?: Resolver }): EgressGuard {
  const resolver = options.resolver ?? systemResolver;
  const resolve = async (rawHost: string): Promise<string> => {
    const host = rawHost.replace(/^\[|\]$/g, "");
    if (options.allowPrivate) return host;
    const addresses = isIP(host) ? [host] : await resolver(host);
    const [first] = addresses;
    if (first === undefined || addresses.some(isBlockedAddress)) throw new BlockedTargetError(host);
    return first;
  };
  return {
    resolve,
    checkUrl: (url) => resolve(new URL(url).hostname),
  };
}

export const unrestrictedEgress: EgressGuard = createEgressGuard({ allowPrivate: true });
