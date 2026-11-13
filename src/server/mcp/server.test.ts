import { describe, expect, it } from "vitest";
import { approvalSummary } from "@/server/runtime/tool-call";
import { toolDescription } from "./server";

const base = {
  id: "a",
  versionId: "v",
  key: "create_ticket",
  title: "Create a ticket",
  description: "Opens a new support ticket.",
  method: "POST" as const,
  path: "/tickets",
  params: { path: { type: "object" as const, properties: {} }, query: { type: "object" as const, properties: {} }, headers: { type: "object" as const, properties: {} } },
  successCheck: null,
};

describe("tool descriptions tell the model how the tool behaves", () => {
  it("marks approval and read-only behaviour", () => {
    expect(toolDescription({ ...base, risk: "write", requiresApproval: true })).toMatch(/approve each call/);
    expect(toolDescription({ ...base, risk: "destructive", requiresApproval: true })).toMatch(/^Opens a new support ticket\. Destructive/);
    expect(toolDescription({ ...base, risk: "read", requiresApproval: false })).toMatch(/Read-only\.$/);
  });
});

describe("approval summaries", () => {
  it("say what will happen in plain language, without secrets", () => {
    const s = approvalSummary("Helpdesk", "Create a ticket", { subject: "Printer broken", priority: 2, api_key: "sk_live_x", nested: { a: 1 } });
    expect(s).toBe("Create a ticket in Helpdesk with subject “Printer broken”, priority “2”, api key “[hidden]”");
    expect(s).not.toContain("sk_live_x");
  });
});
