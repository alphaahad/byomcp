import { describe, expect, it } from "vitest";
import { AppNameSchema } from "./app-name";

describe("AppNameSchema", () => {
  it("trims and collapses whitespace", () => {
    expect(AppNameSchema.parse("  Zendesk \n  tickets ")).toBe("Zendesk tickets");
  });
  it("rejects empty and whitespace-only names", () => {
    expect(AppNameSchema.safeParse("").success).toBe(false);
    expect(AppNameSchema.safeParse("   ").error?.issues[0]?.message).toBe("Give the app a name.");
  });
  it("rejects names over 60 characters", () => {
    expect(AppNameSchema.safeParse("x".repeat(61)).error?.issues[0]?.message).toBe("Keep the name under 60 characters.");
    expect(AppNameSchema.safeParse("x".repeat(60)).success).toBe(true);
  });
});
