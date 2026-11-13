/**
 * Real network + real database. Opt-in:  RUN_INTEGRATION=1 npx vitest run integration
 * Imports a public spec through the SSRF-guarded fetch, saves it to Neon,
 * reads it back, then deletes what it created.
 */
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

const enabled = process.env.RUN_INTEGRATION === "1";
if (enabled && !process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");

describe.skipIf(!enabled)("OpenAPI import, end to end", () => {
  const created: string[] = [];

  afterAll(async () => {
    const { db } = await import("@/server/db");
    const { connectors } = await import("@/server/db/schema");
    for (const id of created) await db().delete(connectors).where(eq(connectors.id, id));
  });

  it("imports the public Petstore spec by URL", { timeout: 30_000 }, async () => {
    const { runOpenApiImport } = await import("./run-openapi-import");
    const { getConnectorForReview } = await import("@/server/connectors/queries");

    const outcome = await runOpenApiImport({ workspaceId: (await (await import("@/server/workspaces/workspaces")).ownerWorkspace()).id, name: "Petstore (integration test)",
      source: { kind: "openapi_url", url: "https://petstore3.swagger.io/api/v3/openapi.json" },
    });
    if (!outcome.ok) throw new Error(outcome.error);
    created.push(outcome.connectorId);
    expect(outcome.actionCount).toBeGreaterThan(10);

    const data = await getConnectorForReview(outcome.connectorId);
    expect(data?.version?.sourceType).toBe("openapi_url");
    expect(data?.version?.detected?.baseUrl).toMatch(/^https:\/\/petstore3\.swagger\.io/);
    const keys = data!.actions.map((a) => a.key);
    expect(keys).toEqual(expect.arrayContaining(["get_pet_by_id", "add_pet", "delete_pet"]));
    const del = data!.actions.find((a) => a.key === "delete_pet")!;
    expect(del).toMatchObject({ risk: "destructive", enabled: false, requiresApproval: true });
    const read = data!.actions.find((a) => a.key === "get_pet_by_id")!;
    expect(read).toMatchObject({ risk: "read", enabled: true, requiresApproval: false, evidence: "sourced" });
  });

  it("refuses a URL that points at a private address, with a plain message", async () => {
    const { runOpenApiImport } = await import("./run-openapi-import");
    const outcome = await runOpenApiImport({ workspaceId: (await (await import("@/server/workspaces/workspaces")).ownerWorkspace()).id, source: { kind: "openapi_url", url: "https://169.254.169.254/latest" } });
    expect(outcome).toEqual({ ok: false, error: "That address points to a private network, which isn't allowed." });
  });
});
