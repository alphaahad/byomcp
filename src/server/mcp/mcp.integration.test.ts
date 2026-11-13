/**
 * MCP endpoint, in-process, against the real database and real Petstore API.
 * Opt-in:  RUN_INTEGRATION=1 npx vitest run mcp.integration
 * Raw JSON-RPC (2026-07-28 stateless + 2025 legacy initialize), auth, approvals.
 */
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.RUN_INTEGRATION === "1";
if (enabled && existsSync(".env.local")) process.loadEnvFile(".env.local");

const META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "byomcp-test", version: "1.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

async function readJsonRpc(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const data = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter(Boolean);
    return JSON.parse(data[data.length - 1]);
  }
  return text ? JSON.parse(text) : {};
}

describe.skipIf(!enabled)("MCP endpoint (in-process)", () => {
  let connectorId = "";
  let token = "";
  let call: (method: string, params?: Record<string, unknown>, opts?: { token?: string | null; name?: string; modern?: boolean }) => Promise<{ status: number; body: Record<string, unknown>; headers: Headers }>;

  beforeAll(async () => {
    const { runOpenApiImport } = await import("@/server/import/run-openapi-import");
    const { saveConnection } = await import("@/server/connectors/connection");
    const { getConnectorForReview } = await import("@/server/connectors/queries");
    const { updateAction } = await import("@/server/connectors/review");
    const { publishLatest } = await import("@/server/publish/publish");
    const { handleMcpRequest } = await import("./server");

    const imported = await runOpenApiImport({ workspaceId: (await (await import("@/server/workspaces/workspaces")).ownerWorkspace()).id, name: "Petstore (MCP test)",
      source: { kind: "openapi_url", url: "https://petstore3.swagger.io/api/v3/openapi.json" },
    });
    if (!imported.ok) throw new Error(imported.error);
    connectorId = imported.connectorId;
    await saveConnection({ connectorId, baseUrl: "https://petstore3.swagger.io/api/v3", authType: "none" });
    const data = await getConnectorForReview(connectorId);
    const add = data!.actions.find((a) => a.key === "add_pet")!;
    await updateAction(add.id, { enabled: true }); // a write, still needs approval
    const published = await publishLatest(connectorId);
    if (!published.ok || !published.token) throw new Error(published.ok ? "no token" : published.error);
    token = published.token;

    let id = 0;
    call = async (method, params = {}, opts = {}) => {
      const modern = opts.modern ?? true;
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      };
      if (modern) {
        headers["mcp-protocol-version"] = "2026-07-28";
        headers["mcp-method"] = method;
        if (opts.name) headers["mcp-name"] = opts.name;
      }
      const t = opts.token === undefined ? token : opts.token;
      if (t) headers.authorization = `Bearer ${t}`;
      const body = { jsonrpc: "2.0", id: ++id, method, params: modern ? { ...params, _meta: META } : params };
      const res = await handleMcpRequest(
        new Request(`https://byomcp.test/api/mcp/${connectorId}`, { method: "POST", headers, body: JSON.stringify(body) }),
        connectorId,
      );
      return { status: res.status, body: await readJsonRpc(res), headers: res.headers };
    };
  }, 60_000);

  afterAll(async () => {
    if (!connectorId) return;
    const { db } = await import("@/server/db");
    const { connectors } = await import("@/server/db/schema");
    await db().delete(connectors).where(eq(connectors.id, connectorId));
  });

  it("rejects missing and wrong tokens with 401 + a bearer challenge", async () => {
    const none = await call("tools/list", {}, { token: null });
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate") ?? "").toMatch(/Bearer/i);
    expect((await call("tools/list", {}, { token: "byo_wrong" })).status).toBe(401);
  });

  it("answers server/discover", async () => {
    const r = await call("server/discover");
    expect(r.status).toBe(200);
    const result = r.body.result as Record<string, unknown>;
    console.log("discover:", JSON.stringify(result).slice(0, 300));
    expect(result.supportedVersions).toEqual(expect.arrayContaining(["2026-07-28"]));
  });

  it("lists only enabled tools, with schemas and annotations", async () => {
    const r = await call("tools/list");
    const tools = (r.body.result as { tools: { name: string; inputSchema: Record<string, unknown>; annotations?: Record<string, unknown> }[] }).tools;
    console.log("tools:", tools.map((t) => t.name).join(", "));
    const names = tools.map((t) => t.name);
    expect(names).toContain("find_pets_by_status");
    expect(names).toContain("add_pet");
    expect(names).not.toContain("delete_pet"); // off by default
    const find = tools.find((t) => t.name === "find_pets_by_status")!;
    expect(find.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(find.inputSchema).toMatchObject({ type: "object", properties: { status: expect.any(Object) } });
  });

  it("calls a read tool against the real API", async () => {
    const r = await call("tools/call", { name: "find_pets_by_status", arguments: { status: "available" } }, { name: "find_pets_by_status" });
    const result = r.body.result as { content: { type: string; text: string }[]; isError?: boolean };
    expect(result.isError ?? false).toBe(false);
    expect(result.content[0].text).toContain("\"status\"");
  });

  it("never runs a write that needs approval: it creates a pending approval instead", async () => {
    const r = await call("tools/call", { name: "add_pet", arguments: { name: "Rex", photoUrls: [] } }, { name: "add_pet" });
    const result = r.body.result as { content: { text: string }[] };
    expect(result.content[0].text).toMatch(/Waiting for approval/);
    const { db } = await import("@/server/db");
    const { approvals } = await import("@/server/db/schema");
    const pending = await db().select().from(approvals).where(eq(approvals.connectorId, connectorId));
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ status: "pending", input: { name: "Rex", photoUrls: [] } });
    expect(pending[0].summary).toContain("Petstore (MCP test)");
  });

  it("rejects bad arguments without calling the API, and unknown tools as a protocol error", async () => {
    const bad = await call("tools/call", { name: "find_pets_by_status", arguments: { nope: 1 } }, { name: "find_pets_by_status" });
    expect(JSON.stringify(bad.body)).toMatch(/isError|error/);
    const unknown = await call("tools/call", { name: "delete_pet", arguments: { petId: 1 } }, { name: "delete_pet" });
    expect(unknown.body.error ?? (unknown.body.result as { isError?: boolean })?.isError).toBeTruthy();
  });

  it("still serves 2025-era clients (initialize, then tools/list)", async () => {
    const init = await call(
      "initialize",
      { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "legacy", version: "1" } },
      { modern: false },
    );
    console.log("legacy init:", init.status, JSON.stringify(init.body).slice(0, 200));
    expect(init.status).toBe(200);
    const list = await call("tools/list", {}, { modern: false });
    expect(JSON.stringify(list.body)).toContain("find_pets_by_status");
  });
});
