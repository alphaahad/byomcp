/**
 * MCP Inspector (CLI mode) against the DEPLOYED endpoint.
 * Opt-in:  RUN_INTEGRATION=1 npx vitest run inspector
 * Creates, publishes and deletes a temporary Petstore connector.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const run = promisify(execFile);
const enabled = process.env.RUN_INTEGRATION === "1";
if (enabled && existsSync(".env.local")) process.loadEnvFile(".env.local");
const BASE = process.env.MCP_BASE_URL ?? "https://byomcp.vercel.app";

describe.skipIf(!enabled)("MCP Inspector CLI → deployed endpoint", () => {
  let connectorId = "";
  let token = "";

  beforeAll(async () => {
    const { runOpenApiImport } = await import("@/server/import/run-openapi-import");
    const { saveConnection } = await import("@/server/connectors/connection");
    const { publishLatest } = await import("@/server/publish/publish");
    const imported = await runOpenApiImport({ workspaceId: (await (await import("@/server/workspaces/workspaces")).ownerWorkspace()).id, name: "Petstore (Inspector test)",
      source: { kind: "openapi_url", url: "https://petstore3.swagger.io/api/v3/openapi.json" },
    });
    if (!imported.ok) throw new Error(imported.error);
    connectorId = imported.connectorId;
    await saveConnection({ connectorId, baseUrl: "https://petstore3.swagger.io/api/v3", authType: "none" });
    const published = await publishLatest(connectorId);
    if (!published.ok || !published.token) throw new Error("publish failed");
    token = published.token;
  }, 60_000);

  afterAll(async () => {
    if (!connectorId) return;
    const { db } = await import("@/server/db");
    const { connectors } = await import("@/server/db/schema");
    await db().delete(connectors).where(eq(connectors.id, connectorId));
  });

  const inspector = async (...args: string[]) => {
    const win = process.platform === "win32";
    // On Windows npx is a .cmd, which needs a shell; quote every argument so spaces survive.
    const argv = ["--yes", "@modelcontextprotocol/inspector@2.15.0", "--cli", "--transport", "http", "--server-url", `${BASE}/api/mcp/${connectorId}`, "--header", `Authorization: Bearer ${token}`, ...args];
    const { stdout } = await run("npx", win ? argv.map((a) => `"${a.replace(/"/g, '\\"')}"`) : argv, {
      timeout: 120_000,
      shell: win,
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  };

  it("lists tools", { timeout: 150_000 }, async () => {
    const out = await inspector("--method", "tools/list");
    const names = (out.tools as { name: string }[]).map((t) => t.name);
    console.log("inspector tools/list:", names.join(", "));
    expect(names).toContain("find_pets_by_status");
  });

  it("calls a tool", { timeout: 150_000 }, async () => {
    const out = await inspector("--method", "tools/call", "--tool-name", "find_pets_by_status", "--tool-arg", "status=sold");
    console.log("inspector tools/call isError:", out.isError ?? false, "chars:", JSON.stringify(out).length);
    expect(out.isError ?? false).toBe(false);
    expect(JSON.stringify(out.content)).toContain("status");
  });
});
