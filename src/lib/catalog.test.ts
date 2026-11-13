import { describe, expect, it } from "vitest";
import { autoInputs, bestRead } from "./best-read";
import { CATALOG, catalogApp, catalogForSource, jobActionIds, opKey, sameOperation } from "./catalog";
import { countRecords, describeCount } from "./records";

const empty = { type: "object" as const, properties: {} };

describe("catalog", () => {
  it("has well-formed entries", () => {
    const keys = new Set<string>();
    for (const a of CATALOG) {
      expect(a.key).toMatch(/^[a-z0-9-]+$/);
      expect(keys.has(a.key)).toBe(false);
      keys.add(a.key);
      expect(a.source.url).toMatch(/^https:\/\//);
      expect(a.keySteps.length).toBeGreaterThan(0);
      expect(a.jobs.length).toBeGreaterThan(0);
      for (const j of a.jobs) expect(j.ops.length).toBeGreaterThan(0);
      if (a.keyHelpUrl) expect(a.keyHelpUrl).toMatch(/^https:\/\//);
    }
  });

  it("looks up by key and by source URL", () => {
    expect(catalogApp("zendesk")?.name).toBe("Zendesk");
    expect(catalogApp("nope")).toBeNull();
    expect(catalogApp(42)).toBeNull();
    expect(catalogForSource("https://developer.zendesk.com/zendesk/oas.yaml/")?.key).toBe("zendesk");
    expect(catalogForSource("https://example.com")).toBeNull();
  });

  it("matches job operations whatever the path parameters are called", () => {
    expect(opKey("get", "/api/v2/tickets/{id}/")).toBe(opKey("GET", "/api/v2/tickets/{ticket_id}"));
    const job = { key: "t", title: "", description: "", ops: [{ method: "GET" as const, path: "/tickets/{ticket_id}" }, { method: "GET" as const, path: "/missing" }] };
    const ids = jobActionIds([job], [
      { id: "a", method: "GET", path: "/tickets/{id}" },
      { id: "b", method: "PUT", path: "/tickets/{id}" },
    ]);
    expect(ids).toEqual(["a"]);
  });

  it("matches when the server address holds the path prefix", () => {
    expect(sameOperation({ method: "GET", path: "/api/v1/employees/{id}" }, { method: "GET", path: "/employees/{employeeId}" })).toBe(true);
    expect(sameOperation({ method: "GET", path: "/api/v1/employees/directory" }, { method: "GET", path: "/employees/{id}" })).toBe(false);
    expect(sameOperation({ method: "GET", path: "/api/v1/employees" }, { method: "POST", path: "/employees" })).toBe(false);
    // A bare parameter path never matches something longer.
    expect(sameOperation({ method: "GET", path: "/{id}" }, { method: "GET", path: "/tickets/{id}" })).toBe(false);
    // A base address never holds a {parameter}, so a nested resource isn't the same operation.
    expect(sameOperation({ method: "POST", path: "/subscribers" }, { method: "POST", path: "/workflows/{id}/subscribers" })).toBe(false);
    expect(sameOperation({ method: "POST", path: "/segments" }, { method: "POST", path: "/subscribers/{id}/segments" })).toBe(false);
  });

  it("prefers an exact match over a prefix match", () => {
    const job = { key: "s", title: "", description: "", ops: [{ method: "GET" as const, path: "/subscribers" }] };
    const ids = jobActionIds([job], [
      { id: "exact", method: "GET", path: "/subscribers" },
      { id: "prefixed", method: "GET", path: "/lists/subscribers" },
    ]);
    expect(ids).toEqual(["exact"]);
  });
});

describe("best read", () => {
  const read = (id: string, title: string, query = empty, enabled = true) => ({
    id,
    title,
    risk: "read" as const,
    enabled,
    params: { path: empty, query, headers: empty },
  });
  const needsId = { type: "object" as const, properties: { id: { type: "string" } }, required: ["id"] };
  const withEnum = { type: "object" as const, properties: { status: { type: "string", enum: ["open", "closed"] } }, required: ["status"] };

  it("prefers runnable lists and fills defaults", () => {
    const pick = bestRead([read("1", "Get a ticket", needsId), read("2", "List tickets by status", withEnum), read("3", "Show settings")]);
    expect(pick?.id).toBe("2");
    expect(autoInputs(pick!)).toEqual({ status: "open" });
  });

  it("returns null when nothing can run without an id", () => {
    expect(bestRead([read("1", "Get a ticket", needsId)])).toBeNull();
  });
});

describe("record counts", () => {
  it("counts arrays and wrapped lists", () => {
    expect(countRecords([1, 2, 3])).toEqual({ count: 3, noun: null });
    expect(countRecords('{"tickets":[{},{}],"count":2}')).toEqual({ count: 2, noun: "tickets" });
    expect(countRecords({ data: [{}] })).toEqual({ count: 1, noun: null });
    expect(countRecords({ id: 1 })).toBeNull();
    expect(countRecords("not json")).toBeNull();
  });
  it("describes counts in words", () => {
    expect(describeCount({ count: 25, noun: "tickets" })).toBe("25 tickets");
    expect(describeCount({ count: 1, noun: "tickets" })).toBe("1 ticket");
    expect(describeCount({ count: 1, noun: "companies" })).toBe("1 company");
    expect(describeCount({ count: 0, noun: null })).toBe("no records");
    expect(describeCount({ count: 3, noun: null })).toBe("3 records");
  });
});
