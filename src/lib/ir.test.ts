import { describe, expect, it } from "vitest";
import {
  ActionIRSchema,
  classifyRisk,
  dedupeKeys,
  defaultEnabled,
  defaultRequiresApproval,
  toActionKey,
  toolAnnotations,
  type ActionIR,
} from "./ir";

const base: ActionIR = {
  key: "get_ticket",
  title: "Get a ticket",
  description: "Fetch one ticket by its ID.",
  resource: "Tickets",
  method: "GET",
  path: "/api/v2/tickets/{id}",
  params: {
    path: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    query: { type: "object", properties: {} },
    headers: { type: "object", properties: {} },
  },
  risk: "read",
  evidence: "sourced",
  citation: { quote: "GET /api/v2/tickets/[id] View a ticket" },
  confidence: 1,
};

describe("ActionIRSchema", () => {
  it("accepts a valid action", () => {
    expect(ActionIRSchema.safeParse(base).success).toBe(true);
  });

  it("keeps extra JSON Schema keywords", () => {
    const parsed = ActionIRSchema.parse({
      ...base,
      params: { ...base.params, query: { type: "object", properties: {}, additionalProperties: false } },
    });
    expect(parsed.params.query).toHaveProperty("additionalProperties", false);
  });

  it.each([
    ["uppercase", "GetTicket"],
    ["leading digit", "1_ticket"],
    ["hyphen", "get-ticket"],
    ["too long", "a".repeat(65)],
  ])("rejects a key with %s", (_label, key) => {
    expect(ActionIRSchema.safeParse({ ...base, key }).success).toBe(false);
  });

  it("rejects a path placeholder with no matching path param", () => {
    const res = ActionIRSchema.safeParse({
      ...base,
      params: { ...base.params, path: { type: "object", properties: {} } },
    });
    expect(res.success).toBe(false);
  });

  it("rejects risk lower than the method implies", () => {
    expect(ActionIRSchema.safeParse({ ...base, method: "DELETE", risk: "write" }).success).toBe(false);
    expect(ActionIRSchema.safeParse({ ...base, method: "POST", risk: "read" }).success).toBe(false);
  });

  it("allows risk higher than the method implies", () => {
    expect(ActionIRSchema.safeParse({ ...base, method: "POST", risk: "destructive" }).success).toBe(true);
  });

  it("rejects confidence outside 0..1", () => {
    expect(ActionIRSchema.safeParse({ ...base, confidence: 1.2 }).success).toBe(false);
  });
});

describe("classifyRisk", () => {
  it("maps methods", () => {
    expect(classifyRisk({ method: "GET" })).toBe("read");
    expect(classifyRisk({ method: "POST" })).toBe("write");
    expect(classifyRisk({ method: "PATCH" })).toBe("write");
    expect(classifyRisk({ method: "DELETE" })).toBe("destructive");
  });

  it("escalates redaction, merges and erasure", () => {
    expect(classifyRisk({ method: "PUT", title: "Redact Chat Comment", path: "/api/v2/chat_redactions/{ticket_id}" })).toBe("destructive");
    expect(classifyRisk({ method: "POST", title: "Merge Tickets into Target Ticket" })).toBe("destructive");
    expect(classifyRisk({ method: "POST", key: "permanently_delete_user" })).toBe("destructive");
    expect(classifyRisk({ method: "PUT", title: "Anonymize a user" })).toBe("destructive");
    expect(classifyRisk({ method: "POST", title: "Create merged report" })).toBe("write"); // "merged" is not "merge"
  });

  it("escalates writes named like destructive operations", () => {
    expect(classifyRisk({ method: "POST", key: "refund_payment" })).toBe("destructive");
    expect(classifyRisk({ method: "POST", path: "/subscriptions/{id}/cancel" })).toBe("destructive");
    expect(classifyRisk({ method: "PUT", title: "Archive a deal" })).toBe("destructive");
  });

  it("does not escalate reads or partial-word matches", () => {
    expect(classifyRisk({ method: "GET", title: "List archived tickets" })).toBe("read");
    expect(classifyRisk({ method: "POST", key: "create_voidable_note" })).toBe("write");
  });
});

describe("safe defaults", () => {
  it("large APIs start with nothing on", async () => {
    const { initialEnabled, LARGE_SPEC_THRESHOLD } = await import("./ir");
    expect(initialEnabled("read", LARGE_SPEC_THRESHOLD)).toBe(true);
    expect(initialEnabled("read", LARGE_SPEC_THRESHOLD + 1)).toBe(false);
    expect(initialEnabled("write", 5)).toBe(false);
  });

  it("only enables reads by default", () => {
    expect(defaultEnabled("read")).toBe(true);
    expect(defaultEnabled("write")).toBe(false);
    expect(defaultEnabled("destructive")).toBe(false);
  });

  it("requires approval for writes and destructive", () => {
    expect(defaultRequiresApproval("read")).toBe(false);
    expect(defaultRequiresApproval("write")).toBe(true);
    expect(defaultRequiresApproval("destructive")).toBe(true);
  });

  it("maps to MCP annotations", () => {
    expect(toolAnnotations("read")).toEqual({ readOnlyHint: true, destructiveHint: false });
    expect(toolAnnotations("destructive")).toEqual({ readOnlyHint: false, destructiveHint: true });
  });
});

describe("keys", () => {
  it("normalises labels", () => {
    expect(toActionKey("Create a Ticket")).toBe("create_a_ticket");
    expect(toActionKey("tickets.listAll")).toBe("tickets_list_all");
    expect(toActionKey("2fa status")).toBe("a_2fa_status");
    expect(toActionKey("!!!")).toBe("action");
    expect(toActionKey("x".repeat(100))).toHaveLength(64);
  });

  it("dedupes within a connector", () => {
    expect(dedupeKeys(["list", "list", "list"])).toEqual(["list", "list_2", "list_3"]);
    const long = "a".repeat(64);
    const [, second] = dedupeKeys([long, long]);
    expect(second).toHaveLength(64);
    expect(second.endsWith("_2")).toBe(true);
  });
});
