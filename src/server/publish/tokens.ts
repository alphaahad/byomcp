import "server-only";
/**
 * MCP endpoint tokens. Random, shown once, stored only as a SHA-256 hash,
 * rotatable (rotation revokes every older token for the connector at once).
 * Plus short-lived console tokens, signed with the session key, so the in-app
 * test console can call the real endpoint without the user pasting their token.
 */
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { endpointTokens } from "@/server/db/schema";
import { env } from "@/server/env";

export const TOKEN_PREFIX = "byo_";
const CONSOLE_PREFIX = "byoc.";
const CONSOLE_TTL_MS = 10 * 60 * 1000;

export const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

export function newToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** Create a token for the connector, revoking any previous ones. Returns the plaintext ONCE. */
export async function rotateToken(connectorId: string): Promise<{ token: string; prefix: string }> {
  const token = newToken();
  const prefix = token.slice(0, TOKEN_PREFIX.length + 6);
  const d = db();
  await d.batch([
    d
      .update(endpointTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(endpointTokens.connectorId, connectorId), isNull(endpointTokens.revokedAt))),
    d.insert(endpointTokens).values({ connectorId, tokenHash: hashToken(token), tokenPrefix: prefix }),
  ]);
  return { token, prefix };
}

export async function activeToken(connectorId: string) {
  const [row] = await db()
    .select({ prefix: endpointTokens.tokenPrefix, createdAt: endpointTokens.createdAt, lastUsedAt: endpointTokens.lastUsedAt })
    .from(endpointTokens)
    .where(and(eq(endpointTokens.connectorId, connectorId), isNull(endpointTokens.revokedAt)))
    .limit(1);
  return row ?? null;
}

/* Console tokens --------------------------------------------------------- */

function consoleKey(): Buffer {
  const e = env();
  const salt = createHash("sha256").update(`passcode:${e.APP_PASSCODE}`).digest();
  return Buffer.from(hkdfSync("sha256", Buffer.from(e.CREDENTIALS_ENCRYPTION_KEY, "base64"), salt, "byomcp-console-v1", 32));
}

export function mintConsoleToken(connectorId: string, now = Date.now()): string {
  const payload = `${connectorId}.${now + CONSOLE_TTL_MS}`;
  const sig = createHmac("sha256", consoleKey()).update(payload).digest("base64url");
  return `${CONSOLE_PREFIX}${payload}.${sig}`;
}

function verifyConsoleToken(token: string, connectorId: string, now = Date.now()): boolean {
  if (!token.startsWith(CONSOLE_PREFIX)) return false;
  const parts = token.slice(CONSOLE_PREFIX.length).split(".");
  if (parts.length !== 3) return false;
  const [id, exp, sig] = parts;
  if (id !== connectorId || !(Number(exp) > now)) return false;
  const expected = createHmac("sha256", consoleKey()).update(`${id}.${exp}`).digest();
  const given = Buffer.from(sig, "base64url");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/* Verification ------------------------------------------------------------- */

export type TokenCheck = { ok: true; kind: "endpoint" | "console" } | { ok: false };

/** Is this token valid for THIS connector? Records last use for endpoint tokens. */
export async function verifyEndpointToken(connectorId: string, token: string | undefined): Promise<TokenCheck> {
  if (!token || token.length > 512) return { ok: false };
  if (token.startsWith(CONSOLE_PREFIX)) return verifyConsoleToken(token, connectorId) ? { ok: true, kind: "console" } : { ok: false };
  if (!token.startsWith(TOKEN_PREFIX)) return { ok: false };
  const d = db();
  const [row] = await d
    .select({ id: endpointTokens.id, connectorId: endpointTokens.connectorId })
    .from(endpointTokens)
    .where(and(eq(endpointTokens.tokenHash, hashToken(token)), isNull(endpointTokens.revokedAt)))
    .limit(1);
  if (!row || row.connectorId !== connectorId) return { ok: false };
  await d.update(endpointTokens).set({ lastUsedAt: new Date() }).where(eq(endpointTokens.id, row.id));
  return { ok: true, kind: "endpoint" };
}
