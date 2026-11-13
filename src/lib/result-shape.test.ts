import { describe, expect, it } from "vitest";
import { humanLabel, parseLoose, shapeResult } from "./result-shape";

describe("shapeResult", () => {
  it("turns a wrapped list into a table with the useful columns first", () => {
    const out = shapeResult({
      count: 2,
      tickets: [
        { url: "u1", id: 1, subject: "Refund", status: "open", tags: ["a"], via: { channel: "web" } },
        { url: "u2", id: 2, subject: "Login", status: "closed", tags: [], via: { channel: "email" } },
      ],
    });
    expect(out).toEqual({
      kind: "table",
      total: 2,
      columns: [
        { key: "id", label: "Id" },
        { key: "subject", label: "Subject" },
        { key: "status", label: "Status" },
        { key: "url", label: "Url" },
      ],
      rows: [
        ["1", "Refund", "open", "u1"],
        ["2", "Login", "closed", "u2"],
      ],
    });
  });

  it("shows at most 10 rows and keeps the total", () => {
    const out = shapeResult(Array.from({ length: 25 }, (_, i) => ({ name: `n${i}` })));
    expect(out.kind === "table" && out.total).toBe(25);
    expect(out.kind === "table" && out.rows.length).toBe(10);
  });

  it("turns a record into fields, with readable labels and values", () => {
    const out = shapeResult({ firstName: "Ada", is_active: true, managers: ["x", "y"], address: { city: "Pune" }, note: null });
    expect(out).toEqual({
      kind: "fields",
      fields: [
        { label: "First name", value: "Ada" },
        { label: "Is active", value: "Yes" },
        { label: "Managers", value: "x, y" },
        { label: "Note", value: "—" },
      ],
    });
  });

  it("treats a record with its own id as a record, even when it holds empty arrays", () => {
    const out = shapeResult({ id: 4242003, name: "QA Biscuit", photoUrls: ["https://x/y.jpg"], tags: [], status: "available" });
    expect(out.kind).toBe("fields");
    expect(out.kind === "fields" && out.fields.map((f) => f.label)).toEqual(["Id", "Name", "Photo urls", "Tags", "Status"]);
  });

  it("handles empty lists, empty data and plain text", () => {
    expect(shapeResult({ data: [] })).toEqual({ kind: "table", total: 0, columns: [], rows: [] });
    expect(shapeResult("")).toEqual({ kind: "empty" });
    expect(shapeResult(null)).toEqual({ kind: "empty" });
    expect(shapeResult("Waiting for approval.")).toEqual({ kind: "text", text: "Waiting for approval." });
  });

  it("finds JSON after a sentence", () => {
    expect(parseLoose('It worked (HTTP 200).\n\n{"id":4}')).toEqual({ id: 4 });
    expect(parseLoose("[1,2]")).toEqual([1, 2]);
    expect(parseLoose("no json here")).toBe("no json here");
  });

  it("labels keys like a person would", () => {
    expect(humanLabel("created_at")).toBe("Created at");
    expect(humanLabel("photoUrls")).toBe("Photo urls");
  });
});
