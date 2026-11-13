import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openSecret, sealSecret, secretHint, secretValues } from "./credentials";

const key = randomBytes(32).toString("base64");
const otherKey = randomBytes(32).toString("base64");
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("credential encryption", () => {
  it("round-trips every secret kind", () => {
    for (const s of [
      { kind: "api_key", value: "sk_live_abcdef123456" },
      { kind: "bearer", token: "tok_9876543210" },
      { kind: "basic", username: "0f3a9c2b8e7d", password: "x" },
    ] as const) {
      expect(openSecret(sealSecret(s, A, key), A, key)).toEqual(s);
    }
  });

  it("never reuses an IV and never stores plaintext", () => {
    const s = { kind: "api_key", value: "sk_live_abcdef123456" } as const;
    const one = sealSecret(s, A, key);
    const two = sealSecret(s, A, key);
    expect(one.iv).not.toBe(two.iv);
    expect(one.encryptedBlob).not.toBe(two.encryptedBlob);
    expect(Buffer.from(one.encryptedBlob, "base64").toString("utf8")).not.toContain("sk_live");
  });

  it("refuses a ciphertext moved to another connector", () => {
    const sealed = sealSecret({ kind: "bearer", token: "tok_9876543210" }, A, key);
    expect(() => openSecret(sealed, B, key)).toThrow();
  });

  it("refuses a wrong key or tampered data", () => {
    const sealed = sealSecret({ kind: "bearer", token: "tok_9876543210" }, A, key);
    expect(() => openSecret(sealed, A, otherKey)).toThrow();
    const blob = Buffer.from(sealed.encryptedBlob, "base64");
    blob[0] ^= 1;
    expect(() => openSecret({ ...sealed, encryptedBlob: blob.toString("base64") }, A, key)).toThrow();
    const tag = Buffer.from(sealed.authTag, "base64");
    tag[0] ^= 1;
    expect(() => openSecret({ ...sealed, authTag: tag.toString("base64") }, A, key)).toThrow();
  });
});

describe("hints and scrubbing", () => {
  it("shows at most the last four characters", () => {
    expect(secretHint({ kind: "api_key", value: "sk_live_abcdef123456" })).toBe("API key ending 3456");
    expect(secretHint({ kind: "bearer", token: "short" })).toBe("Token saved");
    expect(secretHint({ kind: "basic", username: "0f3a9c2b8e7d1a2b3c4d5e6f7a8b9c0d", password: "x" })).toBe("Username 0f3…9c0d, password saved");
  });

  it("lists every value that must be scrubbed, including the basic-auth header", () => {
    const vals = secretValues({ kind: "basic", username: "user", password: "hunter22" });
    expect(vals).toContain("hunter22");
    expect(vals).toContain(Buffer.from("user:hunter22").toString("base64"));
  });
});
