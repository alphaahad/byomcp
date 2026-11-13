import { describe, expect, it } from "vitest";
import { applyPatch } from "./review";

type Row = Parameters<typeof applyPatch>[0];

const base: Row = {
  id: "a",
  versionId: "v",
  key: "delete_ticket",
  title: "Delete a ticket",
  description: "Deletes a ticket.",
  resource: "Tickets",
  method: "DELETE",
  path: "/tickets/{id}",
  params: {
    path: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    query: { type: "object", properties: {} },
    headers: { type: "object", properties: {} },
  },
  successCheck: null,
  pagination: null,
  risk: "destructive",
  evidence: "sourced",
  citation: { quote: "DELETE /tickets/{id}" },
  confidence: 1,
  enabled: false,
  requiresApproval: true,
  lastTestedAt: null,
  edited: false,
  createdAt: new Date(),
} as Row;

const get: Row = { ...base, key: "get_ticket", title: "Get a ticket", method: "GET", risk: "read", requiresApproval: false, enabled: true };

describe("review rules", () => {
  it("never lets a destructive action skip approval", () => {
    expect(applyPatch(base, { requiresApproval: false })).toEqual({ error: expect.stringMatching(/always need approval/) });
  });

  it("allows turning actions on and off without marking them edited", () => {
    const r = applyPatch(base, { enabled: true });
    expect("next" in r && r.next).toMatchObject({ enabled: true, edited: false });
  });

  it("allows raising risk but not lowering it below the method", () => {
    const up = applyPatch(get, { risk: "destructive" });
    expect("next" in up && up.next).toMatchObject({ risk: "destructive", requiresApproval: true, edited: true });
    expect(applyPatch(base, { risk: "read" })).toEqual({ error: expect.stringMatching(/can't be marked Read/) });
  });

  it("marks renames as edited but keeps the evidence", () => {
    const r = applyPatch(get, { title: "Look up a ticket" });
    expect("next" in r && r.next).toMatchObject({ title: "Look up a ticket", edited: true, evidence: "sourced" });
  });

  it("re-applies safe defaults and drops evidence when the method changes", () => {
    const r = applyPatch({ ...get, evidence: "tested", lastTestedAt: new Date() }, { method: "POST" });
    expect("next" in r && r.next).toMatchObject({ method: "POST", risk: "write", enabled: false, requiresApproval: true, evidence: "needs_review", lastTestedAt: null });
  });

  it("validates edited params against the IR (path placeholders must be declared)", () => {
    const bad = JSON.stringify({ ...get.params, path: { type: "object", properties: {} } });
    expect(applyPatch(get, { paramsJson: bad })).toEqual({ error: expect.stringMatching(/isn't valid/) });
    expect(applyPatch(get, { paramsJson: "{ not json" })).toEqual({ error: expect.stringMatching(/valid JSON/) });
  });
});
