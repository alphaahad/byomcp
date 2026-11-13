import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ActionIRSchema } from "@/lib/ir";
import { OpenApiImportError, cleanSchema, humanTitle, importOpenApi, parseSpecText } from "./openapi";

const fixture = (name: string) => readFileSync(join(__dirname, "__fixtures__", name), "utf8");
const run = (name: string, sourceUrl?: string) => importOpenApi(parseSpecText(fixture(name)), { sourceUrl });
const byKey = <T extends { key: string }>(list: T[], key: string) => {
  const found = list.find((a) => a.key === key);
  if (!found) throw new Error(`no action ${key}; have ${list.map((a) => a.key).join(", ")}`);
  return found;
};

describe("OpenAPI 3.0 (helpdesk)", async () => {
  const result = await run("helpdesk-3.0.yaml", "https://docs.helpdesk.example.com/openapi.yaml");
  const { actions, detected, skipped } = result;

  it("maps every supported operation and skips HEAD", () => {
    expect(actions.map((a) => a.key).sort()).toEqual(
      ["create_ticket", "delete_ticket", "get_agents", "get_ticket", "list_tickets", "patch_contacts_by_contact_id", "post_tickets_by_ticket_id_archive"].sort(),
    );
    expect(skipped).toEqual([expect.objectContaining({ method: "HEAD", path: "/tickets/{ticket_id}" })]);
  });

  it("produces valid IR", () => {
    for (const a of actions) expect(ActionIRSchema.safeParse(a).success).toBe(true);
  });

  it("keeps per-customer host placeholders and detects the API-key header", () => {
    expect(detected.baseUrl).toBe("https://{subdomain}.helpdesk.example.com/api/v2");
    expect(detected.baseUrlVariables).toEqual({ subdomain: {} });
    expect(detected.auth).toEqual({ type: "api_key", in: "header", name: "X-Api-Key" });
    expect(detected.apiTitle).toBe("Helpdesk API");
  });

  it("never exposes the auth header as a tool parameter, but keeps other headers", () => {
    const list = byKey(actions, "list_tickets");
    expect(list.params.headers.properties).not.toHaveProperty("X-Api-Key");
    expect(list.params.headers.properties).toHaveProperty("X-Request-Source");
    expect(list.pagination).toEqual({ style: "page" });
  });

  it("applies risk rules, including name-based escalation", () => {
    expect(byKey(actions, "list_tickets").risk).toBe("read");
    expect(byKey(actions, "create_ticket").risk).toBe("write");
    expect(byKey(actions, "delete_ticket").risk).toBe("destructive");
    expect(byKey(actions, "post_tickets_by_ticket_id_archive").risk).toBe("destructive");
  });

  it("merges path-level parameters", () => {
    const get = byKey(actions, "get_ticket");
    expect(get.params.path).toMatchObject({ properties: { ticket_id: { type: "integer" } }, required: ["ticket_id"] });
  });

  it("builds the body, dropping readOnly fields, and a success check from the response", () => {
    const create = byKey(actions, "create_ticket");
    expect(create.params.body?.required).toEqual(["subject"]);
    expect(create.params.body?.properties).not.toHaveProperty("id");
    expect(create.successCheck).toEqual({ field: "id" });
  });

  it("translates nullable", () => {
    const patch = byKey(actions, "patch_contacts_by_contact_id");
    expect(patch.params.body?.properties.phone).toMatchObject({ type: ["string", "null"] });
  });

  it("writes plain-language titles when the spec has none", () => {
    expect(byKey(actions, "post_tickets_by_ticket_id_archive").title).toBe("Archive ticket");
    expect(byKey(actions, "patch_contacts_by_contact_id").title).toBe("Update a contact");
    expect(byKey(actions, "get_agents").title).toBe("List agents");
  });

  it("cites the source", () => {
    expect(byKey(actions, "get_ticket").citation).toEqual({
      url: "https://docs.helpdesk.example.com/openapi.yaml",
      quote: "GET /tickets/{ticket_id}: View a ticket",
    });
    expect(byKey(actions, "get_ticket").evidence).toBe("sourced");
  });

  it("groups by tag, falling back to the path", () => {
    expect(byKey(actions, "get_ticket").resource).toBe("Tickets");
    expect(byKey(actions, "get_agents").resource).toBe("Agents");
  });
});

describe("Swagger 2.0 (legacy helpdesk)", async () => {
  const { actions, detected } = await run("helpdesk-swagger2.json");

  it("detects https host + basePath and basic auth", () => {
    expect(detected.baseUrl).toBe("https://legacy.helpdesk.example.com/api");
    expect(detected.auth).toEqual({ type: "basic" });
  });

  it("dedupes colliding operationIds", () => {
    expect(actions.map((a) => a.key)).toEqual(["tickets_create", "tickets_create_2", "refund_payment"]);
  });

  it("maps body and formData params", () => {
    expect(actions[0].params.body).toMatchObject({ required: ["subject"], properties: { subject: { type: "string" } } });
    expect(actions[1].params.body).toMatchObject({
      required: ["body"],
      properties: { body: { type: "string", description: "Note text" }, private: { type: "boolean" } },
    });
  });

  it("treats refunds as destructive", () => {
    expect(byKey(actions, "refund_payment").risk).toBe("destructive");
  });
});

describe("OpenAPI 3.1 (org chart): cycles, external refs, OAuth", async () => {
  const { actions, detected } = await run("org-3.1.yaml", "https://org.example.com/docs/openapi.yaml");

  it("resolves a relative server against the spec URL", () => {
    expect(detected.baseUrl).toBe("https://org.example.com/v1");
  });

  it("skips unsupported OAuth in favour of a supported scheme", () => {
    expect(detected.auth).toEqual({ type: "bearer" });
  });

  it("cuts circular refs and never follows external refs", () => {
    const body = byKey(actions, "create_employee").params.body!;
    const json = JSON.stringify(body);
    expect(json).not.toContain("evil.example.com");
    expect(json).not.toContain("/etc/passwd");
    expect(json).not.toContain("$ref");
    // The circular schema itself is resolved one level deep...
    expect(body.properties.name).toEqual({ type: "string" });
    // ...its self-references and the external refs become placeholders.
    expect(body.properties.manager).toEqual({ description: "Nested data. See the API docs for its shape." });
    expect(body.properties.reports).toEqual({
      type: "array",
      items: { description: "Nested data. See the API docs for its shape." },
    });
    expect(body.properties.address).toEqual({ description: "Nested data. See the API docs for its shape." });
    expect(body.properties.badge).toEqual({ description: "Nested data. See the API docs for its shape." });
  });

  it("wraps non-object bodies", () => {
    expect(byKey(actions, "bulk_import").params.body).toMatchObject({
      properties: { body: { type: "array" } },
      "x-byomcp-wrapped": true,
    });
  });
});

describe("server placeholders", () => {
  const spec = (servers: string) =>
    parseSpecText(
      ["openapi: 3.0.3", 'info: { title: x, version: "1" }', "servers: " + servers, "paths:", "  /a:", "    get:", '      responses: { "200": { description: OK } }'].join("\n"),
    );

  it("offers a dropdown when a host placeholder has fixed values, and fills path placeholders", async () => {
    const r = await importOpenApi(
      spec('[{ url: "https://{region}.api.example.com/{version}", variables: { region: { enum: [us, eu], default: us }, version: { default: v2 } } }]'),
    );
    expect(r.detected.baseUrl).toBe("https://{region}.api.example.com/v2");
    expect(r.detected.baseUrlVariables).toEqual({ region: { enum: ["us", "eu"], default: "us" } });
  });

  it("asks only for placeholders with sample defaults (Zendesk style)", async () => {
    const r = await importOpenApi(
      spec('[{ url: "https://{subdomain}.{domain}.com", variables: { subdomain: { default: example }, domain: { default: zendesk } } }]'),
    );
    expect(r.detected.baseUrl).toBe("https://{subdomain}.zendesk.com");
    expect(r.detected.baseUrlVariables).toEqual({ subdomain: {} });
  });

  it("fills a host placeholder with only one allowed value", async () => {
    const r = await importOpenApi(spec('[{ url: "https://{env}.example.com", variables: { env: { enum: [api] } } }]'));
    expect(r.detected.baseUrl).toBe("https://api.example.com");
    expect(r.detected.baseUrlVariables).toBeUndefined();
  });
});

describe("errors", () => {
  it("rejects files that aren't specs, in plain language", () => {
    expect(() => parseSpecText("<html>hello</html>")).toThrow(OpenApiImportError);
    expect(() => parseSpecText("name: not a spec")).toThrow(/doesn't look like an OpenAPI/);
    expect(() => parseSpecText("{ broken")).toThrow(/couldn't read/);
  });

  it("rejects YAML alias bombs", () => {
    const bomb = ["openapi: 3.0.0", "a: &a [x,x,x,x,x,x,x,x,x]", ...Array.from({ length: 12 }, (_, i) => {
      const prev = i === 0 ? "a" : `l${i - 1}`;
      return `l${i}: &l${i} [*${prev},*${prev},*${prev},*${prev},*${prev},*${prev},*${prev},*${prev},*${prev}]`;
    })].join("\n");
    expect(() => parseSpecText(bomb)).toThrow(OpenApiImportError);
  });

  it("rejects a spec with no operations", async () => {
    await expect(importOpenApi(parseSpecText("openapi: 3.0.0\ninfo: {title: x, version: '1'}\npaths: {}"))).rejects.toThrow(
      /doesn't list any API operations/,
    );
  });
});

describe("helpers", () => {
  it("humanTitle", () => {
    expect(humanTitle("GET", "/api/v2/companies")).toBe("List companies");
    expect(humanTitle("GET", "/companies/{id}")).toBe("Get a company");
    expect(humanTitle("POST", "/invoices")).toBe("Create an invoice");
    expect(humanTitle("POST", "/subscriptions/{id}/cancel")).toBe("Cancel subscription");
    expect(humanTitle("DELETE", "/addresses/{id}")).toBe("Delete an address");
  });

  it("cleanSchema cuts JS-level cycles", () => {
    const node: Record<string, unknown> = { type: "object", properties: {} };
    (node.properties as Record<string, unknown>).self = node;
    expect(JSON.stringify(cleanSchema(node))).toContain("Nested data");
  });
});
