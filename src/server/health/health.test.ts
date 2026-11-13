import { describe, expect, it } from "vitest";
import { computeHealth } from "./health";

const base = { connected: true, credentialStatus: "active" as const, recentOutcomes: [] as string[] };

describe("computeHealth", () => {
  it("not connected beats everything", () => {
    expect(computeHealth({ ...base, connected: false, credentialStatus: "needs_reconnect" })).toBe("not_connected");
  });

  it("a rejected key means reconnect, even if earlier calls worked", () => {
    expect(computeHealth({ ...base, credentialStatus: "needs_reconnect", recentOutcomes: ["success", "success"] })).toBe("needs_reconnect");
  });

  it("no calls yet", () => {
    expect(computeHealth(base)).toBe("no_calls");
  });

  it("failing when 3 of the last 5 calls failed", () => {
    expect(computeHealth({ ...base, recentOutcomes: ["transient_failed", "success", "request_error", "empty_or_invalid", "success"] })).toBe("failing");
  });

  it("healthy with 2 of the last 5 failing, and only the newest 5 count", () => {
    expect(computeHealth({ ...base, recentOutcomes: ["success", "request_error", "success", "transient_failed", "success"] })).toBe("healthy");
    expect(
      computeHealth({ ...base, recentOutcomes: ["success", "success", "success", "success", "success", "request_error", "request_error", "request_error"] }),
    ).toBe("healthy");
  });

  it("works for apps with no sign-in", () => {
    expect(computeHealth({ connected: true, credentialStatus: null, recentOutcomes: ["success"] })).toBe("healthy");
  });
});
