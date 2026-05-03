import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const PayloadSchema = z.object({ orgId: z.string(), exp: z.number() });
export type RealtimeClaims = z.infer<typeof PayloadSchema>;

const sign = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("base64url");

/** Short-lived, HMAC-signed token so browsers can open a socket without ever seeing an API key. */
export function issueRealtimeToken(
  secret: string,
  orgId: string,
  ttlSeconds = 3600,
  now = Date.now(),
): { token: string; expiresAt: Date } {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const body = Buffer.from(JSON.stringify({ orgId, exp })).toString("base64url");
  return { token: `${body}.${sign(secret, body)}`, expiresAt: new Date(exp * 1000) };
}

export function verifyRealtimeToken(secret: string, token: string, now = Date.now()): RealtimeClaims | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = Buffer.from(sign(secret, body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const claims = PayloadSchema.parse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    return claims.exp * 1000 > now ? claims : null;
  } catch {
    return null;
  }
}
