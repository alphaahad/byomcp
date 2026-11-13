/**
 * Real network + real database. Opt-in:  RUN_INTEGRATION=1 npx vitest run try-action
 * Petstore: import → connect (public, no sign-in) → Try it on a read → Tested + logged.
 * Also checks encrypted credentials round-trip through the DB. Cleans up after itself.
 */
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

const enabled = process.env.RUN_INTEGRATION === "1";
if (enabled && existsSync(".env.local")) process.loadEnvFile(".env.local");

describe.skipIf(!enabled)("Connect + Try it, end to end", () => {
  const created: string[] = [];
  afterAll(async () => {
    const { db } = await import("@/server/db");
    const { connectors } = await import("@/server/db/schema");
    for (const id of created) await db().delete(connectors).where(eq(connectors.id, id));
  });

  it("tries a real read action and marks it Tested", { timeout: 60_000 }, async () => {
    const { runOpenApiImport } = await import("@/server/import/run-openapi-import");
    const { saveConnection, getConnectionSummary, loadSecret } = await import("@/server/connectors/connection");
    const { assertPublicBaseUrl } = await import("@/server/net/safe-fetch");
    const { getConnectorForReview } = await import("@/server/connectors/queries");
    const { tryAction } = await import("./try-action");
    const { db } = await import("@/server/db");
    const { toolCalls, credentials } = await import("@/server/db/schema");

    const imported = await runOpenApiImport({ workspaceId: (await (await import("@/server/workspaces/workspaces")).ownerWorkspace()).id, name: "Petstore (integration test)",
      source: { kind: "openapi_url", url: "https://petstore3.swagger.io/api/v3/openapi.json" },
    });
    if (!imported.ok) throw new Error(imported.error);
    created.push(imported.connectorId);
    const data = await getConnectorForReview(imported.connectorId);
    const baseUrl = await assertPublicBaseUrl(data!.version!.detected!.baseUrl!);

    // Encrypted credential round trip (Petstore ignores it; we use "none" for the actual call).
    await saveConnection({
      connectorId: imported.connectorId,
      baseUrl,
      authType: "api_key",
      apiKey: { in: "header", name: "api_key" },
      secret: { kind: "api_key", value: "special-key-123456" },
    });
    const [row] = await db().select().from(credentials).where(eq(credentials.connectorId, imported.connectorId));
    expect(row.encryptedBlob).not.toContain("special-key");
    expect(await loadSecret(imported.connectorId)).toEqual({ kind: "api_key", value: "special-key-123456" });
    expect((await getConnectionSummary(imported.connectorId))?.credential?.hint).toBe("API key ending 3456");

    await saveConnection({ connectorId: imported.connectorId, baseUrl, authType: "none" });

    // A write can't be tried.
    const add = data!.actions.find((a) => a.key === "add_pet")!;
    expect(await tryAction(add.id, {})).toEqual({ error: expect.stringMatching(/only runs read actions/) });

    const find = data!.actions.find((a) => a.key === "find_pets_by_status")!;
    const result = await tryAction(find.id, { status: "available" });
    if ("error" in result) throw new Error(result.error);
    console.log("try:", result.status, result.httpStatus, result.durationMs, "ms", Array.isArray(result.data) ? `${result.data.length} pets` : "");
    expect(result.status).toBe("success");
    expect(result.tested).toBe(true);

    const after = await getConnectorForReview(imported.connectorId);
    expect(after!.actions.find((a) => a.id === find.id)!.evidence).toBe("tested");
    const logs = await db().select().from(toolCalls).where(eq(toolCalls.actionId, find.id));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ source: "try_it", status: "success", httpStatus: 200, input: { status: "available" } });
  });
});
