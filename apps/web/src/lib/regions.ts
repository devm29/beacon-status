import type { RegionStatusDto } from "@beacon/shared";

/** Whichever of the server snapshot and the live feed saw a region last wins. */
export function mergeRegions(
  server: RegionStatusDto[],
  live: RegionStatusDto[] | undefined,
): RegionStatusDto[] {
  if (!live) return server;
  const newest = new Map(server.map((r) => [r.region, r]));
  for (const entry of live) {
    const known = newest.get(entry.region);
    if (!known || Date.parse(entry.at) > Date.parse(known.at)) newest.set(entry.region, entry);
  }
  return [...newest.values()];
}
