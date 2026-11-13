import "server-only";
/**
 * Brute-force limits for the passcode sign-in. Failed attempts are counted per
 * client (the IP is stored only as a keyed hash) and across all clients, so a
 * botnet spread over many IPs is slowed down too. Guest passcodes are 100-bit
 * random and can't be guessed anyway; this protects a person-chosen APP_PASSCODE.
 */
import { createHmac } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { loginAttempts } from "@/server/db/schema";
import { env } from "@/server/env";

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILS_PER_CLIENT = 10;
/** Across everyone: past this, every failed try waits longer (the owner can still sign in). */
export const SLOW_DOWN_AFTER_GLOBAL_FAILS = 100;

/** The client's IP as Vercel reports it (it overwrites x-forwarded-for), else "unknown". */
export function clientIp(headers: Headers): string {
  return (headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim().slice(0, 64);
}

function ipHash(ip: string): string {
  return createHmac("sha256", Buffer.from(env().CREDENTIALS_ENCRYPTION_KEY, "base64")).update(`login:${ip}`).digest("base64url");
}

export async function loginBlocked(ip: string): Promise<boolean> {
  const since = new Date(Date.now() - LOGIN_WINDOW_MS);
  const [{ n }] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.ipHash, ipHash(ip)), gt(loginAttempts.createdAt, since)));
  return n >= MAX_FAILS_PER_CLIENT;
}

/** Record a failure; returns how long to make this response wait (ms). */
export async function recordFailedLogin(ip: string): Promise<number> {
  const d = db();
  const since = new Date(Date.now() - LOGIN_WINDOW_MS);
  await d.insert(loginAttempts).values({ ipHash: ipHash(ip) });
  // Housekeeping: keep a day of history at most.
  await d.delete(loginAttempts).where(lt(loginAttempts.createdAt, new Date(Date.now() - 24 * 3600 * 1000)));
  const [{ n }] = await d.select({ n: sql<number>`count(*)::int` }).from(loginAttempts).where(gt(loginAttempts.createdAt, since));
  return n > SLOW_DOWN_AFTER_GLOBAL_FAILS ? 3000 : 600;
}
