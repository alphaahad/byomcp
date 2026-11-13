/**
 * Approvals + health, end to end (real DB, real Petstore, real httpbin). Opt-in:
 *   RUN_INTEGRATION=1 npx vitest run approvals.integration
 * Cleans up everything it creates.
 */
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.RUN_INTEGRATION === "1";
if (enabled && existsSync(".env.local")) process.loadEnvFile(".env.local");

const META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "approvals-test", version: "1" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

async function mcp(connectorId: string, token: string, method: string, params: Record<string, unknown> = {}) {
  const { handleMcpRequest } = await import("@/server/mcp/server");
  const res = await handleMcpRequest(
    new Request(`https://byomcp.test/api/mcp/${connectorId}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": method,
        ...(typeof params.name === "string" ? { "mcp-name": params.name } : {}),
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: META } }),
    }),
    connectorId,
  );
  const text = await res.text();
  const data = res.headers.get("content-type")?.includes("event-stream")
    ? JSON.parse(text.split("\n").filter((l) => l.startsWith("data:")).pop()!.slice(5))
    : JSON.parse(text);
  return data.result as { content: { text: string }[]; isError?: boolean; tools?: { name: string }[] };
}

describe.skipIf(!enabled)("approvals + health, end to end", () => {
  const created: string[] = [];
  let pet = "";
  let token = "";

  beforeAll(async () => {
    const { runOpenApiImport } = await import("@/server/import/run-openapi-import");
    const { saveConnection } = await import("@/server/connectors/connection");
    const { getConnectorForReview } = await import("@/server/connectors/queries");
    const { updateAction } = await import("@/server/connectors/review");
    const { publishLatest } = await import("@/server/publish/publish");
    const imported = await runOpenApiImport({ workspaceId: (await (await import("@/server/workspaces/workspaces")).ownerWorkspace()).id, name: "Petstore (approvals test)",
      source: { kind: "openapi_url", url: "https://petstore3.swagger.io/api/v3/openapi.json" },
    });
    if (!imported.ok) throw new Error(imported.error);
    pet = imported.connectorId;
    created.push(pet);
    await saveConnection({ connectorId: pet, baseUrl: "https://petstore3.swagger.io/api/v3", authType: "none" });
    const data = await getConnectorForReview(pet);
    await updateAction(data!.actions.find((a) => a.key === "add_pet")!.id, { enabled: true });
    const p = await publishLatest(pet);
    if (!p.ok || !p.token) throw new Error("publish failed");
    token = p.token;
  }, 60_000);

  afterAll(async () => {
    const { db } = await import("@/server/db");
    const { connectors } = await import("@/server/db/schema");
    for (const id of created) await db().delete(connectors).where(eq(connectors.id, id));
  });

  const requestWrite = async (name: string) => {
    const r = await mcp(pet, token, "tools/call", { name: "add_pet", arguments: { id: Math.floor(Math.random() * 1e9), name, photoUrls: [], status: "available" } });
    const id = r.content[0].text.match(/apr_[0-9a-f]{8}/)?.[0];
    if (!id) throw new Error(`no request id in: ${r.content[0].text}`);
    return id;
  };
  const fullId = async (shortId: string) => {
    const { db } = await import("@/server/db");
    const { approvals } = await import("@/server/db/schema");
    const rows = await db().select({ id: approvals.id }).from(approvals).where(eq(approvals.connectorId, pet));
    return rows.find((r) => r.id.startsWith(shortId.slice(4)))!.id;
  };

  it("offers check_approval because a tool needs approval", async () => {
    const list = await mcp(pet, token, "tools/list");
    expect(list.tools!.map((t) => t.name)).toContain("check_approval");
  });

  it("two approvals at once run the call exactly once, and check_approval reports the result", { timeout: 60_000 }, async () => {
    const { approve } = await import("./approvals");
    const shortId = await requestWrite("Rex");
    expect((await mcp(pet, token, "tools/call", { name: "check_approval", arguments: { request_id: shortId } })).content[0].text).toMatch(/still waiting/);

    const id = await fullId(shortId);
    const [a, b] = await Promise.all([approve(id), approve(id)]);
    const oks = [a, b].filter((r) => r.ok);
    expect(oks).toHaveLength(1);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ error: expect.stringMatching(/already approved/) });
    expect(oks[0]).toMatchObject({ run: { status: "success", httpStatus: 200 } });

    const { db } = await import("@/server/db");
    const { toolCalls } = await import("@/server/db/schema");
    const calls = await db().select().from(toolCalls).where(eq(toolCalls.connectorId, pet));
    const addCalls = calls.filter((c) => c.actionKey === "add_pet");
    expect(addCalls).toHaveLength(1); // one row per call, never a second execution
    expect(addCalls[0]).toMatchObject({ status: "success", httpStatus: 200 });

    const check = await mcp(pet, token, "tools/call", { name: "check_approval", arguments: { request_id: shortId } });
    console.log("check_approval:", check.content[0].text.slice(0, 160));
    expect(check.content[0].text).toMatch(/approved and run\. It worked \(HTTP 200\)/);
  });

  it("reject sends nothing; a rejected or expired request can't be approved", { timeout: 60_000 }, async () => {
    const { approve, reject } = await import("./approvals");
    const r1 = await fullId(await requestWrite("Never sent"));
    expect(await reject(r1)).toEqual({ ok: true });
    expect(await approve(r1)).toMatchObject({ ok: false, error: expect.stringMatching(/already rejected/) });

    const r2 = await fullId(await requestWrite("Too late"));
    const { db } = await import("@/server/db");
    const { approvals } = await import("@/server/db/schema");
    await db().update(approvals).set({ createdAt: new Date(Date.now() - 25 * 3600 * 1000) }).where(eq(approvals.id, r2));
    expect(await approve(r2)).toMatchObject({ ok: false, error: expect.stringMatching(/expired/) });
  });

  it("a rejected key flips health to Needs reconnect, and reconnecting fixes it", { timeout: 60_000 }, async () => {
    const { runOpenApiImport } = await import("@/server/import/run-openapi-import");
    const { saveConnection } = await import("@/server/connectors/connection");
    const { getConnectorForReview } = await import("@/server/connectors/queries");
    const { tryAction } = await import("@/server/runtime/try-action");
    const { healthSummary } = await import("@/server/health/health");
    const spec = [
      "openapi: 3.0.3",
      "info: { title: Auth check, version: '1' }",
      "servers: [{ url: 'https://httpbin.org' }]",
      "components: { securitySchemes: { basic: { type: http, scheme: basic } } }",
      "security: [{ basic: [] }]",
      "paths:",
      "  /basic-auth/{user}/{passwd}:",
      "    get:",
      "      operationId: checkLogin",
      "      parameters:",
      "        - { name: user, in: path, required: true, schema: { type: string } }",
      "        - { name: passwd, in: path, required: true, schema: { type: string } }",
      "      responses: { '200': { description: OK } }",
    ].join("\n");
    const imported = await runOpenApiImport({ workspaceId: (await (await import("@/server/workspaces/workspaces")).ownerWorkspace()).id, name: "httpbin (health test)", source: { kind: "openapi_file", fileName: "httpbin.yaml", text: spec } });
    if (!imported.ok) throw new Error(imported.error);
    created.push(imported.connectorId);
    const action = (await getConnectorForReview(imported.connectorId))!.actions[0];

    await saveConnection({
      connectorId: imported.connectorId,
      baseUrl: "https://httpbin.org",
      authType: "basic",
      secret: { kind: "basic", username: "demo", password: "wrong-password" },
    });
    const bad = await tryAction(action.id, { user: "demo", passwd: "right-password" });
    expect(bad).toMatchObject({ status: "auth_failed", httpStatus: 401 });
    expect(await healthSummary(imported.connectorId)).toBe("needs_reconnect");

    await saveConnection({
      connectorId: imported.connectorId,
      baseUrl: "https://httpbin.org",
      authType: "basic",
      secret: { kind: "basic", username: "demo", password: "right-password" },
    });
    const good = await tryAction(action.id, { user: "demo", passwd: "right-password" });
    expect(good).toMatchObject({ status: "success", httpStatus: 200 });
    expect(await healthSummary(imported.connectorId)).toBe("healthy");
  });
});
