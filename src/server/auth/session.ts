/**
 * Passcode-gate session cookie. Stateless and signed, and names the workspace:
 *   value = "v2.<workspaceId>.<expiresAtMs>.<base64url HMAC-SHA256>"
 * A revoked workspace is refused by the server (guard.ts checks the database);
 * the cookie alone only proves which workspace signed in, and when.
 * The HMAC key is derived (HKDF) from CREDENTIALS_ENCRYPTION_KEY with the
 * passcode mixed into the salt, so changing APP_PASSCODE signs everyone out.
 *
 * Pure functions (no next/headers) so the proxy, server actions and tests
 * can all use them.
 */
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "byomcp_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SessionSecrets = { encryptionKey: string; passcode: string };

function signingKey({ encryptionKey, passcode }: SessionSecrets): Buffer {
  const salt = createHash("sha256").update(`passcode:${passcode}`).digest();
  return Buffer.from(hkdfSync("sha256", Buffer.from(encryptionKey, "base64"), salt, "byomcp-session-v1", 32));
}

function mac(payload: string, secrets: SessionSecrets): Buffer {
  return createHmac("sha256", signingKey(secrets)).update(payload).digest();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createSessionValue(secrets: SessionSecrets, workspaceId: string, now = Date.now()): string {
  if (!UUID.test(workspaceId)) throw new Error("Invalid workspace id");
  const payload = `v2.${workspaceId}.${now + SESSION_TTL_MS}`;
  return `${payload}.${mac(payload, secrets).toString("base64url")}`;
}

/** The signed-in workspace id, or null if the cookie is missing, tampered with or expired. */
export function verifySessionValue(value: string | undefined, secrets: SessionSecrets, now = Date.now()): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v2" || !UUID.test(parts[1])) return null;
  const expiresAt = Number(parts[2]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return null;
  const given = Buffer.from(parts[3], "base64url");
  const expected = mac(`${parts[0]}.${parts[1]}.${parts[2]}`, secrets);
  return given.length === expected.length && timingSafeEqual(given, expected) ? parts[1] : null;
}

/** Guest passcodes are stored only as this hash. */
export function hashPasscode(passcode: string): string {
  return createHash("sha256").update(`byomcp-workspace:${passcode.trim()}`).digest("hex");
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** "byo-XXXXX-XXXXX-XXXXX-XXXXX": 20 Crockford base32 characters, 100 random bits. */
export function generatePasscode(): string {
  const bytes = randomBytes(20);
  const chars = [...bytes].map((b) => CROCKFORD[b & 31]).join("");
  return `byo-${chars.match(/.{5}/g)!.join("-")}`;
}

/** Constant-time passcode comparison (hash first so lengths always match). */
export function passcodeMatches(attempt: string, passcode: string): boolean {
  const a = createHash("sha256").update(attempt).digest();
  const b = createHash("sha256").update(passcode).digest();
  return timingSafeEqual(a, b);
}

/** Only allow same-site relative redirects after login. */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  // Browsers drop tabs and newlines in URLs ("/<tab>/evil.com" becomes "//evil.com"), so refuse
  // control characters and backslashes, then confirm the path really stays on this site.
  if (/[\x00-\x1f\x7f\\]/.test(next)) return "/";
  const base = "https://byomcp.invalid";
  try {
    const u = new URL(next, base);
    return u.origin === base ? `${u.pathname}${u.search}${u.hash}` : "/";
  } catch {
    return "/";
  }
}
