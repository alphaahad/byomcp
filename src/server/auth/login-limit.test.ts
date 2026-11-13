import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("clientIp", () => {
  it("uses Vercel's real IP, then the first forwarded address", async () => {
    const { clientIp } = await import("./login-limit");
    expect(clientIp(new Headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }))).toBe("203.0.113.7");
    expect(clientIp(new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }))).toBe("198.51.100.1");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
