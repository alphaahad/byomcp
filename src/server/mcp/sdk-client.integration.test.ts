/**
 * The official MCP SDK client against the DEPLOYED endpoint (real HTTP, real DB, real Petstore API).
 * Opt-in:  RUN_INTEGRATION=1 npx vitest run sdk-client
 * MCP_BASE_URL defaults to https://byomcp.vercel.app. Creates, publishes and deletes a test connector.
 */
import { existsSync } from "node:fs";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.RUN_INTEGRATION === "1";
if (enabled && existsSync(".env.local")) process.loadEnvFile(".env.local");
const BASE = process.env.MCP_BASE_URL ?? "https://byomcp.vercel.app";

describe.skipIf(!enabled)(`MCP SDK client → ${BASE}`, () => {
  let connectorId = "";
  let token = "";

  beforeAll(async () => {
    const { runOpenApiImport } = await import("@/server/import/run-openapi-import");
    const { saveConnection } = await import("@/server/connectors/connection");
    const { publishLatest } = await import("@/server/publish/publish");
    const imported = await runOpenApiImport({ workspaceId: (await (await import("@/server/workspaces/workspaces")).ownerWorkspace()).id, name: "Petstore (SDK client test)",
      source: { kind: "openapi_url", url: "https://petstore3.swagger.io/api/v3/openapi.json" },
    });
    if (!imported.ok) throw new Error(imported.error);
    connectorId = imported.connectorId;
    await saveConnection({ connectorId, baseUrl: "https://petstore3.swagger.io/api/v3", authType: "none" });
    const published = await publishLatest(connectorId);
    if (!published.ok || !published.token) throw new Error(published.ok ? "no token" : published.error);
    token = published.token;
  }, 60_000);

  afterAll(async () => {
    if (!connectorId) return;
    const { db } = await import("@/server/db");
    const { connectors } = await import("@/server/db/schema");
    await db().delete(connectors).where(eq(connectors.id, connectorId));
  });

  for (const mode of ["auto", "legacy"] as const) {
    it(`lists and calls tools (${mode === "auto" ? "2026-07-28" : "2025 legacy"} protocol)`, { timeout: 60_000 }, async () => {
      const client = new Client({ name: "byomcp-sdk-test", version: "1.0.0" }, { versionNegotiation: { mode } });
      const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp/${connectorId}`), {
        authProvider: { token: async () => token },
      });
      await client.connect(transport);
      const { tools } = await client.listTools();
      console.log(`[${mode}] ${tools.length} tools:`, tools.map((t) => t.name).join(", "));
      expect(tools.map((t) => t.name)).toContain("find_pets_by_status");
      const result = await client.callTool({ name: "find_pets_by_status", arguments: { status: "available" } });
      expect(result.isError ?? false).toBe(false);
      const text = (result.content as { type: string; text: string }[])[0].text;
      console.log(`[${mode}] call returned ${text.length} chars`);
      expect(text).toContain("\"status\"");
      await client.close();
    });
  }

  it("is refused without the token", { timeout: 30_000 }, async () => {
    const client = new Client({ name: "byomcp-sdk-test", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
    const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp/${connectorId}`));
    await expect(client.connect(transport)).rejects.toThrow();
  });
});
