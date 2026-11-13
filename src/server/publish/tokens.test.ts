import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.APP_PASSCODE = "test-passcode-123";
  process.env.DATABASE_URL = "https://example.invalid/db";
});

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("endpoint tokens", () => {
  it("are long, random, prefixed, and stored only as a hash", async () => {
    const { newToken, hashToken } = await import("./tokens");
    const t1 = newToken();
    const t2 = newToken();
    expect(t1).toMatch(/^byo_[A-Za-z0-9_-]{43}$/);
    expect(t1).not.toBe(t2);
    expect(hashToken(t1)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t1)).not.toContain(t1.slice(4, 12));
  });
});

describe("console tokens", () => {
  it("work only for their connector and expire", async () => {
    const { mintConsoleToken, verifyEndpointToken } = await import("./tokens");
    const token = mintConsoleToken(A);
    expect(await verifyEndpointToken(A, token)).toEqual({ ok: true, kind: "console" });
    expect(await verifyEndpointToken(B, token)).toEqual({ ok: false });
    const old = mintConsoleToken(A, Date.now() - 11 * 60 * 1000);
    expect(await verifyEndpointToken(A, old)).toEqual({ ok: false });
    const forged = token.slice(0, -4) + "AAAA";
    expect(await verifyEndpointToken(A, forged)).toEqual({ ok: false });
  });

  it("are invalidated by a passcode change", async () => {
    const { mintConsoleToken, verifyEndpointToken } = await import("./tokens");
    const { env } = await import("@/server/env");
    const token = mintConsoleToken(A);
    const before = env().APP_PASSCODE;
    (env() as { APP_PASSCODE: string }).APP_PASSCODE = "a-different-passcode";
    expect(await verifyEndpointToken(A, token)).toEqual({ ok: false });
    (env() as { APP_PASSCODE: string }).APP_PASSCODE = before;
  });

  it("rejects junk without touching the database", async () => {
    const { verifyEndpointToken } = await import("./tokens");
    expect(await verifyEndpointToken(A, undefined)).toEqual({ ok: false });
    expect(await verifyEndpointToken(A, "Bearer nope")).toEqual({ ok: false });
    expect(await verifyEndpointToken(A, "x".repeat(600))).toEqual({ ok: false });
  });
});
