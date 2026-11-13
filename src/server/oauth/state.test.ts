import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { STATE_TTL_MS, needsRefresh, newPkce, signState, verifyState } from "./state";

const key = Buffer.alloc(32, 9).toString("base64");
const otherKey = Buffer.alloc(32, 3).toString("base64");
const base = { workspaceId: "w1", connectorId: "c1", nonce: "n1", exp: Date.now() + STATE_TTL_MS };

describe("OAuth state", () => {
  it("round-trips", () => {
    expect(verifyState(signState(base, key), key)).toEqual(base);
  });
  it("rejects tampering, a different key, and garbage", () => {
    const v = signState(base, key);
    const [payload, sig] = v.split(".");
    const forged = Buffer.from(JSON.stringify({ ...base, workspaceId: "w2" })).toString("base64url");
    expect(verifyState(`${forged}.${sig}`, key)).toBeNull();
    expect(verifyState(`${payload}.${sig.slice(0, -2)}AA`, key)).toBeNull();
    expect(verifyState(v, otherKey)).toBeNull();
    expect(verifyState("nope", key)).toBeNull();
    expect(verifyState(null, key)).toBeNull();
  });
  it("expires", () => {
    const v = signState({ ...base, exp: Date.now() - 1 }, key);
    expect(verifyState(v, key)).toBeNull();
  });
});

describe("PKCE and refresh timing", () => {
  it("makes an S256 challenge from the verifier", () => {
    const { verifier, challenge } = newPkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });
  it("refreshes two minutes early, never without an expiry", () => {
    const now = 1_000_000;
    expect(needsRefresh(null, now)).toBe(false);
    expect(needsRefresh(now + 10 * 60_000, now)).toBe(false);
    expect(needsRefresh(now + 60_000, now)).toBe(true);
    expect(needsRefresh(now - 1, now)).toBe(true);
  });
});
