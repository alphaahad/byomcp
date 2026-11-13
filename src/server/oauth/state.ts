/**
 * OAuth helpers that don't touch the network (tested):
 * - a signed, expiring `state` bound to the workspace and the app, so a
 *   callback can't be replayed into someone else's workspace or app;
 * - PKCE verifier/challenge (S256);
 * - when to refresh an access token.
 */
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

export const STATE_TTL_MS = 10 * 60 * 1000;
/** Refresh this long before the access token expires. */
export const REFRESH_EARLY_MS = 2 * 60 * 1000;

export type OAuthState = { workspaceId: string; connectorId: string; nonce: string; exp: number };

function stateKey(encryptionKeyB64: string): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(encryptionKeyB64, "base64"), Buffer.alloc(0), "byomcp-oauth-state-v1", 32));
}

export function signState(s: OAuthState, encryptionKeyB64: string): string {
  const payload = Buffer.from(JSON.stringify(s)).toString("base64url");
  const sig = createHmac("sha256", stateKey(encryptionKeyB64)).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/** The state, if the signature is valid and it hasn't expired; null otherwise. */
export function verifyState(value: string | null | undefined, encryptionKeyB64: string, now = Date.now()): OAuthState | null {
  if (!value) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", stateKey(encryptionKeyB64)).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
    if (typeof s.exp !== "number" || s.exp <= now) return null;
    if (typeof s.workspaceId !== "string" || typeof s.connectorId !== "string" || typeof s.nonce !== "string") return null;
    return s;
  } catch {
    return null;
  }
}

export function newPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url"); // 64 chars, within 43–128
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export const newNonce = () => randomBytes(16).toString("base64url");

/** True if the access token is missing an expiry-safe margin (or already expired). */
export function needsRefresh(expiresAt: number | null, now = Date.now()): boolean {
  return expiresAt !== null && expiresAt - now <= REFRESH_EARLY_MS;
}
