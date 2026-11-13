import { describe, expect, it } from "vitest";
import {
  SESSION_TTL_MS,
  createSessionValue,
  generatePasscode,
  hashPasscode,
  passcodeMatches,
  safeNextPath,
  verifySessionValue,
} from "./session";

const secrets = { encryptionKey: Buffer.alloc(32, 7).toString("base64"), passcode: "harbour-lights" };

const WS = "3b3befce-9809-4d2f-9534-6b6cb37474a5";
const OTHER = "9f79f65e-a7db-479e-bfa8-d8dd25b7d7e3";

describe("session cookie", () => {
  it("verifies a fresh cookie and returns its workspace", () => {
    expect(verifySessionValue(createSessionValue(secrets, WS), secrets)).toBe(WS);
  });

  it("rejects missing, malformed and tampered values", () => {
    const v = createSessionValue(secrets, WS);
    expect(verifySessionValue(undefined, secrets)).toBeNull();
    expect(verifySessionValue("nonsense", secrets)).toBeNull();
    const [ver, ws, exp, sig] = v.split(".");
    expect(verifySessionValue(`${ver}.${ws}.${Number(exp) + 1000}.${sig}`, secrets)).toBeNull();
    expect(verifySessionValue(`${ver}.${ws}.${exp}.${sig.slice(0, -2)}AA`, secrets)).toBeNull();
  });

  it("can't be moved to another workspace", () => {
    const [ver, , exp, sig] = createSessionValue(secrets, WS).split(".");
    expect(verifySessionValue(`${ver}.${OTHER}.${exp}.${sig}`, secrets)).toBeNull();
  });

  it("rejects old v1 cookies and non-uuid workspaces", () => {
    expect(verifySessionValue("v1.9999999999999.abc", secrets)).toBeNull();
    expect(() => createSessionValue(secrets, "not-a-uuid")).toThrow();
  });

  it("expires", () => {
    const now = Date.now();
    const v = createSessionValue(secrets, WS, now);
    expect(verifySessionValue(v, secrets, now + SESSION_TTL_MS + 1)).toBeNull();
  });

  it("is invalidated by an owner passcode change", () => {
    const v = createSessionValue(secrets, WS);
    expect(verifySessionValue(v, { ...secrets, passcode: "new-passcode" })).toBeNull();
  });
});

describe("guest passcodes", () => {
  it("look like byo-XXXXX-XXXXX-XXXXX-XXXXX and don't repeat", () => {
    const codes = new Set(Array.from({ length: 200 }, generatePasscode));
    expect(codes.size).toBe(200);
    for (const c of codes) expect(c).toMatch(/^byo-[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);
  });

  it("hash deterministically, ignoring surrounding spaces", () => {
    expect(hashPasscode(" byo-AAAAA ")).toBe(hashPasscode("byo-AAAAA"));
    expect(hashPasscode("byo-AAAAA")).not.toBe(hashPasscode("byo-AAAAB"));
  });
});

describe("passcode + redirects", () => {
  it("compares passcodes", () => {
    expect(passcodeMatches("harbour-lights", "harbour-lights")).toBe(true);
    expect(passcodeMatches("harbour", "harbour-lights")).toBe(false);
  });

  it("only allows relative next paths", () => {
    expect(safeNextPath("/connectors/1")).toBe("/connectors/1");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
    // Browsers strip tabs/newlines: "/\t/evil.com" would become "//evil.com".
    expect(safeNextPath("/\t/evil.example")).toBe("/");
    expect(safeNextPath("/\n/evil.example")).toBe("/");
    expect(safeNextPath("/apps/1?x=2#y")).toBe("/apps/1?x=2#y");
  });
});
